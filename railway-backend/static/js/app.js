// ════════════════════════════════════════════════════════════
//  app.js — Firebase init + app shell + role routing
//  Reads FIREBASE_CONFIG from config.js
// ════════════════════════════════════════════════════════════

// ─── Firebase init ─────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
devLog('Firebase initialized → project:', FIREBASE_CONFIG.projectId);

// ─── App mount ─────────────────────────────────────────────
// Called after successful login. Sets up nav and routes to role page.
function mountApp() {
  const user = window._currentUser;

  document.getElementById('app').style.display          = 'block';
  document.getElementById('nav-avatar').textContent     = user.name.charAt(0).toUpperCase();
  document.getElementById('nav-name').textContent       = user.name;
  document.getElementById('nav-id-display').textContent = user.id;

  const badge       = document.getElementById('nav-role-badge');
  badge.textContent = user.role === 'hod' ? 'HOD' : capitalize(user.role);
  badge.className   = 'role-badge ' + user.role;

  // Hide all pages, then show the one matching this role
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  if (user.role === 'admin') {
    document.getElementById('page-admin').classList.add('active');
    loadAdminPage();

  } else if (user.role === 'student') {
    document.getElementById('page-student').classList.add('active');
    document.getElementById('od-date').value = today();
    loadProfessorList();

  } else if (user.role === 'hod') {
    document.getElementById('page-hod').classList.add('active');
    loadHodPendingRealtime();

  } else if (user.role === 'professor') {
    document.getElementById('page-professor').classList.add('active');
    loadProfPendingRealtime();

  } else {
    // Unknown role — log out for safety
    devLog('Unknown role:', user.role);
    toast('Unknown role. Contact administrator.', 'error');
    doLogout();
  }
}

// ─── OD Document modal ─────────────────────────────────────
let _viewingDoc = null;

function viewDocument(r) {
  if (typeof r === 'string') r = JSON.parse(r);
  _viewingDoc = r;

  document.getElementById('od-doc-content').innerHTML = `
    <div class="od-doc" id="printable-doc">
      <div class="od-stamp">APPROVED</div>
      <div class="od-doc-header">
        <h2>ON-DUTY CERTIFICATE</h2>
        <p>Department OD Management System</p>
      </div>
      <div class="od-doc-body">
        <p style="margin-bottom:20px">This is to certify that the following student has been granted On-Duty (OD) permission as detailed below:</p>
        <div class="od-doc-field"><span class="od-doc-label">Student Name</span><span>${r.studentName}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">Student ID</span><span>${r.studentId}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">Department</span><span>${r.studentDept || 'N/A'}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">OD Date</span><span>${formatDate(r.date)}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">Duration</span><span>${r.duration}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">Purpose</span><span>${r.reason}</span></div>
        ${r.details ? `<div class="od-doc-field"><span class="od-doc-label">Additional Info</span><span>${r.details}</span></div>` : ''}
        <div class="od-doc-field"><span class="od-doc-label">Reference No.</span><span style="font-family:monospace">${r.id}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">HOD Approved</span><span>${formatDateTime(r.hodProcessedAt)} by ${r.hodName || '—'}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">Submitted</span><span>${formatDateTime(r.submittedAt)}</span></div>
        <div class="od-doc-field"><span class="od-doc-label">Approved On</span><span>${formatDateTime(r.processedAt)}</span></div>
      </div>
      <div class="od-doc-footer">
        <div class="od-signature">
          <div class="signature-line">${r.professorName || r.assignedProfName}</div>
          <div class="sig-label">${r.professorName || r.assignedProfName}</div>
          <div class="sig-label" style="margin-top:2px">Authorizing Professor</div>
          <div class="sig-label" style="margin-top:2px;font-size:11px">${formatDateTime(r.processedAt)}</div>
        </div>
        <div style="margin-top:16px;font-size:11px;color:var(--muted)">
          This document is digitally generated and authenticated by the OD Portal. Ref: ${r.id}
        </div>
      </div>
    </div>
  `;
  document.getElementById('doc-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('doc-modal').classList.remove('active');
}

function printDoc() {
  const content = document.getElementById('printable-doc').outerHTML;
  const win     = window.open('', '_blank');
  win.document.write(`
    <html><head>
      <title>OD Certificate – ${_viewingDoc ? _viewingDoc.id : ''}</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,600&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'DM Sans', sans-serif; padding: 40px; color: #0f0e0c; }
        .od-doc { border: 1px solid #d4cfc6; border-radius: 4px; padding: 40px; position: relative; font-size: 14px; line-height: 1.8; max-width: 700px; margin: auto; }
        .od-doc-header { text-align: center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 2px solid #0f0e0c; }
        .od-doc-header h2 { font-family: 'DM Serif Display', serif; font-size: 22px; margin-bottom: 4px; }
        .od-doc-header p { color: #7a7469; font-size: 13px; }
        .od-doc-body { margin-bottom: 32px; }
        .od-doc-field { display: flex; gap: 12px; margin-bottom: 12px; }
        .od-doc-label { font-weight: 600; min-width: 140px; color: #7a7469; }
        .od-stamp { position: absolute; top: 32px; right: 32px; border: 3px solid #2d6a4f; border-radius: 4px; padding: 10px 16px; color: #2d6a4f; font-weight: 700; font-size: 16px; letter-spacing: 0.1em; transform: rotate(-5deg); opacity: 0.85; }
        .od-doc-footer { border-top: 1px solid #d4cfc6; padding-top: 20px; }
        .od-signature { text-align: right; }
        .signature-line { border-bottom: 1px solid #0f0e0c; width: 200px; margin-left: auto; margin-bottom: 6px; font-family: 'DM Serif Display', serif; font-style: italic; font-size: 20px; color: #1d4e89; text-align: center; padding: 4px 0; }
        .sig-label { font-size: 12px; color: #7a7469; text-align: right; }
      </style>
    </head><body>${content}<script>window.print();<\/script></body></html>
  `);
  win.document.close();
}

// ─── Start app ─────────────────────────────────────────────
boot();
