const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../services/firebase');

const router = express.Router();

// ─── POST /api/payment/submit ─────────────────────────────
// User payment submit karta hai — pending status mein save hoga
router.post('/submit', requireAuth, async (req, res) => {
  const { planName, credits, price, txnRef } = req.body;
  if (!planName || !credits || !price || !txnRef) {
    return res.status(400).json({ error: 'planName, credits, price, txnRef required' });
  }
  const db = getDB();
  try {
    // Check karo pehle yeh txnRef already use nahi hua
    const existing = await db.collection('transactions')
      .where('txnRef', '==', txnRef)
      .limit(1)
      .get();
    if (!existing.empty) {
      return res.status(400).json({ error: 'This Transaction ID already submitted' });
    }

    // User info
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    await db.collection('transactions').add({
      uid:       req.user.uid,
      userName:  userData.name || userData.displayName || '',
      userEmail: userData.email || req.user.email || '',
      planName,
      credits:   Number(credits),
      price:     Number(price),
      paidAmount:Number(price),
      txnRef,
      type:      'credit',
      status:    'pending',
      createdAt: new Date()
    });

    res.json({ success: true, message: 'Payment submitted. Pending admin approval.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit payment' });
  }
});

// ─── GET /api/payment/transactions ───────────────────────
// Logged-in user ki saari transactions return karo
router.get('/transactions', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    let snap;
    try {
      snap = await db.collection('transactions')
        .where('uid', '==', req.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
    } catch (e) {
      // Index missing fallback
      snap = await db.collection('transactions')
        .where('uid', '==', req.user.uid)
        .limit(100)
        .get();
    }

    const transactions = snap.docs.map(d => {
      const data = d.data();
      const txType = data.type || 'credit'; // 'credit', 'build', 'prd', 'debit' etc.

      // Display name logic
      let planName = data.planName || data.description || '';
      if (!planName) {
        if (txType === 'build')   planName = 'APK Build';
        else if (txType === 'prd') planName = 'PRD Generation';
        else if (txType === 'signed_apk') planName = 'Signed APK Build';
        else                       planName = 'Credit Purchase';
      }

      // Credits: debit types show as negative
      const isDebit = txType === 'build' || txType === 'prd' ||
                      txType === 'signed_apk' || txType === 'debit' ||
                      (data.credits && data.credits < 0);
      const credits = data.credits ? Math.abs(data.credits) : 0;

      return {
        id:          d.id,
        type:        txType,
        isDebit:     isDebit,
        planName,
        credits,
        price:       data.price       || 0,
        paidAmount:  data.paidAmount  || data.price || 0,
        txnRef:      data.txnRef      || '',
        status:      data.status      || (isDebit ? 'approved' : 'pending'),
        createdAt:   data.createdAt,
        approvedAt:  data.approvedAt  || null,
      };
    });

    // In-memory sort (fallback ke liye)
    transactions.sort((a, b) => {
      const ta = a.createdAt?._seconds || 0;
      const tb = b.createdAt?._seconds || 0;
      return tb - ta;
    });

    res.json({ transactions });
  } catch (err) {
    console.error('transactions fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
