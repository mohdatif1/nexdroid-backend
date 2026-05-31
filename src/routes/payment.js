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

module.exports = router;
