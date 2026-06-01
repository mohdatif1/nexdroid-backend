const express = require('express');
const { getDB } = require('../services/firebase');

const router = express.Router();

// ─── GET /api/public/plans ────────────────────────────────
// Frontend pe plans dikhane ke liye (no auth needed)
router.get('/plans', async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('plans').orderBy('createdAt', 'asc').get();
    const plans = snap.docs.map(d => ({
      id:      d.id,
      name:    d.data().name,
      price:   d.data().price,
      credits: d.data().credits
    }));
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// ─── GET /api/public/settings ─────────────────────────────
// Returns: payment config + AI master prompt + safety rules
// No auth needed — frontend loads this on app start
router.get('/settings', async (req, res) => {
  const db = getDB();
  try {
    const [payDoc, aiDoc] = await Promise.all([
      db.collection('settings').doc('payment').get(),
      db.collection('settings').doc('ai').get()
    ]);
    const pay = payDoc.exists ? payDoc.data() : {};
    const ai  = aiDoc.exists  ? aiDoc.data()  : {};
    res.json({
      // Payment
      upiId:             pay.upiId             || '',
      qrImageUrl:        pay.qrImageUrl        || '',
      // AI Prompt
      masterPrompt:      ai.masterPrompt       || '',
      safetyPrompt:      ai.safetyPrompt       || '',
      // Safety Rules
      blockedKeywords:   ai.blockedKeywords    || [],
      blockedCategories: ai.blockedCategories  || [],
      violationAction:   ai.violationAction    || 'block',
      // Admin emails (for frontend admin nav visibility)
      adminEmails:       ai.adminEmails        || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

module.exports = router;
