const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { searchFeatures, getFeaturesByIds } = require('../data/featureCatalog');

const router = express.Router();

// ─── GET /api/features/search?q=screen+rotation ───────────
// User type karke feature dhundta hai. Query empty ho to poori catalog return hoti hai.
router.get('/search', requireAuth, (req, res) => {
  const q = req.query.q || '';
  const results = searchFeatures(q);
  res.json({ query: q, count: results.length, features: results });
});

// ─── GET /api/features/list ────────────────────────────────
// Poori catalog, category ke hisaab se grouped — feature-picker UI ke liye
router.get('/list', requireAuth, (req, res) => {
  const all = searchFeatures('');
  const grouped = {};
  for (const f of all) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }
  res.json({ categories: grouped });
});

// ─── POST /api/features/validate ───────────────────────────
// Frontend "Add" click karne se pehle confirm kar sakta hai ki IDs valid hain
// Body: { featureIds: ['exit_confirm', 'qr_scanner'] }
router.post('/validate', requireAuth, (req, res) => {
  const { featureIds = [] } = req.body;
  const matched = getFeaturesByIds(featureIds);
  const matchedIds = matched.map(f => f.id);
  const invalid = featureIds.filter(id => !matchedIds.includes(id));

  // Sab permissions + dependencies jo is combination se add honge — preview ke liye
  const allPermissions = [...new Set(matched.flatMap(f => f.permissions))];
  const allDependencies = [...new Set(matched.flatMap(f => f.gradleDependencies))];

  res.json({
    valid: invalid.length === 0,
    invalidIds: invalid,
    matched: matched.map(f => ({ id: f.id, name: f.name })),
    willAdd: { permissions: allPermissions, gradleDependencies: allDependencies }
  });
});

module.exports = router;
