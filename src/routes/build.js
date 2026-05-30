const express = require('express');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const { requireAuth, requireCredits } = require('../middleware/auth');
const { getDB, getStorage } = require('../services/firebase');
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
    versionCode = 1,
    versionName  = '1.0.0',
    minSdk       = '23',
    orientation  = 'portrait',
    permissions  = [],
    buildType    = 'apk'   // 'apk' | 'aab'
  } = req.body;

  // ── Validation ──────────────────────────────────────────
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
  const repoName = `nexdroid-${buildId.split('-')[0]}`;
  const uid      = req.user.uid;
  const isAAB    = buildType === 'aab';

  try {
    const db = getDB();

    // Create build doc in Firestore
    await db.collection('builds').doc(buildId).set({
      buildId,
      uid,
      appName:     appName.trim(),
      packageName,
      versionCode,
      versionName,
      minSdk,
      orientation,
      permissions,
      buildType,
      repoName,
      status:   'queued',
      progress: 0,
      logs:     [`Build queued (${buildType.toUpperCase()})...`],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Deduct 5 credits
    await deductCredits(uid, 5, `${isAAB ? 'AAB' : 'APK'} build: ${appName}`);

    // Respond immediately — pipeline runs async
    res.json({ success: true, buildId, status: 'queued', buildType });

    // Run pipeline in background
    runBuildPipeline(buildId, repoName, uid, {
      htmlCode, appName, packageName,
      versionCode, versionName, minSdk, orientation, permissions, buildType
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
    // 1. Create GitHub repo
    await log('Creating build repository...', 5);
    await github.createRepo(repoName);

    // 2. Generate all project files (includes workflow)
    await log('Generating Android project files...', 15);
    const files = generateProjectFiles(config, config.htmlCode);

    // 3. Push all files (workflow is already included via builder.js)
    await log('Pushing project to GitHub...', 30);
    await github.pushFiles(repoName, files);

    // 4. Trigger GitHub Actions
    await log(`Triggering ${isAAB ? 'AAB' : 'APK'} build on GitHub Actions...`, 40);
    await github.triggerWorkflow(repoName, 'build.yml');

    // 5. Poll until complete
    await log(`Compiling & signing ${isAAB ? 'App Bundle (AAB)' : 'APK'} — takes ~3-5 min...`, 50);
    const runId = await pollForRun(repoName, buildId, db);

    // 6. Download artifact from GitHub
    await log('Downloading build artifact...', 88);
    const artifactName = isAAB ? 'release-aab' : 'release-apk';
    const zipBuffer    = await github.downloadArtifact(repoName, runId, artifactName);
    if (!zipBuffer) throw new Error(`${isAAB ? 'AAB' : 'APK'} artifact not found`);

    // 7. Extract + upload to Firebase Storage
    await log('Uploading signed file to storage...', 93);
    const fileUrl = await uploadToStorage(zipBuffer, uid, buildId, isAAB);

    // 8. Done
    const doneMsg = isAAB
      ? 'Build complete! Signed AAB ready for Play Store.'
      : 'Build complete! Signed APK ready to install.';
    await log(doneMsg, 100);

    await db.collection('builds').doc(buildId).update({
      status:      'success',
      progress:    100,
      fileUrl,                     // generic key for both APK + AAB
      apkUrl:      isAAB ? null : fileUrl,
      aabUrl:      isAAB ? fileUrl : null,
      completedAt: new Date(),
      updatedAt:   new Date()
    });

    // Update user totalBuilds
    await db.collection('users').doc(uid).update({
      totalBuilds: admin.firestore.FieldValue.increment(1)
    });

  } catch (err) {
    await log(`Build failed: ${err.message}`, -1);
    await db.collection('builds').doc(buildId).update({
      status:    'failed',
      updatedAt: new Date()
    });
  } finally {
    // Cleanup temp repo after 10s
    setTimeout(() => github.deleteRepo(repoName), 10000);
  }
}

// ─── Poll GitHub Actions for run completion ───────────────
async function pollForRun(repoName, buildId, db) {
  const progressSteps = [55, 60, 65, 70, 75, 80, 85];
  let attempts = 0;
  let runId    = null;
  let step     = 0;

  // Wait for run to appear (max 5 min)
  while (!runId && attempts < 20) {
    await sleep(15000);
    const run = await github.getLatestRun(repoName);
    if (run) runId = run.id;
    attempts++;
  }
  if (!runId) throw new Error('GitHub Actions run did not start');

  // Poll run status (max 10 min total)
  while (attempts < 60) {
    await sleep(15000);
    const run = await github.getRunStatus(repoName, runId);

    // Increment progress bar gradually
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

// ─── Extract from zip + upload to Firebase Storage ────────
async function uploadToStorage(zipBuffer, uid, buildId, isAAB) {
  const AdmZip = require('adm-zip');
  const zip     = new AdmZip(zipBuffer);
  const ext     = isAAB ? '.aab' : '.apk';
  const entry   = zip.getEntries().find(e => e.entryName.endsWith(ext));
  if (!entry) throw new Error(`${ext} not found in artifact zip`);

  const fileBuffer = entry.getData();
  const mimeType   = isAAB
    ? 'application/octet-stream'
    : 'application/vnd.android.package-archive';
  const fileName   = `builds/${uid}/${buildId}/app-release${ext}`;

  const bucket = getStorage();
  const file   = bucket.file(fileName);

  await file.save(fileBuffer, { metadata: { contentType: mimeType } });

  // Signed URL valid for 7 days
  const [url] = await file.getSignedUrl({
    action:  'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
  });
  return url;
}

// ─── GET /api/build/user/list ─────────────────────────────
router.get('/user/list', requireAuth, async (req, res) => {
  try {
    const db   = getDB();
    const snap = await db.collection('builds')
      .where('uid', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const builds = snap.docs.map(d => {
      const data = d.data();
      return {
        buildId:     data.buildId,
        appName:     data.appName,
        packageName: data.packageName,
        buildType:   data.buildType || 'apk',
        status:      data.status,
        progress:    data.progress,
        fileUrl:     data.fileUrl  || null,
        apkUrl:      data.apkUrl   || null,
        aabUrl:      data.aabUrl   || null,
        createdAt:   data.createdAt,
        completedAt: data.completedAt || null
      };
    });

    res.json({ builds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch builds' });
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
