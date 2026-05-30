const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../services/firebase');

const router = express.Router();

// ─── POST /api/auth/register ──────────────────────────────
// Called after Firebase signup to create Firestore user doc
router.post('/register', requireAuth, async (req, res) => {
  const { uid, email, name } = req.user;
  const db = getDB();

  try {
    const ref = db.collection('users').doc(uid);
    const existing = await ref.get();

    if (existing.exists) {
      // Already registered — return existing data
      return res.json({
        success: true,
        user: { uid, email, ...existing.data() }
      });
    }

    // New user — give 3 free credits
    const userData = {
      uid,
      email,
      name: req.body.name || name || email.split('@')[0],
      credits: 3,
      totalBuilds: 0,
      isAdmin: false,
      plan: 'free',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await ref.set(userData);

    // Log bonus credits
    await db.collection('transactions').doc().set({
      uid,
      type: 'credit',
      amount: 3,
      reason: 'Signup bonus',
      createdAt: new Date()
    });

    res.json({ success: true, user: userData });
  } catch (err) {
    console.error('[Auth Register]', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const data = req.userData;
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    name: data.name,
    credits: data.credits,
    totalBuilds: data.totalBuilds || 0,
    plan: data.plan || 'free',
    isAdmin: data.isAdmin || false
  });
});

// ─── GET /api/auth/credits ────────────────────────────────
router.get('/credits', requireAuth, async (req, res) => {
  res.json({ credits: req.userData.credits || 0 });
});

// ─── GET /api/auth/transactions ───────────────────────────
router.get('/transactions', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('transactions')
      .where('uid', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const txns = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt
    }));
    res.json({ transactions: txns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
