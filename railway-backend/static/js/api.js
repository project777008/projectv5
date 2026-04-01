// ════════════════════════════════════════════════════════════
//  api.js — All HTTP calls to Flask backend (Railway)
//  Security: X-User-Id header injected here centrally.
//  URL: reads API_BASE from config.js (never hardcoded here).
// ════════════════════════════════════════════════════════════

// ─── Core fetch wrapper ────────────────────────────────────
async function apiFetch(path, options = {}) {
  const userId = window._currentUserId || '';

  const headers = {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
    ...(options.headers || {})
  };

  const url = `${API_BASE}${path}`;
  devLog(`API ${options.method || 'GET'} → ${url}`);

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (networkErr) {
    throw new Error('Cannot reach backend. Check Railway deployment.');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned non-JSON response (status ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(data?.message || `Request failed (${res.status})`);
  }

  devLog(`API response:`, data);
  return data;
}

// ─── Convenience methods ───────────────────────────────────
const api = {

  // ── AUTH ───────────────────────────────────────────────
  // Login is verified server-side via bcrypt. Browser never
  // touches any password hash.
  login(userId, password) {
    return apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ userId, password })
    });
  },

  // First-run: set admin password before any account exists
  adminSetup(adminId, password) {
    return apiFetch('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ adminId, password })
    });
  },

  // ── ADMIN ──────────────────────────────────────────────
  createUser(name, role, dept) {
    return apiFetch('/api/admin/create-user', {
      method: 'POST',
      body: JSON.stringify({ name, role, dept })
    });
  },

  getAllUsers() {
    return apiFetch('/api/admin/users');
  },

  changePassword(currentPassword, newPassword) {
    return apiFetch('/api/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  // ── DOCUMENT (PDF) ─────────────────────────────────────
  async downloadDocument(reqId) {
    const userId = window._currentUserId || '';
    const url    = `${API_BASE}/api/document/${reqId}`;

    devLog('Downloading PDF:', url);

    let res;
    try {
      res = await fetch(url, {
        headers: { 'X-User-Id': userId }
      });
    } catch {
      throw new Error('Cannot reach backend to download document.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Download failed');
    }

    const blob = await res.blob();
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = `OD_Certificate_${reqId}.pdf`;
    link.click();
    URL.revokeObjectURL(link.href);
  },

  // ── HEALTH ─────────────────────────────────────────────
  health() {
    return apiFetch('/api/health');
  }
};
