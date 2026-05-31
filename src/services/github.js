const axios = require('axios');

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_USERNAME;
const GH_API = 'https://api.github.com';

const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

// ─── Create repo ──────────────────────────────────────────
async function createRepo(repoName) {
  const res = await axios.post(`${GH_API}/user/repos`, {
    name: repoName,
    private: true,
    auto_init: false,
    description: 'Nexdroid build repo — auto-generated'
  }, { headers: ghHeaders });
  return res.data;
}

// ─── Check if repo exists ─────────────────────────────────
async function repoExists(repoName) {
  try {
    await axios.get(
      `${GH_API}/repos/${GH_OWNER}/${repoName}`,
      { headers: ghHeaders }
    );
    return true;
  } catch (e) {
    if (e.response?.status === 404) return false;
    throw e;
  }
}

// ─── Get file SHA (needed to update existing file) ────────
async function getFileSha(repoName, filePath) {
  try {
    const res = await axios.get(
      `${GH_API}/repos/${GH_OWNER}/${repoName}/contents/${filePath}`,
      { headers: ghHeaders }
    );
    return res.data.sha || null;
  } catch (e) {
    return null;
  }
}

// ─── Push file (create or update) ────────────────────────
async function pushFile(repoName, filePath, content, message = 'Add file', alreadyBase64 = false) {
  const encoded = alreadyBase64
    ? content
    : Buffer.from(content, 'utf8').toString('base64');

  const sha = await getFileSha(repoName, filePath);
  const body = { message, content: encoded };
  if (sha) body.sha = sha;

  await axios.put(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/contents/${filePath}`,
    body,
    { headers: ghHeaders }
  );
}

// ─── Push multiple files ──────────────────────────────────
async function pushFiles(repoName, files) {
  for (const file of files) {
    await pushFile(repoName, file.path, file.content, `Add ${file.path}`, file.alreadyBase64 === true);
  }
}

// ─── Trigger workflow ─────────────────────────────────────
async function triggerWorkflow(repoName, workflowFile = 'build.yml', inputs = {}) {
  await axios.post(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/workflows/${workflowFile}/dispatches`,
    { ref: 'main', inputs },
    { headers: ghHeaders }
  );
}

// ─── Get latest workflow run ──────────────────────────────
async function getLatestRun(repoName) {
  const res = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/runs?per_page=1`,
    { headers: ghHeaders }
  );
  return res.data.workflow_runs?.[0] || null;
}

// ─── Get workflow run status ──────────────────────────────
async function getRunStatus(repoName, runId) {
  const res = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/runs/${runId}`,
    { headers: ghHeaders }
  );
  return res.data;
}

// ─── Get artifact info (ID + download URL) ───────────────
async function getArtifactUrl(repoName, runId, artifactName = 'release-apk') {
  const res = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/runs/${runId}/artifacts`,
    { headers: ghHeaders }
  );
  const artifacts = res.data.artifacts || [];
  const artifact = artifacts.find(a => a.name === artifactName) || artifacts[0];
  if (!artifact) return null;
  return {
    artifactId:  artifact.id,
    downloadUrl: artifact.archive_download_url,
    name:        artifact.name,
    expiresAt:   artifact.expires_at
  };
}

// ─── Download artifact zip buffer ────────────────────────
async function downloadArtifact(repoName, runId, artifactName = 'release-apk') {
  const res = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/runs/${runId}/artifacts`,
    { headers: ghHeaders }
  );
  const artifacts = res.data.artifacts || [];
  const artifact = artifacts.find(a => a.name === artifactName) || artifacts[0];
  if (!artifact) return null;

  const dlRes = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/artifacts/${artifact.id}/zip`,
    { headers: ghHeaders, responseType: 'arraybuffer', maxRedirects: 5 }
  );
  return dlRes.data;
}

// ─── Delete repo ──────────────────────────────────────────
async function deleteRepo(repoName) {
  try {
    await axios.delete(
      `${GH_API}/repos/${GH_OWNER}/${repoName}`,
      { headers: ghHeaders }
    );
  } catch (e) {
    console.warn(`[GitHub] Could not delete repo ${repoName}:`, e.message);
  }
}

module.exports = {
  createRepo,
  repoExists,
  getFileSha,
  pushFile,
  pushFiles,
  triggerWorkflow,
  getLatestRun,
  getRunStatus,
  getArtifactUrl,
  downloadArtifact,
  deleteRepo
};
