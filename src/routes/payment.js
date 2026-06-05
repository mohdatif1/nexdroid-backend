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


// ─── POST /api/payment/submit ─────────────────────────────
// User transaction ID submit karta hai — admin approval pending
router.post('/submit', requireAuth, async (req, res) => {
  const { planName, credits, price, txnRef } = req.body;
  const uid = req.user.uid;

  if (!txnRef || !txnRef.trim())
    return res.status(400).json({ error: 'Transaction ID required' });
  if (!planName || !credits || !price)
    return res.status(400).json({ error: 'Plan details missing' });
  if (isNaN(credits) || credits <= 0)
    return res.status(400).json({ error: 'Invalid credits amount' });
  if (isNaN(price) || price <= 0)
    return res.status(400).json({ error: 'Invalid price' });

  const db = getDB();
  try {
    // Duplicate txnRef check — same transaction ID dobara submit na ho
    const dupSnap = await db.collection('transactions')
      .where('txnRef', '==', txnRef.trim())
      .limit(1)
      .get();
    if (!dupSnap.empty)
      return res.status(409).json({ error: 'This Transaction ID has already been submitted' });

    // Pending payment save karo
    const txnDoc = await db.collection('transactions').add({
      uid,
      email:     req.user.email || '',
      type:      'credit',
      planName:  planName.trim(),
      credits:   Number(credits),
      price:     Number(price),
      txnRef:    txnRef.trim(),
      isDebit:   false,
      status:    'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[Payment Submit] uid=${uid} plan=${planName} price=${price} txnRef=${txnRef} docId=${txnDoc.id}`);
    res.json({ success: true, message: 'Payment submitted successfully. Credits will be added after admin approval.' });
  } catch (err) {
    console.error('[Payment Submit]', err.message);
    res.status(500).json({ error: 'Failed to submit payment. Please try again.' });
  }
});

// ─── GET /api/payment/plans ───────────────────────────────
// Active plans fetch karo
router.get('/plans', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('plans')
      .where('active', '==', true)
      .orderBy('price', 'asc')
      .get();
    const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ plans });
  } catch (err) {
    // Index missing fallback
    try {
      const snap2 = await db.collection('plans').where('active','==',true).get();
      const plans = snap2.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => (a.price||0)-(b.price||0));
      res.json({ plans });
    } catch(e2) {
      res.status(500).json({ error: 'Failed to fetch plans' });
    }
  }
});

// ─── GET /api/payment/settings ────────────────────────────
// UPI ID + QR image URL fetch karo (frontend ke liye)
router.get('/settings', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const doc = await db.collection('appConfig').doc('paymentSettings').get();
    if (!doc.exists) return res.json({ upiId: '', qrImageUrl: '' });
    const d = doc.data();
    res.json({ upiId: d.upiId || '', qrImageUrl: d.qrImageUrl || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment settings' });
  }
});

module.exports = router;
