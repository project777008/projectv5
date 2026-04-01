// ════════════════════════════════════════════════════════════
//  auth.js — Login, logout, session
//  Login now calls Flask /api/login (bcrypt verified server-side).
//  NO direct Firestore password reads. NO plain-text passwords.
//  Session stored in memory only (window._currentUser).
// ════════════════════════════════════════════════════════════

// Session state — kept in memory, not localStorage
window._currentUser   = null;
window._currentUserId = null; // used by api.js for X-User-Id header

// Firestore unsubscribe handles (cleaned up on logout)
window._unsubPending  = null;
window._unsubTracking = null;
window._unsubHod      = null;

// ─── Boot ─────────────────────────────────────────────────
// Called on page load. Tests Firebase connection, then shows login.
async function boot() {
  try {
    await db.collection('users').limit(1).get();
    document.getElementById('fb-status-badge').classList.remove('connecting');
    document.getElementById('fb-status-text').textContent = 'Firebase Connected';
    devLog('Firebase connection OK');
  } catch (e) {
    document.getElementById('fb-status-badge').style.background = '#fde8e3';
    document.getElementById('fb-status-text').textContent = 'Firebase Error';
    devLog('Firebase connection FAILED:', e.message);
  }

  // Show first-run setup panel if admin hasn't been configured yet
  await checkFirstRunSetup();

  _hideOverlay();
}

function _hideOverlay() {
  const ov = document.getElementById('loading-overlay');
  ov.classList.add('hidden');
  setTimeout(() => { ov.style.display = 'none'; }, 500);
  document.getElementById('login-screen').style.display = 'flex';
}

// ─── First-Run Setup Check ─────────────────────────────────
// Calls /api/health; if admin doesn't exist yet, shows setup panel.
async function checkFirstRunSetup() {
  try {
    const health = await api.health();
    if (health.needsSetup) {
      document.getElementById('setup-panel').style.display = 'block';
      document.getElementById('login-panel').style.display = 'none';
    }
  } catch (_) {
    // If health check fails, just show login normally
  }
}

// ─── First-Run Admin Setup ─────────────────────────────────
async function doSetup() {
  const adminId  = document.getElementById('setup-admin-id').value.trim();
  const pass     = document.getElementById('setup-pass').value;
  const confirm  = document.getElementById('setup-confirm').value;
  const err      = document.getElementById('setup-error');
  const btn      = document.getElementById('setup-btn');

  err.style.display = 'none';

  if (!adminId || !pass || !confirm) {
    showError(err, 'Please fill in all fields.'); return;
  }
  if (pass.length < 10) {
    showError(err, 'Password must be at least 10 characters.'); return;
  }
  if (pass !== confirm) {
    showError(err, 'Passwords do not match.'); return;
  }

  btn.disabled    = true;
  btn.textContent = 'Setting up…';

  try {
    await api.adminSetup(adminId, pass);
    toast('Admin account created! Please log in.', 'success');
    document.getElementById('setup-panel').style.display = 'none';
    document.getElementById('login-panel').style.display = 'block';
    document.getElementById('login-id').value = adminId;
  } catch (e) {
    showError(err, e.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Create Admin Account';
  }
}

// ─── Login ─────────────────────────────────────────────────
// All password verification happens on the Flask backend (bcrypt).
// The browser never sees or compares any password hash.
async function doLogin() {
  const id   = document.getElementById('login-id').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err  = document.getElementById('login-error');
  const btn  = document.getElementById('login-btn');

  err.style.display = 'none';
  if (!id || !pass) { showError(err, 'Please fill in all fields.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  try {
    // ✅ Login is verified server-side via bcrypt — not in the browser
    const data = await api.login(id, pass);
    const user = data.user;

    // Store session in memory only
    window._currentUser   = user;
    window._currentUserId = user.id;

    document.getElementById('login-screen').style.display = 'none';
    mountApp();

  } catch (e) {
    // Generic message — don't tell user whether ID or password was wrong
    showError(err, 'Invalid credentials. Please try again.');
    devLog('Login error:', e.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In →';
  }
}

// ─── Logout ────────────────────────────────────────────────
function doLogout() {
  if (window._unsubPending)  { window._unsubPending();  window._unsubPending  = null; }
  if (window._unsubTracking) { window._unsubTracking(); window._unsubTracking = null; }
  if (window._unsubHod)      { window._unsubHod();      window._unsubHod      = null; }

  window._currentUser   = null;
  window._currentUserId = null;

  document.getElementById('app').style.display          = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-id').value             = '';
  document.getElementById('login-pass').value           = '';

  devLog('User logged out');
}

// Enter key on password field
document.getElementById('login-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
