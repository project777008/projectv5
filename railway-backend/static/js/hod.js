// ════════════════════════════════════════════════════════════
//  hod.js — HOD dashboard logic
//  Pending uses onSnapshot (real-time).
//  History uses one-time get().
// ════════════════════════════════════════════════════════════

function switchHodTab(tab, el) {
  document.querySelectorAll('#page-hod .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('htab-pending').style.display = tab === 'pending' ? 'block' : 'none';
  document.getElementById('htab-history').style.display = tab === 'history' ? 'block' : 'none';
  if (tab === 'history') loadHodHistory();
}

// ─── Pending requests (real-time) ─────────────────────────
function loadHodPendingRealtime() {
  if (window._unsubHod) { window._unsubHod(); }

  const container = document.getElementById('hod-pending-cards');
  container.innerHTML = '<div class="spinner">Loading pending requests…</div>';

  window._unsubHod = db.collection('od_requests')
    .where('status', '==', 'hod_pending')
    .onSnapshot(snap => {
      const reqs = snap.docs.map(d => d.data())
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

      document.getElementById('hod-pending-count').textContent = reqs.length;

      if (reqs.length === 0) {
        container.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>No pending applications. All caught up!</p></div>';
        return;
      }

      container.innerHTML = reqs.map(r => `
        <div class="card" style="border-left:4px solid var(--purple)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
            <div>
              <div style="font-family:'DM Serif Display',serif;font-size:18px">${r.studentName}</div>
              <div style="color:var(--muted);font-size:13px">${r.studentId} · ${r.studentDept || 'N/A'}</div>
            </div>
            <span class="status hod_pending">Awaiting HOD</span>
          </div>
          <div style="background:var(--cream);border-radius:var(--radius);padding:16px;margin-bottom:16px;font-size:14px">
            <div style="font-weight:600;margin-bottom:8px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em">Reason</div>
            <div>${r.reason}</div>
            ${r.details ? `<div style="margin-top:8px;color:var(--muted);font-size:13px">${r.details}</div>` : ''}
          </div>
          <div style="display:flex;gap:24px;margin-bottom:20px;font-size:13px;color:var(--muted)">
            <span>📅 <strong style="color:var(--ink)">${formatDate(r.date)}</strong></span>
            <span>⏱ <strong style="color:var(--ink)">${r.duration}</strong></span>
            <span>👨‍🏫 To: <strong style="color:var(--ink)">${r.assignedProfName || '—'}</strong></span>
            <span>📨 Submitted ${formatDateTime(r.submittedAt)}</span>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-green btn-sm" onclick="hodProcess('${r.id}','hod_approved')">✓ Approve & Forward to Professor</button>
            <button class="btn btn-red btn-sm"   onclick="hodProcess('${r.id}','hod_rejected')">✕ Reject</button>
          </div>
        </div>
      `).join('');

    }, e => {
      container.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
    });
}

// ─── HOD approve / reject ─────────────────────────────────
async function hodProcess(id, action) {
  try {
    const newStatus = action === 'hod_approved' ? 'pending' : 'hod_rejected';

    await db.collection('od_requests').doc(id).update({
      status:         newStatus,
      hodStatus:      action === 'hod_approved' ? 'approved' : 'rejected',
      hodProcessedAt: nowISO(),
      hodId:          window._currentUser.id,
      hodName:        window._currentUser.name
    });

    toast(
      action === 'hod_approved' ? 'Approved & forwarded to professor ✓' : 'Application rejected.',
      action === 'hod_approved' ? 'success' : 'info'
    );

  } catch (e) {
    toast('Failed: ' + e.message, 'error');
    devLog('hodProcess error:', e);
  }
}

// ─── History table ─────────────────────────────────────────
async function loadHodHistory() {
  const tbody = document.getElementById('hod-history-table');
  tbody.innerHTML = '<tr><td colspan="8"><div class="spinner">Loading…</div></td></tr>';

  try {
    const snap = await db.collection('od_requests')
      .where('hodStatus', 'in', ['approved', 'rejected'])
      .get();

    const reqs = snap.docs.map(d => d.data())
      .sort((a, b) => new Date(b.hodProcessedAt) - new Date(a.hodProcessedAt));

    if (reqs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📜</div><p>No processed applications yet.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = reqs.map(r => {
      const hodDecision = r.hodStatus === 'approved' ? 'approved' : 'dismissed';
      const profSt      = r.status === 'approved' ? 'approved' : r.status === 'dismissed' ? 'dismissed' : 'pending';
      return `
        <tr>
          <td><code style="font-size:12px;color:var(--muted)">${r.id}</code></td>
          <td>${r.studentName}<div style="color:var(--muted);font-size:11px">${r.studentId}</div></td>
          <td style="font-size:13px">${r.assignedProfName || '—'}</td>
          <td style="max-width:150px">${truncate(r.reason, 40)}</td>
          <td>${formatDate(r.date)}</td>
          <td><span class="status ${hodDecision}">${capitalize(r.hodStatus || '')}</span></td>
          <td>${r.hodStatus === 'approved'
            ? `<span class="status ${profSt}">${profSt === 'approved' ? 'Approved' : profSt === 'dismissed' ? 'Dismissed' : 'Pending'}</span>`
            : '<span style="color:var(--muted);font-size:13px">—</span>'}</td>
          <td style="font-size:12px;color:var(--muted)">${formatDateTime(r.hodProcessedAt)}</td>
        </tr>`;
    }).join('');

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">⚠️</div><p>${e.message}</p></div></td></tr>`;
  }
}
