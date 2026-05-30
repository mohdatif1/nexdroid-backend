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

module.exports = router;
