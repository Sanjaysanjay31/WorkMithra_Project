"""Security regression tests.

These lock in the authorization and lifecycle rules added during the security
hardening pass. They exercise real register/login flows against the throwaway
SQLite database configured in conftest.py — never the production database.
"""
import sys
import os
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _uniq():
    return uuid.uuid4().hex[:10]


def _register_and_login(role: str):
    """Register an account of the given role and return (id, token, email)."""
    tag = _uniq()
    email = f"{role}-{tag}@example.com"
    phone = f"+91{tag}"[:15]
    payload = {
        "full_name": f"{role.title()} {tag}",
        "phone": phone,
        "email": email,
        "password": "strongpass123",
        "role": role,
    }
    r = client.post("/register", json=payload)
    assert r.status_code == 200, r.text
    account_id = r.json()["id"]

    r = client.post("/login", json={"identifier": email, "password": "strongpass123", "role": role})
    assert r.status_code == 200, r.text
    return account_id, r.json()["access_token"], email


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _available_worker():
    """Register a worker and mark them available/online so bookings pass the
    availability validation in the bookings router."""
    wid, wtok, wemail = _register_and_login("worker")
    r = client.put(f"/workers/{wid}", json={"current_status": "available", "availability": True}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    return wid, wtok, wemail


# ---------------------------------------------------------------------------
# Registration / auth basics
# ---------------------------------------------------------------------------

def test_register_rejects_weak_password():
    tag = _uniq()
    r = client.post("/register", json={
        "full_name": "Weak Pw", "phone": f"+91{tag}"[:15],
        "email": f"weak-{tag}@example.com", "password": "short", "role": "user",
    })
    assert r.status_code == 422, r.text


def test_login_rejects_wrong_password():
    uid, token, email = _register_and_login("user")
    r = client.post("/login", json={"identifier": email, "password": "wrongpassword", "role": "user"})
    assert r.status_code == 400, r.text


def test_protected_endpoint_requires_token():
    r = client.get("/bookings")
    assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# Booking lifecycle
# ---------------------------------------------------------------------------

def _create_booking(client_token, worker_id, **overrides):
    body = {"worker_id": worker_id, "problem_description": "Fix the sink", **overrides}
    return client.post("/bookings/", json=body, headers=_auth(client_token))


def test_new_booking_always_starts_pending():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    # Client tries to create a booking already marked completed — must be ignored.
    r = _create_booking(ctok, wid, status="completed")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending", r.json()


def test_client_cannot_self_complete_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    r = client.put(f"/bookings/{booking_id}", json={"status": "completed"}, headers=_auth(ctok))
    assert r.status_code in (400, 403), r.text


def test_worker_accept_then_complete():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    # Worker accepts (pending -> upcoming)
    r = client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "upcoming"

    # Worker completes (upcoming -> completed)
    r = client.put(f"/bookings/{booking_id}", json={"status": "completed"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"


def test_invalid_transition_rejected():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    # pending -> completed is not a legal transition even for the worker
    r = client.put(f"/bookings/{booking_id}", json={"status": "completed"}, headers=_auth(wtok))
    assert r.status_code == 400, r.text


def test_cannot_modify_completed_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]
    client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    client.put(f"/bookings/{booking_id}", json={"status": "completed"}, headers=_auth(wtok))

    r = client.put(f"/bookings/{booking_id}", json={"estimated_price": 999}, headers=_auth(wtok))
    assert r.status_code == 400, r.text


def test_stranger_cannot_view_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    _, other_tok, _ = _register_and_login("user")
    r = client.get(f"/bookings/{booking_id}", headers=_auth(other_tok))
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------

def _completed_booking(ctok, wtok, wid):
    booking_id = _create_booking(ctok, wid).json()["id"]
    client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    client.put(f"/bookings/{booking_id}", json={"status": "completed"}, headers=_auth(wtok))
    return booking_id


def test_review_requires_completed_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    # No booking at all — review must be refused.
    r = client.post("/reviews/", json={"worker_id": wid, "rating": 5}, headers=_auth(ctok))
    assert r.status_code == 403, r.text


def test_review_allowed_after_completion_and_once_per_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _completed_booking(ctok, wtok, wid)

    r = client.post("/reviews/", json={"worker_id": wid, "booking_id": booking_id, "rating": 4}, headers=_auth(ctok))
    assert r.status_code == 200, r.text

    # Second review for the same booking is rejected.
    r = client.post("/reviews/", json={"worker_id": wid, "booking_id": booking_id, "rating": 5}, headers=_auth(ctok))
    assert r.status_code == 400, r.text


def test_review_rating_bounds():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _completed_booking(ctok, wtok, wid)
    r = client.post("/reviews/", json={"worker_id": wid, "booking_id": booking_id, "rating": 9}, headers=_auth(ctok))
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Job history
# ---------------------------------------------------------------------------

def test_job_history_requires_completed_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()

    # No booking_id — rejected.
    r = client.post("/job-history/", json={"worker_id": wid}, headers=_auth(wtok))
    assert r.status_code == 400, r.text

    # Pending booking — rejected.
    booking_id = _create_booking(ctok, wid).json()["id"]
    r = client.post("/job-history/", json={"worker_id": wid, "booking_id": booking_id}, headers=_auth(wtok))
    assert r.status_code == 400, r.text


def test_job_history_worker_cannot_claim_others_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    _, other_wtok, _ = _register_and_login("worker")
    booking_id = _completed_booking(ctok, wtok, wid)

    r = client.post("/job-history/", json={"worker_id": wid, "booking_id": booking_id}, headers=_auth(other_wtok))
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def test_notification_requires_shared_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()

    # No booking between them — client cannot notify the worker.
    r = client.post("/notifications/", json={
        "audience": "worker", "recipient_id": wid, "title": "hi", "body": "spam", "kind": "info",
    }, headers=_auth(ctok))
    assert r.status_code == 403, r.text


def test_notification_allowed_with_booking():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    _create_booking(ctok, wid)

    r = client.post("/notifications/", json={
        "audience": "worker", "recipient_id": wid, "title": "New booking", "body": "You have a request", "kind": "booking_request",
    }, headers=_auth(ctok))
    assert r.status_code == 200, r.text


def test_notification_audience_must_match_role():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    _create_booking(ctok, wid)

    # A client may only notify workers, not other users.
    r = client.post("/notifications/", json={
        "audience": "user", "recipient_id": wid, "title": "x", "body": "y", "kind": "info",
    }, headers=_auth(ctok))
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Services (admin-only writes)
# ---------------------------------------------------------------------------

def test_service_create_requires_admin():
    _, ctok, _ = _register_and_login("user")
    r = client.post("/services/", json={"service_name": "Plumbing"}, headers=_auth(ctok))
    assert r.status_code == 403, r.text


def test_service_read_is_public():
    r = client.get("/services/")
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Workers directory
# ---------------------------------------------------------------------------

def test_workers_directory_requires_auth():
    r = client.get("/workers")
    assert r.status_code in (401, 403), r.text


def test_worker_email_hidden_from_others():
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, wemail = _available_worker()

    # Client view — email must be hidden.
    r = client.get(f"/workers/{wid}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json().get("email") in (None, ""), r.json()

    # Worker's own view — email present.
    r = client.get(f"/workers/{wid}", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json().get("email") == wemail, r.json()


# ---------------------------------------------------------------------------
# AI endpoints (paid proxies) require auth
# ---------------------------------------------------------------------------

def test_ai_endpoints_require_auth():
    for path, body in [
        ("/ai/translate", {"text": "hello", "target_lang": "te-IN"}),
        ("/ai/chat", {"prompt": "hi"}),
        ("/ai/extract", {"text": "hi"}),
    ]:
        r = client.post(path, json=body)
        assert r.status_code in (401, 403), f"{path} should require auth, got {r.status_code}"


# ---------------------------------------------------------------------------
# Profile mass-assignment
# ---------------------------------------------------------------------------

def test_profile_mass_assignment_blocked():
    uid, utok, email = _register_and_login("user")
    # Attempt to overwrite server-owned fields via the profile endpoint.
    r = client.post("/profiles/me", json={
        "full_name": "Legit Name",
        "id": 999999,
        "user_id": 424242,
        "role": "admin",
    }, headers=_auth(utok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == uid, body          # user_id not hijacked
    assert body["role"] != "admin", body          # role not escalated
    assert body["id"] != 999999, body             # primary key not rewritten


def test_cannot_read_other_users_full_profile_fields():
    uid, utok, _ = _register_and_login("user")
    other_id, other_tok, _ = _register_and_login("user")
    # Reading another user's profile is allowed for name display, but must be
    # the public UserResponse shape (no password/hash leakage).
    r = client.get(f"/profiles/user/{other_id}", headers=_auth(utok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "hashed_password" not in body
    assert "password" not in body
