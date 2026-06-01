const express = require('express');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const { requireAuth, requireCredits } = require('../middleware/auth');
const { getDB } = require('../services/firebase');
const github = require('../services/github');
const { generateProjectFiles } = require('../services/builder');

const router = express.Router();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── DEDUCT CREDITS ───────────────────────────────────────
async function deductCredits(uid, amount, reason) {
  const db = getDB();
  const ref = db.collection('users').doc(uid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const current = doc.data().credits || 0;
    if (current < amount) throw new Error('Insufficient credits');
    t.update(ref, { credits: current - amount, updatedAt: new Date() });
    t.set(db.collection('transactions').doc(), {
      uid, type: 'debit', amount, reason, createdAt: new Date()
    });
  });
}

// ─── UPDATE BUILD STATUS ──────────────────────────────────
async function updateBuildStatus(buildId, status, progress, msg) {
  try {
    const db = getDB();
    await db.collection('builds').doc(buildId).update({
      status,
      progress,
      updatedAt: new Date(),
      logs: admin.firestore.FieldValue.arrayUnion(
        `[${new Date().toLocaleTimeString()}] ${msg}`
      )
    });
  } catch (e) {
    console.error('updateBuildStatus error:', e.message);
  }
}

// ─── POST /api/build/start ────────────────────────────────
router.post('/start', requireAuth, requireCredits(5), async (req, res) => {
  const {
    htmlCode,
    appName,
    packageName,
    versionCode        = 1,
    versionName        = '1.0.0',
    minSdk             = '23',
    targetSdk          = '34',
    orientation        = 'portrait',
    permissions        = [],
    customPermissions  = [],
    buildType          = 'apk',
    iconBase64         = null,
    keystore           = {},
    admob              = null
  } = req.body;

  // Merge permissions + customPermissions (deduplicate)
  const allPermissions = [...new Set([...permissions, ...customPermissions])];

  // Keystore fields with defaults
  const ksAlias     = (keystore.alias      || 'release').trim();
  const ksStorePass = (keystore.storePassword || '').trim();
  const ksKeyPass   = (keystore.keyPassword   || '').trim();
  const ksCN        = (keystore.cn            || 'Unknown').trim();
  const ksOrg       = (keystore.org           || 'Unknown').trim();
  const ksCountry   = (keystore.country       || 'IN').trim().toUpperCase();

  if (!ksStorePass || ksStorePass.length < 6)
    return res.status(400).json({ error: 'Keystore store password min 6 characters required' });
  if (!ksKeyPass || ksKeyPass.length < 6)
    return res.status(400).json({ error: 'Keystore key password min 6 characters required' });

  if (!htmlCode || htmlCode.trim().length < 20)
    return res.status(400).json({ error: 'HTML code is required' });
  if (!appName || !appName.trim())
    return res.status(400).json({ error: 'App name is required' });
  if (!packageName || !packageName.includes('.'))
    return res.status(400).json({ error: 'Valid package name required (e.g. com.name.app)' });
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(packageName))
    return res.status(400).json({ error: 'Invalid package name format' });
  if (!['apk', 'aab'].includes(buildType))
    return res.status(400).json({ error: 'buildType must be apk or aab' });

  const buildId  = uuidv4();
  // Repo name based on packageName so same app reuses same repo & keystore
  const safePkg  = packageName.replace(/\./g, '-').toLowerCase();
  const repoName = `nexdroid-${safePkg}`;
  const uid      = req.user.uid;
  const isAAB    = buildType === 'aab';

  try {
    const db = getDB();

    await db.collection('builds').doc(buildId).set({
      buildId,
      uid,
      appName:          appName.trim(),
      packageName,
      versionCode,
      versionName,
      minSdk,
      targetSdk,
      orientation,
      permissions:      allPermissions,
      buildType,
      repoName,
      keystoreAlias:    ksAlias,
      admobEnabled:     !!(admob && admob.enabled),
      status:   'queued',
      progress: 0,
      logs:     [`Build queued (${buildType.toUpperCase()})...`],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await deductCredits(uid, 5, `${isAAB ? 'AAB' : 'APK'} build: ${appName}`);

    res.json({ success: true, buildId, status: 'queued', buildType });

    runBuildPipeline(buildId, repoName, uid, {
      htmlCode, appName, packageName,
      versionCode, versionName, minSdk, targetSdk,
      orientation, permissions: allPermissions, buildType,
      iconBase64, admob,
      keystoreConfig: { alias: ksAlias, storePassword: ksStorePass, keyPassword: ksKeyPass, cn: ksCN, org: ksOrg, country: ksCountry }
    }).catch(err => {
      console.error(`[Build ${buildId}] Fatal:`, err.message);
      updateBuildStatus(buildId, 'failed', 0, `Fatal error: ${err.message}`);
    });

  } catch (err) {
    console.error('[Build Start]', err.message);
    if (err.message === 'Insufficient credits')
      return res.status(402).json({ error: 'Insufficient credits' });
    res.status(500).json({ error: 'Failed to start build. Please try again.' });
  }
});

// ─── BUILD PIPELINE (async) ───────────────────────────────
// ─── KEYSTORE: GET EXISTING OR CREATE NEW ─────────────────
// packageName ko key banao — same app ka har build same keystore use karega
async function getOrCreateKeystore(packageName, ksParams) {
  const db = getDB();
  const ksRef = db.collection('keystores').doc(packageName);
  const ksDoc = await ksRef.get();

  if (ksDoc.exists) {
    // Existing keystore mili — wahi return karo
    const d = ksDoc.data();
    console.log(`[Keystore] Reusing existing keystore for ${packageName}`);
    return {
      keystoreBase64: d.keystoreBase64,
      alias:          d.alias,
      storePassword:  d.storePassword,
      keyPassword:    d.keyPassword,
      isNew:          false
    };
  }

  // Nayi keystore generate karo (Node.js mein, via child_process)
  console.log(`[Keystore] Generating new keystore for ${packageName}`);
  const { execSync } = require('child_process');
  const fs   = require('fs');
  const path = require('path');
  const tmpPath = path.join('/tmp', `ks_${packageName.replace(/\./g,'-')}_${Date.now()}.jks`);

  execSync(
    `keytool -genkey -v \
      -keystore "${tmpPath}" \
      -alias "${ksParams.alias}" \
      -keyalg RSA -keysize 2048 \
      -validity 10000 \
      -storetype JKS \
      -storepass "${ksParams.storePassword}" \
      -keypass "${ksParams.keyPassword}" \
      -dname "CN=${ksParams.cn}, O=${ksParams.org}, L=Unknown, ST=Unknown, C=${ksParams.country}"`,
    { stdio: 'pipe' }
  );

  const keystoreBase64 = fs.readFileSync(tmpPath).toString('base64');
  fs.unlinkSync(tmpPath); // temp file delete karo

  // Firestore mein save karo — permanently
  await ksRef.set({
    keystoreBase64,
    alias:         ksParams.alias,
    storePassword: ksParams.storePassword,
    keyPassword:   ksParams.keyPassword,
    packageName,
    createdAt:     new Date()
  });

  console.log(`[Keystore] New keystore saved for ${packageName}`);
  return {
    keystoreBase64,
    alias:         ksParams.alias,
    storePassword: ksParams.storePassword,
    keyPassword:   ksParams.keyPassword,
    isNew:         true
  };
}

async function runBuildPipeline(buildId, repoName, uid, config) {
  const db    = getDB();
  const isAAB = config.buildType === 'aab';

  const log = async (msg, progress) => {
    console.log(`[Build ${buildId}] ${msg}`);
    const status =
      progress === 100 ? 'success' :
      progress  <  0  ? 'failed'  : 'building';
    await db.collection('builds').doc(buildId).update({
      status,
      progress: Math.abs(progress),
      logs: admin.firestore.FieldValue.arrayUnion(
        `[${new Date().toLocaleTimeString()}] ${msg}`
      ),
      updatedAt: new Date()
    });
  };

  try {
    await log('Creating build repository...', 5);
    const exists = await github.repoExists(repoName);
    if (exists) {
      console.log(`[Build ${buildId}] Repo ${repoName} already exists — reusing for keystore continuity`);
      await log('Reusing existing repo (same keystore will be used)...', 5);
    } else {
      await github.createRepo(repoName);
    }

    await log('Setting up keystore...', 12);
    const ksResult = await getOrCreateKeystore(config.packageName, config.keystoreConfig);
    if (ksResult.isNew) {
      await log('New keystore generated & saved permanently', 14);
    } else {
      await log('Existing keystore loaded — app signature preserved ✓', 14);
    }

    // keystoreConfig mein base64 inject karo — workflow mein decode hoga
    const keystoreConfigWithBase64 = {
      ...config.keystoreConfig,
      keystoreBase64:  ksResult.keystoreBase64,
      alias:           ksResult.alias,
      storePassword:   ksResult.storePassword,
      keyPassword:     ksResult.keyPassword,
    };

    await log('Generating Android project files...', 15);
    const files = generateProjectFiles(
      { ...config, keystoreConfig: keystoreConfigWithBase64 },
      config.htmlCode
    );

    const filesForGithub = files.map(f => ({
      path: f.path,
      content: f.content,
      alreadyBase64: f.encoding === 'base64'
    }));

    await log('Pushing project to GitHub...', 30);
    await github.pushFiles(repoName, filesForGithub);

    await log(`Triggering ${isAAB ? 'AAB' : 'APK'} build on GitHub Actions...`, 40);
    await sleep(5000);
    await github.triggerWorkflow(repoName, 'build.yml');

    await log(`Compiling & signing ${isAAB ? 'App Bundle (AAB)' : 'APK'} — takes ~3-5 min...`, 50);
    const runId = await pollForRun(repoName, buildId, db);

    await log('Fetching artifact download link...', 88);
    const artifactName = isAAB ? 'release-aab' : 'release-apk';
    const artifactInfo = await github.getArtifactUrl(repoName, runId, artifactName);
    if (!artifactInfo) throw new Error(`${isAAB ? 'AAB' : 'APK'} artifact not found`);

    const doneMsg = isAAB
      ? 'Build complete! Signed AAB ready for Play Store.'
      : 'Build complete! Signed APK ready to install.';
    await log(doneMsg, 100);

    await db.collection('builds').doc(buildId).update({
      status:      'success',
      progress:    100,
      fileUrl:     artifactInfo.downloadUrl,
      artifactId:  artifactInfo.artifactId,
      repoName,
      apkUrl:      isAAB ? null : artifactInfo.downloadUrl,
      aabUrl:      isAAB ? artifactInfo.downloadUrl : null,
      completedAt: new Date(),
      updatedAt:   new Date()
    });

    await db.collection('users').doc(uid).update({
      totalBuilds: admin.firestore.FieldValue.increment(1)
    });

  } catch (err) {
    await log(`Build failed: ${err.message}`, -1);
    await db.collection('builds').doc(buildId).update({
      status:    'failed',
      updatedAt: new Date()
    });
  }
  // Note: repo is NOT deleted — same repo reused for future builds of same app (keystore continuity)
}

// ─── Poll GitHub Actions for run completion ───────────────
async function pollForRun(repoName, buildId, db) {
  const progressSteps = [55, 60, 65, 70, 75, 80, 85];
  let attempts = 0;
  let runId    = null;
  let step     = 0;

  while (!runId && attempts < 20) {
    await sleep(15000);
    const run = await github.getLatestRun(repoName);
    if (run) runId = run.id;
    attempts++;
  }
  if (!runId) throw new Error('GitHub Actions run did not start');

  while (attempts < 60) {
    await sleep(15000);
    const run = await github.getRunStatus(repoName, runId);

    if (step < progressSteps.length) {
      await db.collection('builds').doc(buildId).update({
        progress:  progressSteps[step++],
        updatedAt: new Date()
      });
    }

    if (run.status === 'completed') {
      if (run.conclusion === 'success') return runId;
      throw new Error(`Build failed on GitHub Actions: ${run.conclusion}`);
    }
    attempts++;
  }
  throw new Error('Build timed out after 10 minutes');
}

// ─── GET /api/build/download/:id ─────────────────────────
// Proxies GitHub artifact zip download to user
router.get('/download/:id', requireAuth, async (req, res) => {
  try {
    const db  = getDB();
    const doc = await db.collection('builds').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Build not found' });
    const data = doc.data();
    if (data.uid !== req.user.uid && !req.userData?.isAdmin)
      return res.status(403).json({ error: 'Access denied' });
    if (!data.artifactId || !data.repoName)
      return res.status(404).json({ error: 'File not ready yet' });

    const axios = require('axios');
    const GH_TOKEN = process.env.GITHUB_TOKEN;
    const GH_OWNER = process.env.GITHUB_USERNAME;
    const ext = data.aabUrl ? '.aab' : '.apk';

    const ghRes = await axios.get(
      `https://api.github.com/repos/${GH_OWNER}/${data.repoName}/actions/artifacts/${data.artifactId}/zip`,
      {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        responseType: 'stream',
        maxRedirects: 5
      }
    );

    res.setHeader('Content-Disposition', `attachment; filename="app-release${ext}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    ghRes.data.pipe(res);

  } catch (err) {
    console.error('Download error:', err.message);
    res.status(500).json({ error: 'Download failed' });
  }
});

// ─── GET /api/build/user/list ─────────────────────────────
router.get('/user/list', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    let snap;

    try {
      // Try with orderBy first (requires composite index)
      snap = await db.collection('builds')
        .where('uid', '==', req.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
    } catch (indexErr) {
      // Composite index missing — fallback: fetch without orderBy, sort in memory
      console.warn('Firestore index missing, falling back to in-memory sort:', indexErr.message);
      snap = await db.collection('builds')
        .where('uid', '==', req.user.uid)
        .limit(20)
        .get();
    }

    const builds = snap.docs.map(d => {
      const data = d.data();
      return {
        buildId:     data.buildId,
        appName:     data.appName     || 'Unknown App',
        packageName: data.packageName || '',
        buildType:   data.buildType   || 'apk',
        status:      data.status      || 'unknown',
        progress:    data.progress    || 0,
        logs:        data.logs        || [],
        fileUrl:     data.fileUrl     || null,
        apkUrl:      data.apkUrl      || null,
        aabUrl:      data.aabUrl      || null,
        versionName: data.versionName || '1.0.0',
        aiGenerated: data.aiGenerated || false,
        createdAt:   data.createdAt,
        completedAt: data.completedAt || null
      };
    });

    // Sort in memory by createdAt desc (fallback ke liye bhi kaam karega)
    builds.sort((a, b) => {
      const ta = a.createdAt?._seconds || (a.createdAt ? new Date(a.createdAt).getTime()/1000 : 0);
      const tb = b.createdAt?._seconds || (b.createdAt ? new Date(b.createdAt).getTime()/1000 : 0);
      return tb - ta;
    });

    res.json({ builds });
  } catch (err) {
    console.error('user/list error:', err);
    res.status(500).json({ error: 'Failed to fetch builds', detail: err.message });
  }
});

// ─── GET /api/build/:id ───────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const db  = getDB();
    const doc = await db.collection('builds').doc(id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Build not found' });

    const data = doc.data();
    if (data.uid !== req.user.uid && !req.userData?.isAdmin)
      return res.status(403).json({ error: 'Access denied' });

    res.json({
      buildId:     data.buildId,
      appName:     data.appName,
      packageName: data.packageName,
      buildType:   data.buildType || 'apk',
      status:      data.status,
      progress:    data.progress,
      logs:        data.logs || [],
      fileUrl:     data.fileUrl  || null,
      apkUrl:      data.apkUrl   || null,
      aabUrl:      data.aabUrl   || null,
      createdAt:   data.createdAt,
      completedAt: data.completedAt || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch build status' });
  }
});

module.exports = router;
