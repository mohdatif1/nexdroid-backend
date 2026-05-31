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
// UPI ID + QR Image URL (no auth needed)
router.get('/settings', async (req, res) => {
  const db = getDB();
  try {
    const doc = await db.collection('settings').doc('payment').get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      upiId:      data.upiId      || '',
      qrImageUrl: data.qrImageUrl || ''
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

module.exports = router;
