// ════════════════════════════════════════════════════════════
//  student.js — Student portal logic
//  OD submission writes directly to Firestore.
//  Tracking uses Firestore onSnapshot for real-time updates.
// ════════════════════════════════════════════════════════════

// ─── Load professor dropdown ───────────────────────────────
async function loadProfessorList() {
  const sel = document.getElementById('od-professor');
  sel.innerHTML = '<option value="">Loading…</option>';

  try {
    const snap  = await db.collection('users').where('role', '==', 'professor').get();
    const profs = snap.docs.map(d => d.data());

    if (profs.length === 0) {
      sel.innerHTML = '<option value="">No professors available</option>';
      return;
    }

    sel.innerHTML = '<option value="">— Select a professor —</option>' +
      profs
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(p => `<option value="${p.id}" data-name="${p.name}">${p.name} (${p.dept || ''})</option>`)
        .join('');

  } catch (e) {
    sel.innerHTML = '<option value="">Failed to load professors</option>';
    devLog('loadProfessorList error:', e);
  }
}

// ─── Tab switcher ──────────────────────────────────────────
function switchStudentTab(tab, el) {
  document.querySelectorAll('#page-student .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('stab-apply').style.display = tab === 'apply' ? 'block' : 'none';
  document.getElementById('stab-track').style.display = tab === 'track' ? 'block' : 'none';
  if (tab === 'track') loadStudentTrackingRealtime();
}

// ─── Submit OD request (writes to Firestore directly) ──────
async function submitOD() {
  const profSel  = document.getElementById('od-professor');
  const profId   = profSel.value;
  const profName = profSel.selectedOptions[0]?.dataset?.name || '';
  const reason   = document.getElementById('od-reason').value.trim();
  const date     = document.getElementById('od-date').value;
  const duration = document.getElementById('od-duration').value;
  const details  = document.getElementById('od-details').value.trim();
  const btn      = document.getElementById('submit-od-btn');
  const user     = window._currentUser;

  if (!profId)          { toast('Please select a professor.', 'error'); return; }
  if (!reason || !date) { toast('Please fill in Reason and Date.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  try {
    const reqId = 'OD' + Date.now();

    await db.collection('od_requests').doc(reqId).set({
      id:               reqId,
      studentId:        user.id,
      studentName:      user.name,
      studentDept:      user.dept,
      assignedProfId:   profId,
      assignedProfName: profName,
      reason, date, duration, details,
      // Status flow: hod_pending → pending → approved / dismissed
      //              hod_pending → hod_rejected (if HOD rejects)
      status:           'hod_pending',
      hodStatus:        'pending',
      profStatus:       null,
      submittedAt:      nowISO(),
      hodProcessedAt:   null,
      hodId:            null,
      hodName:          null,
      professorId:      null,
      professorName:    null,
      processedAt:      null,
      docGenerated:     false
    });

    document.getElementById('od-reason').value    = '';
    document.getElementById('od-details').value   = '';
    document.getElementById('od-date').value      = today();
    document.getElementById('od-professor').value = '';

    toast('OD submitted to HOD for approval!', 'success');

  } catch (e) {
    toast('Failed to submit: ' + e.message, 'error');
    devLog('submitOD error:', e);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Submit to HOD →';
  }
}

// ─── Real-time tracking table ──────────────────────────────
function loadStudentTrackingRealtime() {
  if (window._unsubTracking) { window._unsubTracking(); }

  const tbody = document.getElementById('student-requests-table');
  tbody.innerHTML = '<tr><td colspan="8"><div class="spinner">Loading…</div></td></tr>';

  window._unsubTracking = db.collection('od_requests')
    .where('studentId', '==', window._currentUser.id)
    .onSnapshot(snap => {
      const reqs = snap.docs.map(d => d.data())
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

      if (reqs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📋</div><p>No OD requests submitted yet.</p></div></td></tr>`;
        return;
      }

      tbody.innerHTML = reqs.map(r => {
        const { label, cls } = statusInfo(r.status);
        return `
          <tr>
            <td><code style="font-size:12px;color:var(--muted)">${r.id}</code></td>
            <td style="font-size:13px">${r.assignedProfName || '—'}</td>
            <td style="max-width:180px">${truncate(r.reason)}</td>
            <td>${formatDate(r.date)}</td>
            <td>${r.duration}</td>
            <td style="font-size:12px;color:var(--muted)">${formatDateTime(r.submittedAt)}</td>
            <td><span class="status ${cls}">${label}</span></td>
            <td>
              ${r.status === 'approved'
                ? `<button class="btn btn-blue btn-sm" onclick='viewDocument(${JSON.stringify(r)})'>View Doc</button>`
                : `<span style="color:var(--muted);font-size:13px">—</span>`}
            </td>
          </tr>`;
      }).join('');

    }, e => {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">⚠️</div><p>${e.message}</p></div></td></tr>`;
    });
}
