"""Job-history scoping regression tests.

Locks in the fix for the worker page bug: a client calling GET /job-history/
with worker_id used to get their ENTIRE history back (the param was silently
ignored for user tokens). Clients must now use with_worker, which narrows
their own history to one worker — and worker_id fails loudly with a 400.

Completion now happens via work-report → payment → client review → auto-complete.
"""
import sys
import os
import uuid
from datetime import date, timedelta
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token, complete_booking_via_work_report

client = TestClient(app)


def _uniq():
    return uuid.uuid4().hex[:10]


def _register_and_login(role: str):
    tag = _uniq()
    email = f"{role}-{tag}@example.com"
    payload = {
        "full_name": f"{role.title()} {tag}",
        "phone": f"+91{tag}"[:15],
        "email": email,
        "password": "strongpass123",
        "role": role,
    }
    r = client.post("/register", json=payload, params={"verify_token": issue_verify_token(email)})
    assert r.status_code == 200, r.text
    account_id = r.json()["id"]
    r = client.post("/login", json={"identifier": email, "password": "strongpass123", "role": role})
    assert r.status_code == 200, r.text
    return account_id, r.json()["access_token"]


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _available_worker():
    wid, wtok = _register_and_login("worker")
    r = client.put(
        f"/workers/{wid}",
        json={"current_status": "available", "availability": True},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    return wid, wtok


def _completed_job(ctok, wid, wtok, mock_order=None):
    """Create a booking and run it to completed via the payment chain."""
    future = (date.today() + timedelta(days=7)).isoformat()
    r = client.post(
        "/bookings/",
        json={"worker_id": wid, "problem_description": "Job", "booking_date": future},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    r = client.put(f"/bookings/{bid}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    # Use the work-report → payment → review chain on THIS booking
    complete_booking_via_work_report(ctok, wtok, wid, client, booking_id=bid)
    return bid


def test_client_history_scoped_per_worker():
    cid, ctok = _register_and_login("user")
    w1, w1tok = _available_worker()
    w2, w2tok = _available_worker()

    _completed_job(ctok, w1, w1tok)
    _completed_job(ctok, w1, w1tok)
    _completed_job(ctok, w2, w2tok)

    # Full history: all three jobs.
    r = client.get("/job-history/", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert len(r.json()) == 3

    # with_worker narrows to jobs done by worker 1 only.
    r = client.get(f"/job-history/?with_worker={w1}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 2
    assert all(row["worker_id"] == w1 for row in rows)

    # A worker the client never hired returns an empty list, not an error.
    w3, _ = _available_worker()
    r = client.get(f"/job-history/?with_worker={w3}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_client_worker_id_param_rejected():
    cid, ctok = _register_and_login("user")
    w1, w1tok = _available_worker()
    _completed_job(ctok, w1, w1tok)

    # The old buggy call must now fail loudly instead of returning everything.
    r = client.get(f"/job-history/?worker_id={w1}", headers=_auth(ctok))
    assert r.status_code == 400, r.text
    assert "with_worker" in r.json()["detail"]


def test_worker_listing_unchanged():
    cid, ctok = _register_and_login("user")
    w1, w1tok = _available_worker()
    w2, w2tok = _available_worker()

    _completed_job(ctok, w1, w1tok)
    _completed_job(ctok, w2, w2tok)

    # Worker sees only their own entry.
    r = client.get("/job-history/", headers=_auth(w1tok))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["worker_id"] == w1

    # worker_id == own id is still accepted for worker tokens.
    r = client.get(f"/job-history/?worker_id={w1}", headers=_auth(w1tok))
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1

    # with_worker for someone else's id yields nothing (scope never widens).
    r = client.get(f"/job-history/?with_worker={w2}", headers=_auth(w1tok))
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_reading_someone_elses_history_still_forbidden():
    cid, ctok = _register_and_login("user")
    other_cid, other_ctok = _register_and_login("user")
    r = client.get(f"/job-history/?user_id={other_cid}", headers=_auth(ctok))
    assert r.status_code == 403, r.text
