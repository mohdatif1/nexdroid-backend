const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDB } = require('../services/firebase');

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── GET /api/admin/stats ─────────────────────────────────
router.get('/stats', async (req, res) => {
  const db = getDB();
  try {
    const [usersSnap, buildsSnap, txnSnap] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('builds').count().get(),
      db.collection('transactions').where('type', '==', 'credit').get()
    ]);

    const totalRevenue = txnSnap.docs.reduce((sum, d) => {
      const data = d.data();
      return sum + (data.paidAmount || 0);
    }, 0);

    res.json({
      totalUsers: usersSnap.data().count,
      totalBuilds: buildsSnap.data().count,
      totalRevenue
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────
router.get('/users', async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('users')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── POST /api/admin/add-credits ──────────────────────────
router.post('/add-credits', async (req, res) => {
  const { uid, amount, reason } = req.body;
  if (!uid || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid uid or amount' });
  }
  const db = getDB();
  try {
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const current = doc.data().credits || 0;
    await ref.update({ credits: current + amount, updatedAt: new Date() });
    await db.collection('transactions').doc().set({
      uid, type: 'credit', amount,
      reason: reason || 'Admin credit',
      addedBy: req.user.uid,
      createdAt: new Date()
    });

    res.json({ success: true, newBalance: current + amount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add credits' });
  }
});

// ─── POST /api/admin/subtract-credits ─────────────────────
router.post('/subtract-credits', async (req, res) => {
  const { uid, amount, reason } = req.body;
  if (!uid || !amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid uid or amount' });
  const db = getDB();
  try {
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const current = doc.data().credits || 0;
    const newBal  = Math.max(0, current - amount);
    await ref.update({ credits: newBal, updatedAt: new Date() });
    await db.collection('transactions').doc().set({
      uid, type: 'debit', amount,
      reason: reason || 'Admin debit',
      addedBy: req.user.uid,
      createdAt: new Date()
    });

    res.json({ success: true, newBalance: newBal });
  } catch (err) {
    res.status(500).json({ error: 'Failed to subtract credits' });
  }
});

// ─── POST /api/admin/set-credits ──────────────────────────
router.post('/set-credits', async (req, res) => {
  const { uid, amount, reason } = req.body;
  if (!uid || typeof amount !== 'number' || amount < 0)
    return res.status(400).json({ error: 'Invalid uid or amount' });
  const db = getDB();
  try {
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    await ref.update({ credits: amount, updatedAt: new Date() });
    await db.collection('transactions').doc().set({
      uid, type: 'set', amount,
      reason: reason || 'Admin set credits',
      addedBy: req.user.uid,
      createdAt: new Date()
    });

    res.json({ success: true, newBalance: amount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set credits' });
  }
});

// ─── GET /api/admin/builds ────────────────────────────────
router.get('/builds', async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('builds')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const builds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ builds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch builds' });
  }
});

// ─── GET /api/admin/plans ─────────────────────────────────
router.get('/plans', async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('plans').orderBy('createdAt', 'asc').get();
    const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// ─── POST /api/admin/plans ────────────────────────────────
router.post('/plans', async (req, res) => {
  const { name, price, credits } = req.body;
  if (!name || price === undefined || !credits || credits < 1) {
    return res.status(400).json({ error: 'name, price, and credits are required' });
  }
  const db = getDB();
  try {
    const ref = await db.collection('plans').add({
      name,
      price: Number(price),
      credits: Number(credits),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user.uid
    });
    res.json({ success: true, id: ref.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// ─── PUT /api/admin/plans/:planId ─────────────────────────
router.put('/plans/:planId', async (req, res) => {
  const { planId } = req.params;
  const { name, price, credits } = req.body;
  if (!name || price === undefined || !credits || credits < 1) {
    return res.status(400).json({ error: 'name, price, and credits are required' });
  }
  const db = getDB();
  try {
    const ref = db.collection('plans').doc(planId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Plan not found' });
    await ref.update({
      name,
      price: Number(price),
      credits: Number(credits),
      updatedAt: new Date(),
      updatedBy: req.user.uid
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// ─── DELETE /api/admin/plans/:planId ──────────────────────
router.delete('/plans/:planId', async (req, res) => {
  const { planId } = req.params;
  const db = getDB();
  try {
    const ref = db.collection('plans').doc(planId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Plan not found' });
    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// ─── GET /api/admin/transactions ──────────────────────────
router.get('/transactions', async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    // User info bhi saath laao
    const txns = await Promise.all(snap.docs.map(async d => {
      const data = d.data();
      let userName = '', userEmail = '';
      try {
        const uDoc = await db.collection('users').doc(data.uid).get();
        if (uDoc.exists) {
          userName  = uDoc.data().name  || uDoc.data().displayName || '';
          userEmail = uDoc.data().email || '';
        }
      } catch(e) {}
      return { id: d.id, ...data, userName, userEmail };
    }));

    res.json({ transactions: txns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ─── POST /api/admin/reject-payment ──────────────────────
router.post('/reject-payment', async (req, res) => {
  const { txnId, reason } = req.body;
  if (!txnId) return res.status(400).json({ error: 'txnId required' });
  const db = getDB();
  try {
    const ref = db.collection('transactions').doc(txnId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Transaction not found' });
    await ref.update({
      status: 'rejected',
      rejectedBy: req.user.uid,
      rejectedAt: new Date(),
      rejectReason: reason || 'Rejected by admin'
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

// ─── POST /api/admin/approve-payment ─────────────────────
router.post('/approve-payment', async (req, res) => {
  const { txnId, uid, credits, paidAmount } = req.body;
  if (!txnId || !uid || !credits) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const db = getDB();
  try {
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const current = doc.data().credits || 0;
    await ref.update({ credits: current + credits, updatedAt: new Date() });
    await db.collection('transactions').doc(txnId).update({
      status: 'approved',
      approvedBy: req.user.uid,
      approvedAt: new Date(),
      paidAmount: paidAmount || 0
    });

    res.json({ success: true, newBalance: current + credits });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve payment' });
  }
});

// ─── GET /api/admin/settings ──────────────────────────────
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
      upiId:             pay.upiId             || '',
      qrImageUrl:        pay.qrImageUrl        || '',
      masterPrompt:      ai.masterPrompt       || '',
      safetyPrompt:      ai.safetyPrompt       || '',
      blockedKeywords:   ai.blockedKeywords    || [],
      blockedCategories: ai.blockedCategories  || [],
      violationAction:   ai.violationAction    || 'block',
      adminEmails:       ai.adminEmails        || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ─── PUT/POST /api/admin/settings ─────────────────────────
// Handles both payment settings AND AI/safety settings
async function handleSaveSettings(req, res) {
  const {
    upiId, qrImageUrl,
    masterPrompt, safetyPrompt,
    blockedKeywords, blockedCategories,
    violationAction, adminEmails
  } = req.body;

  const db = getDB();
  try {
    const batch = db.batch();

    // Payment settings
    const payUpdate = { updatedAt: new Date(), updatedBy: req.user.uid };
    if (upiId        !== undefined) payUpdate.upiId        = upiId;
    if (qrImageUrl   !== undefined) payUpdate.qrImageUrl   = qrImageUrl;
    if (Object.keys(payUpdate).length > 2) {
      batch.set(db.collection('settings').doc('payment'), payUpdate, { merge: true });
    }

    // AI / Safety settings
    const aiUpdate = { updatedAt: new Date(), updatedBy: req.user.uid };
    if (masterPrompt      !== undefined) aiUpdate.masterPrompt      = masterPrompt;
    if (safetyPrompt      !== undefined) aiUpdate.safetyPrompt      = safetyPrompt;
    if (blockedKeywords   !== undefined) aiUpdate.blockedKeywords   = blockedKeywords;
    if (blockedCategories !== undefined) aiUpdate.blockedCategories = blockedCategories;
    if (violationAction   !== undefined) aiUpdate.violationAction   = violationAction;
    if (adminEmails       !== undefined) aiUpdate.adminEmails       = adminEmails;
    if (Object.keys(aiUpdate).length > 2) {
      batch.set(db.collection('settings').doc('ai'), aiUpdate, { merge: true });
    }

    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings Save]', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
}

router.put('/settings',  handleSaveSettings);
router.post('/settings', handleSaveSettings);

// ─── POST /api/admin/log-violation ────────────────────────
router.post('/log-violation', async (req, res) => {
  const { userId, input, reason, ts } = req.body;
  const db = getDB();
  try {
    await db.collection('violations').add({
      userId:    userId    || req.user.uid,
      input:     input     || '',
      reason:    reason    || '',
      ts:        ts        || Date.now(),
      reportedBy: req.user.uid,
      createdAt: new Date()
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Log Violation]', err.message);
    res.status(500).json({ error: 'Failed to log violation' });
  }
});

module.exports = router;
