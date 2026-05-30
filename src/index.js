require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const aiRoutes = require('./routes/ai');
const buildRoutes = require('./routes/build');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

// Stricter limit for AI routes
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 5,
  message: { error: 'AI rate limit exceeded. Wait a moment.' }
});
app.use('/api/ai/', aiLimiter);

// ─── ROUTES ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/build', buildRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Nexdroid Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ─── ERROR HANDLER ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Nexdroid backend running on port ${PORT}`);
});
