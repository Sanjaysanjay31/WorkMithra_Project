"""Worker -> client review tests (bidirectional review system).

Locks in:
  - Workers can review CLIENTS after a completed booking (rating + text +
    up to five photo URLs), mirroring the client -> worker direction.
  - Reviews require a completed booking; one review per booking PER SIDE —
    both sides can review the same booking, but each side only once.
  - GET /reviews/?user_id=U returns reviews RECEIVED BY the client
    (worker-written); GET /reviews/?worker_id=W returns reviews RECEIVED BY
    the worker (client-written) — never the other direction.
  - Reviews a worker WRITES never affect the worker's own rating aggregate.
  - A worker can delete their own review only; clients' reviews stay safe.
"""
import sys
import os
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token

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


def _completed_booking(ctok, wtok, wid):
    """Create a booking, worker accepts, worker completes it."""
    r = client.post(
        "/bookings/",
        json={"worker_id": wid, "problem_description": "Paint the wall"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    b = r.json()
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    r = client.put(f"/bookings/{b['id']}", json={"status": "completed"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    return b


def test_worker_can_review_client_after_completed_booking():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _completed_booking(ctok, wtok, wid)

    image_url = "https://example.supabase.co/storage/v1/object/public/all_images/review_worker_1/x.jpg"
    r = client.post(
        "/reviews/",
        json={
            "user_id": cid,
            "rating": 4.5,
            "review_text": "Friendly client, paid on time",
            "review_image": image_url,
        },
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reviewer_role"] == "worker"
    assert body["user_id"] == cid
    assert body["worker_id"] == wid
    assert body["booking_id"] == b["id"]
    assert body["review_image"] == image_url

    # The client sees it under their received reviews.
    r = client.get(f"/reviews/?user_id={cid}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    mine = [x for x in r.json() if x.get("review_text") == "Friendly client, paid on time"]
    assert len(mine) == 1
    assert mine[0]["reviewer_role"] == "worker"
    # Reviewer display name is the WORKER's (pseudonymized), not the client's.
    assert mine[0]["user_name"] is not None


def test_worker_cannot_review_client_without_completed_booking():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    r = client.post(
        "/bookings/",
        json={"worker_id": wid, "problem_description": "Fix a door"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    b = r.json()
    client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))

    # Booking is upcoming but NOT completed — no review yet.
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 5, "review_text": "too early"},
        headers=_auth(wtok),
    )
    assert r.status_code == 403, r.text


def test_both_sides_can_review_the_same_booking():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _completed_booking(ctok, wtok, wid)

    # Client reviews the worker...
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "rating": 5, "review_text": "great worker"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    # ...and the worker still gets to review the client for the SAME booking.
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 4, "review_text": "great client"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text

    # Each listing shows only its direction.
    r = client.get(f"/reviews/?worker_id={wid}", headers=_auth(ctok))
    texts = [x.get("review_text") for x in r.json()]
    assert "great worker" in texts and "great client" not in texts

    r = client.get(f"/reviews/?user_id={cid}", headers=_auth(wtok))
    texts = [x.get("review_text") for x in r.json()]
    assert "great client" in texts and "great worker" not in texts


def test_worker_can_review_a_booking_only_once():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    _completed_booking(ctok, wtok, wid)

    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 5, "review_text": "first"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text

    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 2, "review_text": "second"},
        headers=_auth(wtok),
    )
    assert r.status_code in (400, 409), r.text


def test_worker_written_review_does_not_change_worker_rating():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    _completed_booking(ctok, wtok, wid)

    # Worker writes a LOW review about the client — their own rating must
    # stay untouched (it only reflects reviews they received).
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 1, "review_text": "difficult client"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text

    r = client.get(f"/reviews/worker/{wid}/summary", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 0
    assert r.json()["average"] == 0.0

    r = client.get(f"/workers/{wid}", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert (r.json().get("rating") or 0) == 0.0


def test_worker_can_delete_own_review_but_not_clients():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    _completed_booking(ctok, wtok, wid)

    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "rating": 5, "review_text": "client's review"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    client_review_id = r.json()["id"]

    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 4, "review_text": "worker's review"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    worker_review_id = r.json()["id"]

    # Worker can't delete the client's review.
    r = client.delete(f"/reviews/{client_review_id}", headers=_auth(wtok))
    assert r.status_code == 403, r.text

    # Worker deletes their own.
    r = client.delete(f"/reviews/{worker_review_id}", headers=_auth(wtok))
    assert r.status_code == 200, r.text

    r = client.get(f"/reviews/?user_id={cid}", headers=_auth(ctok))
    assert all(x.get("review_text") != "worker's review" for x in r.json())

    # The client's review survived.
    r = client.get(f"/reviews/?worker_id={wid}", headers=_auth(ctok))
    assert any(x.get("review_text") == "client's review" for x in r.json())


def test_worker_review_requires_user_id():
    _, wtok = _available_worker()
    r = client.post(
        "/reviews/",
        json={"rating": 5, "review_text": "no target"},
        headers=_auth(wtok),
    )
    assert r.status_code == 400, r.text


def test_each_booking_gets_its_own_review():
    """Reviews are per BOOKING, not per pair: the same client can review the
    same worker once for EACH completed booking (and vice versa)."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b1 = _completed_booking(ctok, wtok, wid)
    b2 = _completed_booking(ctok, wtok, wid)

    # Client reviews the worker for booking 1...
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": b1["id"], "rating": 5, "review_text": "first job"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    # ...and STILL gets a separate review for booking 2.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": b2["id"], "rating": 4, "review_text": "second job"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    # But not twice for the same booking.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": b1["id"], "rating": 3, "review_text": "again"},
        headers=_auth(ctok),
    )
    assert r.status_code in (400, 409), r.text

    # Same in the worker -> client direction.
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "booking_id": b1["id"], "rating": 5, "review_text": "client job 1"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "booking_id": b2["id"], "rating": 4, "review_text": "client job 2"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text

    # Both booking reviews show up in the worker's received list.
    r = client.get(f"/reviews/?worker_id={wid}", headers=_auth(ctok))
    texts = [x.get("review_text") for x in r.json()]
    assert "first job" in texts and "second job" in texts


def test_mine_returns_only_reviews_written_by_caller():
    """GET /reviews/?mine=true lists the CALLER's own reviews (both
    directions) — the bookings screens use the booking_ids to swap
    "Rate"/"Review" buttons for "View my rating"."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _completed_booking(ctok, wtok, wid)

    # Both sides review the same booking.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "rating": 5, "review_text": "client wrote this"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "rating": 4, "review_text": "worker wrote this"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text

    # The client sees ONLY the review they wrote, with its booking_id.
    r = client.get("/reviews/?mine=true", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    rows = r.json()
    texts = [x.get("review_text") for x in rows]
    assert "client wrote this" in texts and "worker wrote this" not in texts
    mine = [x for x in rows if x.get("review_text") == "client wrote this"]
    assert mine[0]["booking_id"] == b["id"]

    # The worker sees only THEIR review for the same booking.
    r = client.get("/reviews/?mine=true", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    rows = r.json()
    texts = [x.get("review_text") for x in rows]
    assert "worker wrote this" in texts and "client wrote this" not in texts
    mine = [x for x in rows if x.get("review_text") == "worker wrote this"]
    assert mine[0]["booking_id"] == b["id"]

    # A stranger who wrote nothing gets an empty list.
    _, xtok = _register_and_login("user")
    r = client.get("/reviews/?mine=true", headers=_auth(xtok))
    assert r.status_code == 200, r.text
    assert r.json() == []
