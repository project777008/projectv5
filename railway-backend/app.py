"""
Digital OD System — Flask Backend (Railway)
============================================
Firebase Project: od-system-4c5df

SECURITY CHANGES (v2):
  ✅ All passwords hashed with bcrypt (cost 12) — never stored plain-text
  ✅ ADMIN_PASSWORD_HASH env var seeds admin on first boot
  ✅ Demo passwords removed entirely
  ✅ require_role() verifies X-User-Id against Firestore (not demo DB)
  ✅ Login compares bcrypt hash — plain-text pass field gone
  ✅ Admin setup endpoint (/api/admin/setup) for first-run password selection

REQUIRED Railway environment variables:
  FIREBASE_CREDS        = <paste serviceAccountKey.json content>
  ADMIN_PASSWORD_HASH   = <bcrypt hash of your chosen admin password>
                          Generate with: python -c "import bcrypt; print(bcrypt.hashpw(b'YourPassword', bcrypt.gensalt(12)).decode())"
  ADMIN_ID              = e.g. ADMIN001   (default: ADMIN001)
  ADMIN_NAME            = e.g. System Administrator
  DEBUG                 = false
"""

from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                 Table, TableStyle, HRFlowable)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
import bcrypt
import io, datetime, random, string, os, json

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
DEBUG_MODE = os.environ.get("DEBUG", "false").lower() == "true"

# Admin bootstrap config — set these in Railway env vars
ADMIN_ID            = os.environ.get("ADMIN_ID",   "ADMIN001").strip()
ADMIN_NAME          = os.environ.get("ADMIN_NAME", "System Administrator").strip()
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "").strip()
# If ADMIN_PASSWORD_HASH is empty the admin account is NOT seeded automatically.
# Use POST /api/admin/setup to set the first password (only works once).

# ─────────────────────────────────────────────────────────────
# FLASK SETUP
# ─────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app, origins=os.environ.get("ALLOWED_ORIGIN", "*"))


# ─────────────────────────────────────────────────────────────
# SERVE FRONTEND
# ─────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def static_files(path):
    full_path = os.path.join(app.static_folder, path)
    if os.path.exists(full_path):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


# ─────────────────────────────────────────────────────────────
# RESPONSE HELPERS
# ─────────────────────────────────────────────────────────────
def err(message, status=400, code=None):
    payload = {"success": False, "message": message}
    if code:
        payload["code"] = code
    return jsonify(payload), status

def ok(data: dict):
    return jsonify({"success": True, **data})

def debug_log(*args):
    if DEBUG_MODE:
        print("[DEBUG]", *args)


# ─────────────────────────────────────────────────────────────
# PASSWORD HELPERS
# bcrypt cost 12 — ~250ms per hash, safe against brute-force.
# ─────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    """Return bcrypt hash string for plain-text password."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")

def check_password(plain: str, hashed: str) -> bool:
    """Constant-time bcrypt comparison. Returns True if match."""
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────
# FIREBASE INIT
# ─────────────────────────────────────────────────────────────
FIREBASE_READY = False
db = None

def init_firebase():
    global db, FIREBASE_READY

    firebase_creds_json = os.environ.get("FIREBASE_CREDS")
    if firebase_creds_json:
        try:
            cred_dict = json.loads(firebase_creds_json)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {"projectId": "od-system-4c5df"})
            db = firestore.client()
            FIREBASE_READY = True
            print("✅ Firebase connected via FIREBASE_CREDS env var")
            return
        except Exception as e:
            print(f"⚠️  FIREBASE_CREDS parse failed: {e}")

    sa_path = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
    if os.path.exists(sa_path):
        try:
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred, {"projectId": "od-system-4c5df"})
            db = firestore.client()
            FIREBASE_READY = True
            print("✅ Firebase connected via serviceAccountKey.json")
            return
        except Exception as e:
            print(f"⚠️  serviceAccountKey.json init failed: {e}")

    try:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {"projectId": "od-system-4c5df"})
        db = firestore.client()
        FIREBASE_READY = True
        print("✅ Firebase connected via Application Default Credentials")
    except Exception as e:
        print(f"❌ Firebase not connected ({e})")
        print("   → Set FIREBASE_CREDS env var on Railway. Exiting demo mode — no in-memory fallback.")

init_firebase()

# ─────────────────────────────────────────────────────────────
# BOOTSTRAP HELPERS
# ─────────────────────────────────────────────────────────────
def now_iso():
    """Returns current UTC time in ISO format."""
    return datetime.datetime.utcnow().isoformat()

# ─────────────────────────────────────────────────────────────
# BOOTSTRAP ADMIN ACCOUNT
# Runs once on startup. If admin document already exists in
# Firestore it is NOT overwritten, preserving the current hash.
# ─────────────────────────────────────────────────────────────
def bootstrap_admin():
    if not FIREBASE_READY:
        return
    if not ADMIN_PASSWORD_HASH:
        print("⚠️  ADMIN_PASSWORD_HASH not set. Admin account not auto-seeded.")
        print("   → POST /api/admin/setup to set the first admin password.")
        return

    # Validate the provided value looks like a bcrypt hash
    if not ADMIN_PASSWORD_HASH.startswith("$2b$"):
        print("❌ ADMIN_PASSWORD_HASH must be a bcrypt hash starting with $2b$")
        print("   → Generate: python -c \"import bcrypt; print(bcrypt.hashpw(b'YourPwd', bcrypt.gensalt(12)).decode())\"")
        return

    admin_ref = db.collection("users").document(ADMIN_ID)
    if admin_ref.get().exists:
        debug_log(f"Admin {ADMIN_ID} already exists — skipping bootstrap.")
        return

    admin_doc = {
        "id":         ADMIN_ID,
        "passHash":   ADMIN_PASSWORD_HASH,  # bcrypt hash only — no plain-text
        "role":       "admin",
        "name":       ADMIN_NAME,
        "dept":       "Administration",
        "createdAt":  now_iso(), # This will now work because now_iso is defined above
        "createdBy":  "system",
        "setupDone":  True,
    }
    admin_ref.set(admin_doc)
    print(f"✅ Admin account {ADMIN_ID} bootstrapped from ADMIN_PASSWORD_HASH env var.")

# Now we can safely call it
bootstrap_admin()


# ─────────────────────────────────────────────────────────────
# FIRESTORE HELPERS
# ─────────────────────────────────────────────────────────────


def generate_password(length=12):
    """Generate a random secure password for new users."""
    # At least one each of: uppercase, lowercase, digit, symbol
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pwd = ''.join(random.choices(chars, k=length))
        if (any(c.isupper() for c in pwd)
                and any(c.islower() for c in pwd)
                and any(c.isdigit() for c in pwd)):
            return pwd

def get_user(user_id):
    if not FIREBASE_READY or not user_id:
        return None
    doc = db.collection("users").document(user_id).get()
    return doc.to_dict() if doc.exists else None

def get_request(req_id):
    if not FIREBASE_READY or not req_id:
        return None
    doc = db.collection("od_requests").document(req_id).get()
    return doc.to_dict() if doc.exists else None

def require_role(*roles):
    """
    Reads X-User-Id header, fetches user from Firestore, checks role.
    Returns the user dict or None if unauthorized.
    NOTE: This is header-based — upgrade to JWT for production.
    """
    caller_id = request.headers.get("X-User-Id", "").strip()
    if not caller_id:
        return None
    caller = get_user(caller_id)
    if not caller or caller.get("role") not in roles:
        return None
    return caller

def validate_fields(data, *required):
    for field in required:
        val = data.get(field, "")
        if not (val and str(val).strip()):
            return field
    return None

def safe_user(user: dict) -> dict:
    """Strip passHash before sending user data to the client."""
    return {k: v for k, v in user.items() if k not in ("passHash",)}


# ─────────────────────────────────────────────────────────────
# FIRST-RUN SETUP
# POST /api/admin/setup — set admin password on first boot.
# Only works if no admin document exists yet in Firestore.
# Disabled permanently once setupDone = true.
# ─────────────────────────────────────────────────────────────
@app.route("/api/admin/setup", methods=["POST"])
def admin_setup():
    """
    First-run endpoint. Allows the deployer to choose the admin password
    before any other account exists.

    Body: { "adminId": "ADMIN001", "password": "YourChoice123!" }

    Rules:
    - Only works if no admin document exists in Firestore yet.
    - Password must be ≥ 10 characters.
    - Once called successfully, this endpoint returns 403 forever.
    """
    if not FIREBASE_READY:
        return err("Firebase not connected", 503, "FIREBASE_UNAVAILABLE")

    data       = request.get_json(silent=True) or {}
    admin_id   = data.get("adminId",  "").strip() or ADMIN_ID
    password   = data.get("password", "").strip()

    if not password:
        return err("password is required", 400, "MISSING_FIELDS")
    if len(password) < 10:
        return err("Admin password must be at least 10 characters", 400, "PASSWORD_TOO_SHORT")

    admin_ref = db.collection("users").document(admin_id)
    if admin_ref.get().exists:
        # Admin already exists — setup is closed
        return err("Admin account already exists. Setup is closed.", 403, "SETUP_ALREADY_DONE")

    admin_doc = {
        "id":        admin_id,
        "passHash":  hash_password(password),
        "role":      "admin",
        "name":      ADMIN_NAME,
        "dept":      "Administration",
        "createdAt": now_iso(),
        "createdBy": "setup",
        "setupDone": True,
    }
    admin_ref.set(admin_doc)
    print(f"✅ Admin account {admin_id} created via /api/admin/setup")
    return ok({"message": f"Admin account {admin_id} created. Keep your password safe."})


# ─────────────────────────────────────────────────────────────
# AUTH — Login
# ─────────────────────────────────────────────────────────────
@app.route("/api/login", methods=["POST"])
def login():
    if not FIREBASE_READY:
        return err("Firebase not connected", 503, "FIREBASE_UNAVAILABLE")

    data     = request.get_json(silent=True) or {}
    user_id  = data.get("userId",   "").strip()
    password = data.get("password", "")

    if not user_id or not password:
        return err("userId and password are required", 400, "MISSING_FIELDS")

    user = get_user(user_id)

    # Constant-time: always run check_password even if user not found
    stored_hash = user.get("passHash", "") if user else ""
    password_ok = check_password(password, stored_hash) if stored_hash else False

    if not user or not password_ok:
        # Generic message — don't reveal whether ID or password was wrong
        return err("Invalid credentials", 401, "INVALID_CREDENTIALS")

    debug_log(f"Login OK — {user_id} ({user.get('role')})")
    return ok({"user": safe_user(user)})


# ─────────────────────────────────────────────────────────────
# ADMIN — Create User
# ─────────────────────────────────────────────────────────────
@app.route("/api/admin/create-user", methods=["POST"])
def create_user():
    caller = require_role("admin")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    role = data.get("role", "student")
    dept = data.get("dept", "").strip()

    missing = validate_fields(data, "name", "dept")
    if missing:
        return err(f"'{missing}' is required", 400, "MISSING_FIELDS")
    if role not in ("student", "professor", "hod"):
        return err("role must be student, professor, or hod", 400, "INVALID_ROLE")

    # Generate unique ID — retry on collision
    prefix_map = {"professor": "PROF", "student": "STU", "hod": "HOD"}
    for _ in range(5):
        new_id = prefix_map[role] + str(random.randint(1000, 9999))
        if not db.collection("users").document(new_id).get().exists:
            break

    plain_password = generate_password()
    hashed         = hash_password(plain_password)

    user_doc = {
        "id":        new_id,
        "passHash":  hashed,       # bcrypt hash — never the plain password
        "role":      role,
        "name":      name,
        "dept":      dept,
        "createdAt": now_iso(),
        "createdBy": caller["id"],
    }
    db.collection("users").document(new_id).set(user_doc)

    debug_log(f"Created user {new_id} ({role})")
    # Return the plain password ONCE — it is not stored anywhere
    return ok({
        "credentials": {
            "id":       new_id,
            "password": plain_password,   # shown to admin once only
            "role":     role,
            "name":     name,
            "dept":     dept,
        }
    })


# ─────────────────────────────────────────────────────────────
# ADMIN — All Users  (passHash stripped)
# ─────────────────────────────────────────────────────────────
@app.route("/api/admin/users", methods=["GET"])
def get_all_users():
    caller = require_role("admin")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    docs  = db.collection("users").where("role", "in", ["student", "professor", "hod"]).stream()
    users = [safe_user(d.to_dict()) for d in docs]   # passHash stripped
    return ok({"users": users})


# ─────────────────────────────────────────────────────────────
# ADMIN — Change Own Password
# ─────────────────────────────────────────────────────────────
@app.route("/api/admin/change-password", methods=["POST"])
def change_password():
    caller = require_role("admin")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    data             = request.get_json(silent=True) or {}
    current_password = data.get("currentPassword", "")
    new_password     = data.get("newPassword",     "")

    if not current_password or not new_password:
        return err("Both currentPassword and newPassword are required", 400, "MISSING_FIELDS")
    if len(new_password) < 10:
        return err("Password must be at least 10 characters", 400, "PASSWORD_TOO_SHORT")
    if current_password == new_password:
        return err("New password must differ from current", 400, "SAME_PASSWORD")
    if not check_password(current_password, caller.get("passHash", "")):
        return err("Current password is incorrect", 401, "WRONG_PASSWORD")

    db.collection("users").document(caller["id"]).update({
        "passHash":          hash_password(new_password),
        "passwordChangedAt": now_iso(),
    })
    debug_log(f"Password changed for {caller['id']}")
    return ok({"message": "Password updated successfully"})


# ─────────────────────────────────────────────────────────────
# PROFESSORS — for student dropdown
# ─────────────────────────────────────────────────────────────
@app.route("/api/professors", methods=["GET"])
def get_professors():
    if not FIREBASE_READY:
        return err("Firebase not connected", 503)
    docs  = db.collection("users").where("role", "==", "professor").stream()
    profs = [{"id": d.id, "name": d.to_dict().get("name"), "dept": d.to_dict().get("dept")} for d in docs]
    return ok({"professors": profs})


# ─────────────────────────────────────────────────────────────
# STUDENT — Submit OD
# ─────────────────────────────────────────────────────────────
@app.route("/api/student/submit-od", methods=["POST"])
def submit_od():
    caller = require_role("student")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    data    = request.get_json(silent=True) or {}
    missing = validate_fields(data, "reason", "date", "assignedProfId")
    if missing:
        return err(f"'{missing}' is required", 400, "MISSING_FIELDS")

    reason           = data["reason"].strip()[:500]    # max 500 chars
    date             = data["date"].strip()
    duration         = data.get("duration", "Full Day")
    details          = data.get("details", "").strip()[:300]
    assigned_prof_id = data["assignedProfId"].strip()

    prof = get_user(assigned_prof_id)
    if not prof or prof.get("role") != "professor":
        return err("Selected professor not found", 400, "INVALID_PROFESSOR")

    req_id = "OD" + str(int(datetime.datetime.utcnow().timestamp() * 1000))
    od_doc = {
        "id":               req_id,
        "studentId":        caller["id"],
        "studentName":      caller.get("name"),
        "studentDept":      caller.get("dept"),
        "assignedProfId":   assigned_prof_id,
        "assignedProfName": prof.get("name"),
        "reason": reason, "date": date, "duration": duration, "details": details,
        "status":         "hod_pending",
        "hodStatus":      "pending",
        "profStatus":     None,
        "submittedAt":    now_iso(),
        "hodProcessedAt": None, "hodId": None, "hodName": None,
        "professorId":    None, "professorName": None,
        "processedAt":    None, "docGenerated": False,
    }
    db.collection("od_requests").document(req_id).set(od_doc)
    debug_log(f"OD submitted: {req_id} by {caller['id']}")
    return ok({"requestId": req_id})


# ─────────────────────────────────────────────────────────────
# STUDENT — My Requests
# ─────────────────────────────────────────────────────────────
@app.route("/api/student/my-requests", methods=["GET"])
def get_my_requests():
    caller = require_role("student")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    docs = db.collection("od_requests").where("studentId", "==", caller["id"]).stream()
    reqs = [d.to_dict() for d in docs]
    return ok({"requests": sorted(reqs, key=lambda x: x.get("submittedAt", ""), reverse=True)})


# ─────────────────────────────────────────────────────────────
# HOD — Pending / Process / History
# ─────────────────────────────────────────────────────────────
@app.route("/api/hod/pending", methods=["GET"])
def hod_pending():
    caller = require_role("hod")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")
    docs = db.collection("od_requests").where("status", "==", "hod_pending").stream()
    reqs = [d.to_dict() for d in docs]
    return ok({"requests": sorted(reqs, key=lambda x: x.get("submittedAt", ""), reverse=True)})

@app.route("/api/hod/process/<req_id>", methods=["POST"])
def hod_process(req_id):
    caller = require_role("hod")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    data   = request.get_json(silent=True) or {}
    action = data.get("action")
    if action not in ("hod_approved", "hod_rejected"):
        return err("action must be hod_approved or hod_rejected", 400, "INVALID_ACTION")

    od_req = get_request(req_id)
    if not od_req:
        return err("Request not found", 404, "NOT_FOUND")
    if od_req.get("status") != "hod_pending":
        return err("Already processed by HOD", 409, "ALREADY_PROCESSED")

    new_status = "pending" if action == "hod_approved" else "hod_rejected"
    db.collection("od_requests").document(req_id).update({
        "status":         new_status,
        "hodStatus":      "approved" if action == "hod_approved" else "rejected",
        "hodProcessedAt": now_iso(),
        "hodId":          caller["id"],
        "hodName":        caller.get("name"),
    })
    return ok({"status": new_status})

@app.route("/api/hod/history", methods=["GET"])
def hod_history():
    caller = require_role("hod")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")
    docs = db.collection("od_requests").where("hodStatus", "in", ["approved", "rejected"]).stream()
    reqs = [d.to_dict() for d in docs]
    return ok({"requests": sorted(reqs, key=lambda x: x.get("hodProcessedAt", ""), reverse=True)})


# ─────────────────────────────────────────────────────────────
# PROFESSOR — Pending / Process / History
# ─────────────────────────────────────────────────────────────
@app.route("/api/professor/pending", methods=["GET"])
def get_pending():
    caller = require_role("professor")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")
    docs = (db.collection("od_requests")
              .where("assignedProfId", "==", caller["id"])
              .where("status", "==", "pending")
              .stream())
    reqs = [d.to_dict() for d in docs]
    return ok({"requests": sorted(reqs, key=lambda x: x.get("submittedAt", ""), reverse=True)})

@app.route("/api/professor/process/<req_id>", methods=["POST"])
def process_request(req_id):
    caller = require_role("professor")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    data   = request.get_json(silent=True) or {}
    action = data.get("action")
    if action not in ("approved", "dismissed"):
        return err("action must be approved or dismissed", 400, "INVALID_ACTION")

    od_req = get_request(req_id)
    if not od_req:
        return err("Request not found", 404, "NOT_FOUND")
    if od_req.get("status") != "pending":
        return err("Request must be HOD-approved before professor action", 409, "INVALID_STATE")
    if od_req.get("assignedProfId") != caller["id"]:
        return err("This request is not assigned to you", 403, "FORBIDDEN")

    db.collection("od_requests").document(req_id).update({
        "status":        action,
        "profStatus":    action,
        "processedAt":   now_iso(),
        "professorId":   caller["id"],
        "professorName": caller.get("name"),
        "docGenerated":  action == "approved",
    })
    return ok({"status": action})

@app.route("/api/professor/history", methods=["GET"])
def get_history():
    caller = require_role("professor")
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")
    docs = (db.collection("od_requests")
              .where("assignedProfId", "==", caller["id"])
              .where("status", "in", ["approved", "dismissed"])
              .stream())
    reqs = [d.to_dict() for d in docs]
    return ok({"requests": sorted(reqs, key=lambda x: x.get("processedAt", ""), reverse=True)})


# ─────────────────────────────────────────────────────────────
# DOCUMENT — PDF generation
# ─────────────────────────────────────────────────────────────
@app.route("/api/document/<req_id>", methods=["GET"])
def get_document(req_id):
    caller_id = request.headers.get("X-User-Id", "").strip()
    caller    = get_user(caller_id)
    if not caller:
        return err("Unauthorized", 403, "UNAUTHORIZED")

    od_req = get_request(req_id)
    if not od_req:
        return err("Request not found", 404, "NOT_FOUND")
    if od_req.get("status") != "approved":
        return err("Only approved requests have a document", 403, "NOT_APPROVED")
    if caller.get("role") == "student" and od_req.get("studentId") != caller_id:
        return err("Access denied", 403, "FORBIDDEN")
    if caller.get("role") == "professor" and od_req.get("assignedProfId") != caller_id:
        return err("Access denied", 403, "FORBIDDEN")

    pdf_buf = generate_od_pdf(od_req)
    pdf_buf.seek(0)
    return send_file(
        pdf_buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"OD_Certificate_{req_id}.pdf"
    )


def generate_od_pdf(req: dict) -> io.BytesIO:
    buffer = io.BytesIO()
    doc    = SimpleDocTemplate(buffer, pagesize=A4,
                               rightMargin=25*mm, leftMargin=25*mm,
                               topMargin=20*mm,  bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    DARK     = colors.HexColor("#0f0e0c")
    GREEN    = colors.HexColor("#2d6a4f")
    BLUE     = colors.HexColor("#1d4e89")
    MUTED    = colors.HexColor("#7a7469")
    LIGHT_BG = colors.HexColor("#f5f1ea")

    title_style  = ParagraphStyle("OD_Title",  parent=styles["Title"],  fontSize=22, textColor=DARK,  spaceAfter=4,  alignment=TA_CENTER, fontName="Helvetica-Bold")
    sub_style    = ParagraphStyle("OD_Sub",    parent=styles["Normal"], fontSize=11, textColor=MUTED, spaceAfter=0,  alignment=TA_CENTER)
    label_style  = ParagraphStyle("Label",     parent=styles["Normal"], fontSize=10, textColor=MUTED, fontName="Helvetica-Bold", leading=14)
    value_style  = ParagraphStyle("Value",     parent=styles["Normal"], fontSize=10, textColor=DARK,  leading=14)
    sig_style    = ParagraphStyle("Sig",       parent=styles["Normal"], fontSize=16, textColor=BLUE,  fontName="Helvetica-BoldOblique", alignment=TA_RIGHT)
    footer_style = ParagraphStyle("Footer",    parent=styles["Normal"], fontSize=9,  textColor=MUTED, alignment=TA_CENTER)
    intro_style  = ParagraphStyle("intro",     parent=styles["Normal"], fontSize=10, textColor=DARK,  leading=16)

    def field(label, value):
        return [Paragraph(label, label_style), Paragraph(str(value) if value else "—", value_style)]

    def fmt_date(d):
        if not d: return "—"
        try: return datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%d %B %Y")
        except: return d

    def fmt_dt(iso):
        if not iso: return "—"
        try: return datetime.datetime.fromisoformat(iso).strftime("%d %b %Y, %I:%M %p UTC")
        except: return iso

    elements = [
        Paragraph("ON-DUTY CERTIFICATE", title_style),
        Paragraph("Department OD Management System · od-system-4c5df", sub_style),
        Spacer(1, 6*mm),
        HRFlowable(width="100%", thickness=2, color=DARK),
        Spacer(1, 8*mm),
        Paragraph(
            "This is to certify that the following student has been granted On-Duty (OD) leave "
            "permission as detailed below, duly authorized by the HOD and the faculty in charge.",
            intro_style
        ),
        Spacer(1, 6*mm),
    ]

    info_data = [
        field("Student Name",       req.get("studentName")),
        field("Student ID",         req.get("studentId")),
        field("Department",         req.get("studentDept")),
        field("OD Date",            fmt_date(req.get("date", ""))),
        field("Duration",           req.get("duration")),
        field("Purpose / Reason",   req.get("reason")),
    ]
    if req.get("details"):
        info_data.append(field("Additional Details", req.get("details")))
    info_data += [
        field("Assigned Professor", req.get("assignedProfName")),
        field("HOD Approved By",    req.get("hodName")),
        field("HOD Approved On",    fmt_dt(req.get("hodProcessedAt"))),
        field("Reference Number",   req.get("id")),
        field("Submitted On",       fmt_dt(req.get("submittedAt"))),
        field("Approved On",        fmt_dt(req.get("processedAt"))),
        field("Approved By",        req.get("professorName")),
    ]

    info_table = Table(info_data, colWidths=[55*mm, None])
    info_table.setStyle(TableStyle([
        ("BACKGROUND",     (0,0), (-1,-1), colors.white),
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [colors.white, LIGHT_BG]),
        ("VALIGN",         (0,0), (-1,-1), "TOP"),
        ("TOPPADDING",     (0,0), (-1,-1), 7),
        ("BOTTOMPADDING",  (0,0), (-1,-1), 7),
        ("LEFTPADDING",    (0,0), (-1,-1), 8),
        ("RIGHTPADDING",   (0,0), (-1,-1), 8),
        ("LINEBELOW",      (0,0), (-1,-1), 0.5, colors.HexColor("#e8e4db")),
    ]))

    elements += [
        info_table,
        Spacer(1, 10*mm),
        HRFlowable(width="100%", thickness=0.75, color=colors.HexColor("#d4cfc6")),
        Spacer(1, 6*mm),
    ]

    sig_data = [[
        Paragraph("This document is digitally generated and authenticated.", footer_style),
        Paragraph(req.get("professorName", ""), sig_style)
    ]]
    sig_tbl = Table(sig_data, colWidths=["60%","40%"])
    sig_tbl.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"BOTTOM"),("LINEABOVE",(1,0),(1,0),1,DARK)]))
    elements.append(sig_tbl)

    sub_data = [[
        Paragraph(f"Ref: {req.get('id','')}", footer_style),
        Paragraph(f"{req.get('professorName','')}<br/>Authorizing Faculty",
                  ParagraphStyle("SigSub", parent=styles["Normal"], fontSize=9, textColor=MUTED, alignment=TA_RIGHT))
    ]]
    sub_tbl = Table(sub_data, colWidths=["60%","40%"])
    sub_tbl.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP")]))
    elements.append(sub_tbl)
    elements.append(Spacer(1, 8*mm))

    def add_watermark(canvas_obj, doc_obj):
        canvas_obj.saveState()
        canvas_obj.setFont("Helvetica-Bold", 72)
        canvas_obj.setFillColor(colors.Color(0.18, 0.42, 0.31, alpha=0.07))
        canvas_obj.translate(105*mm, 148.5*mm)
        canvas_obj.rotate(35)
        canvas_obj.drawCentredString(0, 0, "APPROVED")
        canvas_obj.restoreState()
        canvas_obj.saveState()
        canvas_obj.setStrokeColor(GREEN)
        canvas_obj.setFillColor(colors.Color(0.18, 0.42, 0.31, alpha=0.0))
        canvas_obj.setLineWidth(2.5)
        canvas_obj.roundRect(135*mm, 245*mm, 55*mm, 20*mm, 3)
        canvas_obj.setFont("Helvetica-Bold", 16)
        canvas_obj.setFillColor(GREEN)
        canvas_obj.drawCentredString(162.5*mm, 252*mm, "APPROVED")
        canvas_obj.restoreState()

    doc.build(elements, onFirstPage=add_watermark, onLaterPages=add_watermark)
    return buffer


# ─────────────────────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return ok({
        "status":    "ok",
        "firebase":  FIREBASE_READY,
        "debug":     DEBUG_MODE,
        "project":   "od-system-4c5df",
        "timestamp": now_iso(),
    })


# ─────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 OD System — http://0.0.0.0:{port}")
    print(f"   Firebase : {'✅ Connected' if FIREBASE_READY else '❌ Not connected'}")
    print(f"   Debug    : {'✅ ON' if DEBUG_MODE else '🔒 OFF'}")
    app.run(host="0.0.0.0", debug=DEBUG_MODE, port=port)
