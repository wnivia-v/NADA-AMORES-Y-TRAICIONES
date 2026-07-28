import 'fake-indexeddb/auto';

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_FIREBASE_API_KEY: '',
    VITE_FIREBASE_PROJECT_ID: '',
    VITE_SAFE_BROWSING_API_KEY: '',
    VITE_CLAUDE_API_KEY: '',
    VITE_BEDROCK_ENDPOINT: '',
    VITE_BEDROCK_API_KEY: '',
  },
});

// Mock crypto.randomUUID
if (!globalThis.crypto.randomUUID) {
  (globalThis.crypto as any).randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}
