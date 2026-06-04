const express = require('express');
const { requireAuth, requireAuthOrNew } = require('../middleware/auth');
const { getDB } = require('../services/firebase');

const router = express.Router();

// ─── POST /api/auth/register ──────────────────────────────
// requireAuthOrNew — token verify karo but user na ho to bhi allow karo
router.post('/register', requireAuthOrNew, async (req, res) => {
  const { uid, email, name: tokenName } = req.user;
  const db = getDB();

  try {
    const ref = db.collection('users').doc(uid);
    const existing = await ref.get();

    if (existing.exists) {
      console.log('[Register] User already exists:', uid);
      return res.json({
        success: true,
        user: { uid, email, ...existing.data() }
      });
    }

    // New user — signup bonus Firestore se fetch karo (default 15)
    let signupBonus = 15;
    try {
      const pricingDoc = await db.collection('appConfig').doc('creditPricing').get();
      if (pricingDoc.exists && typeof pricingDoc.data().signupBonus === 'number') {
        signupBonus = pricingDoc.data().signupBonus;
      }
    } catch (e) {
      console.warn('[Register] Could not fetch signupBonus, using default 15');
    }

    const userData = {
      uid,
      email,
      name: req.body.name || tokenName || email.split('@')[0],
      credits: signupBonus,
      totalBuilds: 0,
      aiGenerated: 0,
      isAdmin: false,
      plan: 'free',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await ref.set(userData);

    // Signup bonus transaction log
    await db.collection('transactions').doc().set({
      uid,
      type:      'credit',
      planName:  'Signup Bonus',
      credits:   signupBonus,
      isDebit:   false,
      status:    'approved',
      createdAt: new Date()
    });

    console.log(`[Register] New user created: ${uid} — ${signupBonus} credits given`);
    res.json({ success: true, user: userData });

  } catch (err) {
    console.error('[Auth Register]', err.message);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const data = req.userData;
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    name: data.name,
    credits: data.credits || 0,
    totalBuilds: data.totalBuilds || 0,
    aiGenerated: data.aiGenerated || 0,
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
