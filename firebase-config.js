// ============================================================================
// FILL THIS IN before deploying. See README.md → "Firebase setup" for the
// step-by-step. Everything here is public-safe: Firebase web config keys are
// not secrets — real protection comes from the Firestore/Storage security
// rules (also in the README), which check OWNER_UID below.
// ============================================================================

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Paste your own Firebase Auth UID here after your first sign-in.
// app.js will refuse to load data for anyone whose UID doesn't match this,
// so this is what keeps the deck single-user even though Google sign-in
// is technically open to any Google account.
export const OWNER_UID = "PASTE_YOUR_UID_HERE";
