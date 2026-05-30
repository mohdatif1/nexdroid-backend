const { getAuth } = require('../services/firebase');
const { getDB } = require('../services/firebase');

// Verify Firebase ID token
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = decoded;

    // Get user data from Firestore
    const db = getDB();
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.userData = userDoc.data();
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Check user has enough credits
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

// Admin only
function requireAdmin(req, res, next) {
  if (!req.userData?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireCredits, requireAdmin };
