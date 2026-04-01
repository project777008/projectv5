// ════════════════════════════════════════════════════════════
//  professor.js — Professor dashboard logic
//  Only sees HOD-approved requests assigned to them.
// ════════════════════════════════════════════════════════════

function switchProfTab(tab, el) {
  document.querySelectorAll('#page-professor .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('ptab-pending').style.display = tab === 'pending' ? 'block' : 'none';
  document.getElementById('ptab-history').style.display = tab === 'history' ? 'block' : 'none';
  if (tab === 'history') loadProfHistory();
}

// ─── Pending (real-time) ───────────────────────────────────
function loadProfPendingRealtime() {
  if (window._unsubPending) { window._unsubPending(); }

  const container = document.getElementById('pending-cards');
  container.innerHTML = '<div class="spinner">Loading pending requests…</div>';

  // Only HOD-approved requests assigned to this professor
  window._unsubPending = db.collection('od_requests')
    .where('assignedProfId', '==', window._currentUser.id)
    .where('status', '==', 'pending')
    .onSnapshot(snap => {
      const reqs = snap.docs.map(d => d.data())
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

      document.getElementById('pending-count').textContent = reqs.length;

      if (reqs.length === 0) {
        container.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>No pending applications assigned to you.</p></div>';
        return;
      }

      container.innerHTML = reqs.map(r => `
        <div class="card" style="border-left:4px solid var(--yellow)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
            <div>
              <div style="font-family:'DM Serif Display',serif;font-size:18px">${r.studentName}</div>
              <div style="color:var(--muted);font-size:13px">${r.studentId} · ${r.studentDept || 'N/A'}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <span class="status pending">Pending</span>
              <span style="font-size:11px;color:var(--green);background:var(--green-light);padding:2px 8px;border-radius:100px">✓ HOD Approved</span>
            </div>
          </div>
          <div style="background:var(--cream);border-radius:var(--radius);padding:16px;margin-bottom:16px;font-size:14px">
            <div style="font-weight:600;margin-bottom:8px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em">Reason</div>
            <div>${r.reason}</div>
            ${r.details ? `<div style="margin-top:8px;color:var(--muted);font-size:13px">${r.details}</div>` : ''}
          </div>
          <div style="display:flex;gap:24px;margin-bottom:20px;font-size:13px;color:var(--muted)">
            <span>📅 <strong style="color:var(--ink)">${formatDate(r.date)}</strong></span>
            <span>⏱ <strong style="color:var(--ink)">${r.duration}</strong></span>
            <span>📨 Submitted ${formatDateTime(r.submittedAt)}</span>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-green btn-sm" onclick="processRequest('${r.id}','approved')">✓ Approve</button>
            <button class="btn btn-red btn-sm"   onclick="processRequest('${r.id}','dismissed')">✕ Dismiss</button>
          </div>
        </div>
      `).join('');

    }, e => {
      container.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
    });
}

// ─── Approve / Dismiss ─────────────────────────────────────
async function processRequest(id, action) {
  try {
    await db.collection('od_requests').doc(id).update({
      status:        action,
      profStatus:    action,
      processedAt:   nowISO(),
      professorId:   window._currentUser.id,
      professorName: window._currentUser.name,
      docGenerated:  action === 'approved'
    });

    toast(
      action === 'approved' ? 'OD approved & document generated ✓' : 'OD dismissed.',
      action === 'approved' ? 'success' : 'info'
    );

  } catch (e) {
    toast('Failed: ' + e.message, 'error');
    devLog('processRequest error:', e);
  }
}

// ─── History table ─────────────────────────────────────────
async function loadProfHistory() {
  const tbody = document.getElementById('history-table');
  tbody.innerHTML = '<tr><td colspan="7"><div class="spinner">Loading…</div></td></tr>';

  try {
    const snap = await db.collection('od_requests')
      .where('assignedProfId', '==', window._currentUser.id)
      .where('status', 'in', ['approved', 'dismissed'])
      .get();

    const reqs = snap.docs.map(d => d.data())
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));

    if (reqs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="empty-icon">📜</div><p>No processed applications yet.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = reqs.map(r => `
      <tr>
        <td><code style="font-size:12px;color:var(--muted)">${r.id}</code></td>
        <td>${r.studentName}<div style="color:var(--muted);font-size:11px">${r.studentId}</div></td>
        <td style="max-width:180px">${truncate(r.reason)}</td>
        <td>${formatDate(r.date)}</td>
        <td>${r.duration}</td>
        <td><span class="status ${r.status}">${capitalize(r.status)}</span></td>
        <td style="font-size:12px;color:var(--muted)">${formatDateTime(r.processedAt)}</td>
      </tr>
    `).join('');

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="empty-icon">⚠️</div><p>${e.message}</p></div></td></tr>`;
  }
}
