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
      { role: 'user',   content: userMessage  }
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
    const doc  = await t.get(ref);
    const current = doc.data().credits || 0;
    if (current < amount) throw new Error('Insufficient credits');
    t.update(ref, { credits: current - amount, updatedAt: new Date() });
    t.set(db.collection('transactions').doc(), {
      uid, type: 'debit', amount, reason, createdAt: new Date()
    });
  });
}

// ─── FETCH SETTINGS (masterPrompt + safetyPrompt) ─────────
async function fetchAiSettings() {
  try {
    const db  = getDB();
    const doc = await db.collection('settings').doc('ai').get();
    return doc.exists ? doc.data() : {};
  } catch (e) {
    console.warn('[AI Settings] fetch failed:', e.message);
    return {};
  }
}

// ─── FETCH PRD TEMPLATE from Firestore ────────────────────
async function fetchPrdTemplate(category) {
  try {
    const db  = getDB();
    const doc = await db.collection('prd_templates').doc(category).get();
    if (doc.exists && doc.data().template) return doc.data().template;
    // Fallback to 'custom' template
    const fallback = await db.collection('prd_templates').doc('custom').get();
    return fallback.exists ? fallback.data().template || '' : '';
  } catch (e) {
    console.warn('[PRD Template] fetch failed:', e.message);
    return '';
  }
}

// ─── FILL PRD TEMPLATE with user details ──────────────────
function fillPrdTemplate(template, userDetails) {
  if (!template) return '';
  const {
    appName          = 'My App',
    category         = 'utility',
    theme            = 'dark',
    authType         = 'none',
    storageType      = 'local',
    features         = [],
    downloadEnabled  = false,
    storageKeys      = {},
    extraNotes       = ''
  } = userDetails;

  const themeMap = {
    dark:          'Dark Mode — deep black/navy backgrounds (#0a0a0a, #1a1a2e), light text, subtle glows',
    light:         'Light Mode — white/gray backgrounds (#ffffff, #f5f5f5), dark text',
    colorful:      'Vibrant Colorful — bright gradient backgrounds, bold accent colors',
    minimal:       'Ultra Minimal — pure white, maximum whitespace, black accents only',
    gradient:      'Gradient Theme — purple-to-blue gradient backgrounds, glowing elements',
    glassmorphism: 'Glassmorphism — frosted glass cards, blur effects, translucent overlays'
  };

  const authMap = {
    none:      'No authentication — app opens directly to main screen',
    emailpass: 'Email + Password login/signup with form validation',
    pin:       '4-digit PIN entry screen on launch with shake animation on wrong PIN',
    google:    'Google Sign-In button with OAuth flow (simulated UI)',
    biometric: 'Fingerprint/Biometric authentication screen with animated scanner UI',
    phone:     'Phone number input + OTP verification screen'
  };

  const storageMap = {
    local:    'localStorage — offline-first, no external dependencies',
    firebase: 'Firebase Firestore + Firebase Auth',
    supabase: 'Supabase PostgreSQL database + Supabase Auth',
    rest:     'Custom REST API backend',
    none:     'No persistent storage required'
  };

  // Build storage keys section
  let storageKeysSection = '';
  if (Object.keys(storageKeys).length > 0) {
    storageKeysSection = '\n### Storage Credentials\n';
    Object.entries(storageKeys).forEach(([k, v]) => {
      storageKeysSection += `- ${k}: ${v}\n`;
    });
    storageKeysSection += '> Use these exact values in code — do NOT use placeholders.\n';
  }

  // Build features section
  const featuresSection = features.length > 0
    ? features.map(f => `- ${f}`).join('\n')
    : '- Basic app functionality';

  const replacements = {
    '{{APP_NAME}}':           appName,
    '{{CATEGORY}}':           category,
    '{{THEME}}':              themeMap[theme]      || theme,
    '{{AUTH_TYPE}}':          authMap[authType]    || authType,
    '{{STORAGE_TYPE}}':       storageMap[storageType] || storageType,
    '{{FEATURES_LIST}}':      featuresSection,
    '{{DOWNLOAD_FEATURE}}':   downloadEnabled ? 'YES — implement full download system (DownloadManager pattern, real file formats, progress indicator)' : 'NO',
    '{{STORAGE_KEYS}}':       storageKeysSection,
    '{{EXTRA_NOTES}}':        extraNotes || 'None',
    '{{PLATFORM}}':           'Android WebView (single HTML file)',
  };

  let filled = template;
  Object.entries(replacements).forEach(([placeholder, value]) => {
    filled = filled.split(placeholder).join(value);
  });
  return filled;
}

// ─── SAFETY CHECK ─────────────────────────────────────────
function serverSafetyCheck(input, settings) {
  const text = input.toLowerCase();

  // Blocked keywords check
  const keywords = settings.blockedKeywords || [];
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) {
      return { blocked: true, reason: `Blocked keyword detected: "${kw}"` };
    }
  }

  // Blocked categories pattern check
  const categoryPatterns = {
    hacking:  ['hack', 'crack', 'exploit', 'bypass', 'brute force', 'ddos', 'sql injection'],
    phishing: ['phish', 'fake login', 'credential harvest', 'clone site', 'fake bank'],
    spyware:  ['spy', 'hidden camera', 'keylog', 'stalk', 'monitor without', 'secret record'],
    malware:  ['virus', 'worm', 'trojan', 'ransomware', 'malware', 'botnet'],
    adult:    ['porn', 'adult content', 'nsfw', 'nude', 'xxx', 'explicit content'],
    gambling: ['illegal bet', 'illegal gambl', 'casino hack', 'bet fraud'],
    weapon:   ['bomb', 'weapon guide', 'gun illegal', 'explosiv'],
    fraud:    ['fake upi', 'fake payment', 'money launder', 'ponzi'],
    privacy:  ['steal data', 'harvest email without', 'scrape personal'],
    drug:     ['drug deal', 'buy drugs', 'sell drugs']
  };

  const blockedCats = settings.blockedCategories || [];
  for (const cat of blockedCats) {
    const patterns = categoryPatterns[cat] || [];
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        return { blocked: true, reason: `Category "${cat}" is not allowed: "${pattern}" detected` };
      }
    }
  }

  return { blocked: false };
}

// ─── LOG VIOLATION ────────────────────────────────────────
async function logViolation(uid, input, reason) {
  try {
    const db = getDB();
    await db.collection('violations').add({
      userId: uid, input, reason,
      createdAt: new Date()
    });
  } catch (e) {
    console.warn('[Violation Log]', e.message);
  }
}

// ─── POST /api/ai/generate ────────────────────────────────
router.post('/generate', requireAuth, requireCredits(2), async (req, res) => {
  const {
    prompt,
    // Wizard-provided structured data
    appName,
    category      = 'custom',
    theme         = 'dark',
    authType      = 'none',
    storageType   = 'local',
    features      = [],
    downloadEnabled = false,
    storageKeys   = {},
    extraNotes    = ''
  } = req.body;

  if (!prompt || prompt.trim().length < 5)
    return res.status(400).json({ error: 'Please provide a valid app description' });
  if (prompt.length > 50000)
    return res.status(400).json({ error: 'Prompt too long (max 50000 chars)' });

  try {
    // 1. Fetch admin settings (masterPrompt + safetyPrompt + rules)
    const settings = await fetchAiSettings();

    // 2. Server-side safety check
    const safetyInput = `${appName || ''} ${prompt} ${features.join(' ')} ${extraNotes}`;
    const safetyResult = serverSafetyCheck(safetyInput, settings);
    if (safetyResult.blocked) {
      const action = settings.violationAction || 'block';
      if (action === 'block_and_report') {
        await logViolation(req.user.uid, safetyInput, safetyResult.reason);
      }
      return res.status(403).json({
        error: `BLOCKED: ${safetyResult.reason}`,
        blocked: true
      });
    }

    // 3. Fetch PRD template for this category
    const prdTemplate = await fetchPrdTemplate(category);

    // 4. Fill PRD template with user's details
    const filledPrd = prdTemplate
      ? fillPrdTemplate(prdTemplate, {
          appName: appName || prompt.substring(0, 40),
          category, theme, authType, storageType,
          features, downloadEnabled, storageKeys, extraNotes
        })
      : null;

    // 5. Build system prompt
    // Base coding rules
    const baseCodingRules = `You are an expert mobile web developer specializing in Android WebView apps.
Generate a COMPLETE, fully self-contained single HTML file for an Android mobile app.

STRICT RULES:
- Return ONLY raw HTML code — no explanation, no markdown, no backticks, no fences
- Complete valid HTML5 document with <!DOCTYPE html>
- All CSS and JS must be inline (no external CDN except Google Fonts if needed)
- Mobile-optimized: correct viewport meta, touch-friendly targets (min 44px), no horizontal scroll
- Production-ready, fully functional, no placeholder content
- Use correct Web APIs for camera, microphone, geolocation, notifications, Bluetooth, NFC, storage, vibration if needed
- Smooth CSS animations, proper loading states, error handling on every operation
- Never use alert(), confirm(), or prompt() — use custom UI modals instead`;

    // Inject safety prompt at highest priority
    const safetySection = settings.safetyPrompt
      ? `\nSAFETY RULES (highest priority — non-negotiable):\n${settings.safetyPrompt}\n`
      : '';

    // Inject master prompt (global quality rules)
    const masterSection = settings.masterPrompt
      ? `\nGLOBAL QUALITY STANDARDS (mandatory):\n${settings.masterPrompt}\n`
      : '';

    const systemPrompt = safetySection + baseCodingRules + masterSection;

    // 6. Build user message
    // If PRD available — send structured PRD, else fallback to prompt
    let userMessage;
    if (filledPrd) {
      userMessage = `Build this Android mobile app based on the following PRD:\n\n${filledPrd}\n\nAdditional user description: ${prompt}`;
    } else {
      userMessage = `Build this Android mobile app: ${prompt}`;
    }

    // 7. Call Groq
    const code = await callGroq(systemPrompt, userMessage);

    const clean = code
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    if (!clean.includes('<!DOCTYPE') && !clean.includes('<html'))
      return res.status(500).json({ error: 'Invalid response from AI. Please try again.' });

    // 8. Check if AI blocked the request
    if (clean.startsWith('BLOCKED:')) {
      const reason = clean.replace('BLOCKED:', '').trim();
      await logViolation(req.user.uid, safetyInput, reason);
      return res.status(403).json({ error: `BLOCKED: ${reason}`, blocked: true });
    }

    // 9. Deduct credits
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
READ_PHONE_STATE, FLASHLIGHT, WAKE_LOCK, FOREGROUND_SERVICE, DOWNLOAD_WITHOUT_NOTIFICATION

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

// ─── GET /api/ai/prd-templates ────────────────────────────
// Fetch all PRD templates — auth required (admin only in practice)
router.get('/prd-templates', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const snap = await db.collection('prd_templates')
      .orderBy('updatedAt', 'desc')
      .get();
    const templates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[PRD Templates GET]', err.message);
    // Always return JSON even on error
    res.status(500).json({ error: 'Failed to fetch PRD templates: ' + err.message });
  }
});

// ─── GET /api/ai/prd-templates/:category ──────────────────
// Fetch single PRD template by category
router.get('/prd-templates/:category', requireAuth, async (req, res) => {
  const { category } = req.params;
  const db = getDB();
  try {
    const doc = await db.collection('prd_templates').doc(category).get();
    if (!doc.exists) {
      return res.json({ success: true, template: null });
    }
    res.json({ success: true, template: { id: doc.id, ...doc.data() } });
  } catch (err) {
    console.error('[PRD Template GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch PRD template: ' + err.message });
  }
});

// ─── POST /api/ai/prd-templates/:category ─────────────────
// Admin: save/update a PRD template
router.post('/prd-templates/:category', requireAuth, async (req, res) => {
  const { category } = req.params;
  const { name, template } = req.body;
  if (!template) return res.status(400).json({ error: 'Template content required' });

  const db = getDB();
  try {
    await db.collection('prd_templates').doc(category).set({
      name:      name || category,
      template,
      updatedAt: new Date(),
      updatedBy: req.user.uid
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error('[PRD Template POST]', err.message);
    res.status(500).json({ error: 'Failed to save PRD template: ' + err.message });
  }
});

// Catch-all JSON error handler for this router
router.use((err, req, res, next) => {
  console.error('[AI Route Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'AI route error' });
});

module.exports = router;
