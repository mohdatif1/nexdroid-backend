const { getAuth } = require('../services/firebase');
const { getDB } = require('../services/firebase');

// ─── FULL AUTH — token + Firestore user required ──────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = decoded;

    const db = getDB();
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found. Please register first.' });
    }
    req.userData = userDoc.data();
    next();
  } catch (err) {
    console.error('[requireAuth]', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── NEW USER AUTH — token verify karo, Firestore na ho to bhi allow ─
// Sirf /register route ke liye use hoga
async function requireAuthOrNew(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = decoded;

    // Firestore user check — na mile to bhi next() — naya user hai
    const db = getDB();
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    req.userData = userDoc.exists ? userDoc.data() : null;

    next();
  } catch (err) {
    console.error('[requireAuthOrNew]', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── CREDITS CHECK ────────────────────────────────────────
function requireCredits(amount) {
  return (req, res, next) => {
    const userCredits = req.userData?.credits || 0;
    if (userCredits < amount) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: amount,
        available: userCredits
      });
    }
    next();
  };
}

// ─── ADMIN ONLY ───────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.userData?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAuthOrNew, requireCredits, requireAdmin };
