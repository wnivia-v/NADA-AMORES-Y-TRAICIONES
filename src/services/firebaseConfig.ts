import { initializeApp, type FirebaseApp } from 'firebase/app';

// =============================================================================
// Firebase Configuration — NADA v2
// Graceful fallback when API keys are missing (dev/demo mode)
// =============================================================================

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasValidConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;

if (hasValidConfig) {
  try {
    app = initializeApp(firebaseConfig);
  } catch (e) {
    console.warn('[NADA] Firebase init failed, running in local-only mode:', e);
  }
}

export { app, hasValidConfig };
