const express = require('express');
const axios = require('axios');
const { requireAuth, requireCredits } = require('../middleware/auth');
const { getDB } = require('../services/firebase');

const router = express.Router();
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── HELPER: Call Groq ────────────────────────────────────
async function callGroq(systemPrompt, userMessage, jsonMode = false) {
  const body = {
    model: 'llama-3.3-70b-versatile',
    max_tokens: jsonMode ? 1500 : 8192,
    temperature: jsonMode ? 0.1 : 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]
  };

  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await axios.post(GROQ_URL, body, {
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  });

  return res.data.choices?.[0]?.message?.content?.trim() || '';
}

// ─── DEDUCT CREDITS ───────────────────────────────────────
async function deductCredits(uid, amount, reason) {
  const db = getDB();
  const ref = db.collection('users').doc(uid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const current = doc.data().credits || 0;
    if (current < amount) throw new Error('Insufficient credits');
    t.update(ref, { credits: current - amount, updatedAt: new Date() });
    t.set(db.collection('transactions').doc(), {
      uid, type: 'debit', amount, reason, createdAt: new Date()
    });
  });
}

// ─── POST /api/ai/generate ────────────────────────────────
router.post('/generate', requireAuth, requireCredits(2), async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || prompt.trim().length < 5)
    return res.status(400).json({ error: 'Please provide a valid app description' });
  if (prompt.length > 1000)
    return res.status(400).json({ error: 'Prompt too long (max 1000 chars)' });

  try {
    const systemPrompt = `You are an expert mobile web developer specializing in Android WebView apps.
Generate a COMPLETE, fully self-contained single HTML file for an Android mobile app.

STRICT RULES:
- Return ONLY raw HTML code — no explanation, no markdown, no backticks, no fences
- Complete valid HTML5 document with <!DOCTYPE html>
- All CSS and JS must be inline (no external CDN except Google Fonts if needed)
- Mobile-optimized: correct viewport meta, touch-friendly targets, no horizontal scroll
- Dark theme UI preferred
- Production-ready and fully functional
- Use correct Web APIs for camera, microphone, geolocation, notifications, Bluetooth, NFC, storage, vibration if needed`;

    const code = await callGroq(systemPrompt, `Build this Android mobile app: ${prompt}`);

    const clean = code
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    if (!clean.includes('<!DOCTYPE') && !clean.includes('<html'))
      return res.status(500).json({ error: 'Invalid response from AI. Please try again.' });

    await deductCredits(req.user.uid, 2, 'AI code generation');

    res.json({ success: true, code: clean, creditsUsed: 2 });

  } catch (err) {
    console.error('[AI Generate]', err.message);
    if (err.message === 'Insufficient credits')
      return res.status(402).json({ error: 'Insufficient credits' });
    res.status(500).json({ error: 'AI generation failed. Please try again.' });
  }
});

// ─── POST /api/ai/analyze-perms ───────────────────────────
router.post('/analyze-perms', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code || code.trim().length < 10)
    return res.status(400).json({ error: 'No code provided' });

  try {
    const systemPrompt = `You are an Android developer expert. Analyze HTML/JavaScript code and determine which Android manifest permissions are needed.
Return ONLY valid JSON with this exact format:
{"reason":"brief 1-2 line explanation","permissions":[{"id":"ANDROID_PERMISSION_ID","name":"Human Readable Name","level":"normal|dangerous","reason":"why needed"}]}

Valid Android permission IDs:
INTERNET, CAMERA, RECORD_AUDIO, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION,
READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, VIBRATE, USE_BIOMETRIC, NFC,
BLUETOOTH, BLUETOOTH_CONNECT, BLUETOOTH_SCAN, RECEIVE_BOOT_COMPLETED,
POST_NOTIFICATIONS, READ_CONTACTS, WRITE_CONTACTS, CALL_PHONE, SEND_SMS,
READ_PHONE_STATE, FLASHLIGHT, WAKE_LOCK, FOREGROUND_SERVICE

Only include permissions clearly needed by the code.`;

    const raw = await callGroq(
      systemPrompt,
      `Analyze this HTML app and list required Android permissions:\n\n${code.substring(0, 10000)}`,
      true
    );

    let parsed;
    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    if (!parsed.permissions || !Array.isArray(parsed.permissions))
      return res.status(500).json({ error: 'Invalid AI response format.' });

    res.json({ success: true, reason: parsed.reason || '', permissions: parsed.permissions });

  } catch (err) {
    console.error('[AI Analyze]', err.message);
    res.status(500).json({ error: 'Permission analysis failed. Please try again.' });
  }
});

module.exports = router;
