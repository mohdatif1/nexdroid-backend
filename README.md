# Nexdroid Backend — Setup Guide

## Step 1: Firebase Setup

1. Go to https://console.firebase.google.com
2. Create new project → **nexdroid**
3. Enable **Authentication** → Sign-in methods → Enable **Email/Password** + **Google**
4. Enable **Firestore Database** → Start in production mode
5. Enable **Storage** → Start in production mode

### Get Firebase Service Account Key:
1. Project Settings → Service Accounts
2. Click **Generate new private key** → Download JSON
3. Copy values to `.env`:
   - `FIREBASE_PROJECT_ID` → `project_id`
   - `FIREBASE_PRIVATE_KEY_ID` → `private_key_id`
   - `FIREBASE_PRIVATE_KEY` → `private_key` (keep \n as is)
   - `FIREBASE_CLIENT_EMAIL` → `client_email`
   - `FIREBASE_CLIENT_ID` → `client_id`
   - `FIREBASE_STORAGE_BUCKET` → `project_id.appspot.com`

### Firestore Security Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    match /builds/{buildId} {
      allow read: if request.auth.uid == resource.data.uid;
    }
    match /transactions/{txnId} {
      allow read: if request.auth.uid == resource.data.uid;
    }
  }
}
```

---

## Step 2: GitHub Setup

1. Go to https://github.com/settings/tokens → **Tokens (classic)**
2. Generate new token with scopes:
   - `repo` (full)
   - `workflow`
   - `delete_repo`
3. Copy token → `GITHUB_TOKEN` in `.env`
4. Copy your GitHub username → `GITHUB_USERNAME`

### Add Keystore Secrets to GitHub Account:
These secrets are automatically inherited by all repos created by the token.
Go to https://github.com/settings/secrets/actions (user-level) and add:
- `KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

---

## Step 3: Generate Signing Keystore

```bash
# Generate keystore
keytool -genkey -v \
  -keystore release.keystore \
  -alias nexdroid \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# Encode to base64
base64 -w 0 release.keystore
# Copy the output → KEYSTORE_BASE64 in .env and GitHub secrets
```

---

## Step 4: Gemini API Key

1. Go to https://aistudio.google.com
2. Click **Get API key** → **Create API key**
3. Copy → `GEMINI_API_KEY` in `.env`

---

## Step 5: Deploy to Render

1. Push this repo to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Region:** Singapore (closest to India)
5. Add all environment variables from `.env.example`
6. Deploy!

Your backend URL will be: `https://nexdroid-backend.onrender.com`

---

## Step 6: Update Frontend

Set `BACKEND_URL` in your frontend HTML:
```js
const BACKEND_URL = 'https://nexdroid-backend.onrender.com';
```

---

## Firestore Indexes Required

Create these composite indexes in Firebase Console:
- Collection: `builds` | Fields: `uid ASC, createdAt DESC`
- Collection: `transactions` | Fields: `uid ASC, createdAt DESC`

---

## Credit System

| Action | Credits |
|--------|---------|
| Signup bonus | +3 free |
| AI code generation | -2 |
| APK build | -5 |

### Pricing Packs:
| Pack | Credits | Price |
|------|---------|-------|
| Starter | 10 | ₹49 |
| Pro | 50 | ₹199 |
| Builder | 150 | ₹499 |

Admin approves payments manually via `/api/admin/approve-payment`
