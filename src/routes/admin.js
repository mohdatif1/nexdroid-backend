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
    const doc = await db.collection('settings').doc('payment').get();
    const data = doc.exists ? doc.data() : {};
    res.json({ upiId: data.upiId || '', qrImageUrl: data.qrImageUrl || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ─── PUT /api/admin/settings ──────────────────────────────
router.put('/settings', async (req, res) => {
  const { upiId, qrImageUrl } = req.body;
  if (!upiId && !qrImageUrl) {
    return res.status(400).json({ error: 'upiId or qrImageUrl required' });
  }
  const db = getDB();
  try {
    const update = { updatedAt: new Date(), updatedBy: req.user.uid };
    if (upiId !== undefined)      update.upiId      = upiId;
    if (qrImageUrl !== undefined) update.qrImageUrl = qrImageUrl;
    await db.collection('settings').doc('payment').set(update, { merge: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
