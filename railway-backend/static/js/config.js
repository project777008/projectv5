// ════════════════════════════════════════════════════════════
//  config.js — OD System Configuration
//  Option 2: Frontend + Backend on same Railway URL
//  API_BASE is empty string — all /api/* calls go to same server
// ════════════════════════════════════════════════════════════

// ⚡ Same origin — no URL needed!
// Frontend is served by Flask itself, so /api/... calls
// automatically go to the same Railway server.
const API_BASE = '';

// ─── Firebase Project Config ───────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDutDZHHlYxZyEBjZhZGyw_O3DDE1VCXgk',
  authDomain:        'od-system-4c5df.firebaseapp.com',
  projectId:         'od-system-4c5df',
  storageBucket:     'od-system-4c5df.firebasestorage.app',
  messagingSenderId: '1031961433512',
  appId:             '1:1031961433512:web:ebb2681e1e3803b3a5799d',
  measurementId:     'G-8C4KHQE6F0'
};

// ─── Debug logging ─────────────────────────────────────────
const IS_DEV = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1'
);

function devLog(...args) {
  if (IS_DEV) console.log('[OD-DEV]', ...args);
}

devLog('Mode: Option 2 (same-origin — Flask serves frontend)');
devLog('API_BASE:', API_BASE || '(same origin)');
