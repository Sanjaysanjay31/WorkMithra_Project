"""Seed-admin script regression tests.

Locks in: the seeded account logs in through the normal /login endpoint with
an 'admin' role claim, re-running the seed is idempotent, and the password is
only overwritten when explicitly requested.
"""
import importlib.util
import os
import sys
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
import database

client = TestClient(app)

# scripts/ is not a package — load seed_admin.py by path. Its module-level
# load_dotenv() never overrides the JWT_SECRET/DATABASE_URL conftest sets.
_SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "seed_admin.py"
)
_spec = importlib.util.spec_from_file_location("seed_admin_script", _SCRIPT_PATH)
seed_admin_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_admin_script)


def _uniq_email():
    return f"admin-{uuid.uuid4().hex[:10]}@example.com"


def _login(email, password):
    return client.post("/login", json={"identifier": email, "password": password, "role": "user"})


def _seed(email, password, **kw):
    db = database.SessionLocal()
    try:
        return seed_admin_script.seed_admin(db, email, password, **kw)
    finally:
        db.close()


def test_seed_admin_creates_loginable_admin():
    email = _uniq_email()
    user, created = _seed(email, "strongpass123")
    assert created is True
    assert user.role == "admin"
    assert user.is_active is True

    r = _login(email, "strongpass123")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["role"] == "admin"
    assert body["user"]["email"] == email


def test_seed_admin_idempotent_and_password_preserved():
    email = _uniq_email()
    u1, created1 = _seed(email, "strongpass123")
    u2, created2 = _seed(email, "differentpass456")
    assert created1 is True
    assert created2 is False
    assert u1.id == u2.id

    # Without --reset-password the original password still works and the
    # new one was NOT written.
    assert _login(email, "strongpass123").status_code == 200
    assert _login(email, "differentpass456").status_code == 400


def test_seed_admin_reset_password():
    email = _uniq_email()
    _seed(email, "strongpass123")
    _seed(email, "differentpass456", reset_password=True)
    assert _login(email, "differentpass456").status_code == 200
    assert _login(email, "strongpass123").status_code == 400
