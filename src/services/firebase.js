const admin = require('firebase-admin');

let db = null;

function initFirebase() {
  if (admin.apps.length > 0) return admin.apps[0];

  const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });

  db = admin.firestore();
  console.log('✅ Firebase initialized');
  return admin.apps[0];
}

function getDB() {
  if (!db) initFirebase();
  return db;
}

function getStorage() {
  return admin.storage().bucket();
}

function getAuth() {
  return admin.auth();
}

initFirebase();

module.exports = { getDB, getStorage, getAuth };
