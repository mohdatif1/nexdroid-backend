/**
 * ===========================================================================
 * FORGOT PASSWORD (OTP via Email) — Express routes for NexDroid backend
 * ===========================================================================
 *
 * WIRING INSTRUCTIONS (Node.js / Express + Firebase Admin + Firestore):
 *
 * 1) Install nodemailer:
 *      npm install nodemailer
 *
 * 2) Add these env vars on Render (Dashboard → Environment):
 *      SMTP_HOST=smtp.gmail.com
 *      SMTP_PORT=465
 *      SMTP_USER=youraddress@gmail.com
 *      SMTP_PASS=your16digitGmailAppPassword   (NOT your normal Gmail password —
 *                generate one at https://myaccount.google.com/apppasswords)
 *      SMTP_FROM="NexDroid <youraddress@gmail.com>"
 *
 *    (Any SMTP provider works — Gmail, Brevo/Sendinblue, Resend, SendGrid, etc.
 *     Just change SMTP_HOST/PORT accordingly.)
 *
 * 3) In your main server file (e.g. index.js / server.js), where you already
 *    do `const admin = require('firebase-admin')` and `const db = admin.firestore()`,
 *    add:
 *
 *      const forgotPasswordRoutes = require('./forgotPassword-routes')(admin, db);
 *      app.use('/api/auth/forgot-password', forgotPasswordRoutes);
 *
 *    This mounts:
 *      POST /api/auth/forgot-password/send-otp
 *      POST /api/auth/forgot-password/verify-otp
 *      POST /api/auth/forgot-password/reset
 *
 *    which is exactly what NexDroid.html calls.
 *
 * 4) Firestore: no manual setup needed — a `passwordResetOtps` collection is
 *    created automatically, keyed by lowercased email. Old docs auto-expire
 *    logically (checked on each request) — for real TTL cleanup you can
 *    optionally add a Firestore TTL policy on the `expiresAt` field.
 *
 * SECURITY NOTES:
 *  - OTP is 6 digits, valid for 5 minutes, max 5 wrong attempts before lockout.
 *  - After OTP verification, a short-lived resetToken (10 min) is issued —
 *    the actual password change requires this token, not just the OTP again.
 *  - Password itself is changed using Firebase Admin SDK (admin.auth().updateUser),
 *    which is why this MUST run on your backend (service account), never client-side.
 *  - Does not reveal whether an email exists or not in send-otp response
 *    (prevents user enumeration) — always returns success-shaped response.
 * ===========================================================================
 */

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

module.exports = function (admin, db) {
  const router = express.Router();

  const OTP_TTL_MS = 5 * 60 * 1000;        // 5 minutes
  const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const MAX_ATTEMPTS = 5;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  function genOtp() {
    return String(crypto.randomInt(100000, 999999)); // 6-digit
  }
  function hashOtp(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }
  function genToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // ── 1) SEND OTP ──────────────────────────────────────────────────────
  router.post('/send-otp', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      // Check the user actually exists in Firebase Auth (silently no-op if not,
      // but still respond success to avoid leaking which emails are registered)
      let userRecord = null;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch (e) {
        // no such user — respond success anyway (don't leak)
      }

      if (userRecord) {
        const otp = genOtp();
        await db.collection('passwordResetOtps').doc(email).set({
          otpHash: hashOtp(otp),
          expiresAt: Date.now() + OTP_TTL_MS,
          attempts: 0,
          verified: false,
          resetToken: null,
          resetTokenExpiresAt: null,
          createdAt: Date.now(),
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: `${otp} is your NexDroid password reset code`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
              <h2 style="color:#3b7eff;margin-bottom:4px">NexDroid</h2>
              <p style="color:#333">Aapka password reset OTP:</p>
              <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111;margin:16px 0">${otp}</div>
              <p style="color:#666;font-size:13px">Ye OTP 5 minute mein expire ho jaayega. Agar aapne ye request nahi ki, is email ko ignore karo.</p>
            </div>`,
        });
      }

      // Always respond success-shaped (prevents email enumeration)
      return res.json({ ok: true, message: 'If this email is registered, an OTP has been sent.' });
    } catch (err) {
      console.error('send-otp error:', err);
      return res.status(500).json({ error: 'Failed to send OTP. Try again.' });
    }
  });

  // ── 2) VERIFY OTP ────────────────────────────────────────────────────
  router.post('/verify-otp', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const otp = String(req.body.otp || '').trim();
      if (!email || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ error: 'Email and 6-digit OTP required' });
      }

      const ref = db.collection('passwordResetOtps').doc(email);
      const snap = await ref.get();
      if (!snap.exists) return res.status(400).json({ error: 'OTP not found. Please request a new one.' });

      const data = snap.data();
      if (Date.now() > data.expiresAt) {
        await ref.delete();
        return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
      }
      if (data.attempts >= MAX_ATTEMPTS) {
        await ref.delete();
        return res.status(429).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
      }
      if (hashOtp(otp) !== data.otpHash) {
        await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
        return res.status(400).json({ error: 'Incorrect OTP' });
      }

      const resetToken = genToken();
      await ref.update({
        verified: true,
        resetToken,
        resetTokenExpiresAt: Date.now() + RESET_TOKEN_TTL_MS,
      });

      return res.json({ ok: true, resetToken });
    } catch (err) {
      console.error('verify-otp error:', err);
      return res.status(500).json({ error: 'Failed to verify OTP. Try again.' });
    }
  });

  // ── 3) RESET PASSWORD ────────────────────────────────────────────────
  router.post('/reset', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const resetToken = String(req.body.resetToken || '').trim();
      const newPassword = String(req.body.newPassword || '');

      if (!email || !resetToken) return res.status(400).json({ error: 'Missing email or reset token' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const ref = db.collection('passwordResetOtps').doc(email);
      const snap = await ref.get();
      if (!snap.exists) return res.status(400).json({ error: 'Reset session not found. Start again.' });

      const data = snap.data();
      if (!data.verified || data.resetToken !== resetToken) {
        return res.status(400).json({ error: 'Invalid or unverified reset session.' });
      }
      if (Date.now() > data.resetTokenExpiresAt) {
        await ref.delete();
        return res.status(400).json({ error: 'Reset session expired. Start again.' });
      }

      const userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(userRecord.uid, { password: newPassword });

      await ref.delete(); // clean up OTP doc

      return res.json({ ok: true, message: 'Password updated successfully.' });
    } catch (err) {
      console.error('reset-password error:', err);
      return res.status(500).json({ error: 'Failed to reset password. Try again.' });
    }
  });

  return router;
};
