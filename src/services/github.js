const axios = require('axios');

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_USERNAME;
const GH_API = 'https://api.github.com';

const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

// ─── Create temporary build repo ─────────────────────────
async function createRepo(repoName) {
  const res = await axios.post(`${GH_API}/user/repos`, {
    name: repoName,
    private: true,
    auto_init: false,
    description: 'Nexdroid build repo — auto-generated'
  }, { headers: ghHeaders });
  return res.data;
}

// ─── Push file to repo ────────────────────────────────────
async function pushFile(repoName, filePath, content, message = 'Add file') {
  const encoded = Buffer.from(content).toString('base64');
  await axios.put(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/contents/${filePath}`,
    { message, content: encoded },
    { headers: ghHeaders }
  );
}

// ─── Push multiple files ──────────────────────────────────
async function pushFiles(repoName, files) {
  for (const file of files) {
    await pushFile(repoName, file.path, file.content, `Add ${file.path}`);
  }
}

// ─── Trigger GitHub Actions workflow ─────────────────────
async function triggerWorkflow(repoName, workflowFile = 'build-apk.yml', inputs = {}) {
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

// ─── Download APK artifact ────────────────────────────────
async function downloadArtifact(repoName, runId) {
  // List artifacts
  const res = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/runs/${runId}/artifacts`,
    { headers: ghHeaders }
  );
  const artifacts = res.data.artifacts || [];
  const apkArtifact = artifacts.find(a => a.name === 'release-apk');
  if (!apkArtifact) return null;

  // Download zip
  const dlRes = await axios.get(
    `${GH_API}/repos/${GH_OWNER}/${repoName}/actions/artifacts/${apkArtifact.id}/zip`,
    { headers: ghHeaders, responseType: 'arraybuffer', maxRedirects: 5 }
  );
  return dlRes.data;
}

// ─── Delete repo (cleanup) ────────────────────────────────
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
  pushFile,
  pushFiles,
  triggerWorkflow,
  getLatestRun,
  getRunStatus,
  downloadArtifact,
  deleteRepo
};
