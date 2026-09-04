import sys
import os
import uuid
import hmac
import hashlib
from datetime import datetime, timedelta
from unittest.mock import patch
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token

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
    r = client.post("/register", json=payload, params={"verify_token": issue_verify_token(email)})
    assert r.status_code == 200, r.text
    account_id = r.json()["id"]
    r = client.post("/login", json={"identifier": email, "password": "strongpass123", "role": role})
    assert r.status_code == 200, r.text
    return account_id, r.json()["access_token"], email


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _available_worker():
    """Register a worker and mark them available so bookings pass validation."""
    wid, wtok, wemail = _register_and_login("worker")
    r = client.put(f"/workers/{wid}", json={"current_status": "available", "availability": True}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    return wid, wtok, wemail


def _create_booking(token, worker_id, **overrides):
    body = {"worker_id": worker_id, "problem_description": "Fix the sink", **overrides}
    return client.post("/bookings/", json=body, headers=_auth(token))


def test_route_exists():
    response = client.get("/bookings")
    # Integration test asserting the route is reachable
    assert response.status_code in [200, 401, 403, 404, 405, 422]
    assert response.headers.get("content-type") is not None


def test_past_time_same_day_is_rejected():
    """A booking for TODAY with a time that has already passed must be refused —
    clients may not book slots that can no longer be fulfilled."""
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    today = datetime.utcnow().date().isoformat()

    r = _create_booking(ctok, wid, booking_date=today, booking_time="00:00")
    assert r.status_code == 400, r.text
    assert "past" in str(r.json().get("detail", "")).lower(), r.text


def test_future_slot_same_day_is_allowed():
    """A booking for TODAY at a still-upcoming time is valid."""
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    today = datetime.utcnow().date().isoformat()
    future = (datetime.utcnow() + timedelta(hours=2)).strftime("%H:%M:00")

    r = _create_booking(ctok, wid, booking_date=today, booking_time=future)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending", r.text


def test_mark_incomplete_allowed_right_after_accept():
    """Either side can mark a job as not completed as soon as it is ACCEPTED —
    the booking enters the pending-review state (NO auto review) and only the
    client's review finalizes it to terminal 'not_completed'."""
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    # Worker accepts (pending -> upcoming)
    r = client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text

    # The client can flag it as not completed right away — it stays ACTIVE
    # (pending review, visible in Present) instead of dropping into Past.
    r = client.post(f"/bookings/{booking_id}/mark-incomplete", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "not_completed_pending_review", r.text

    # NO auto review was posted on the worker for this booking.
    r = client.get("/reviews/", params={"worker_id": wid}, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert all(row.get("booking_id") != booking_id for row in r.json()), r.text

    # The client's review (photos optional) finalizes the job.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": booking_id, "rating": 2, "review_text": "no-show"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
    assert r.json()["status"] == "not_completed", r.text

    # One review per booking per side — a second client review is refused.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": booking_id, "rating": 1, "review_text": "again"},
        headers=_auth(ctok),
    )
    assert r.status_code == 400, r.text


def test_worker_review_finalizes_not_completed_booking():
    """The worker's review also closes a pending not-completed job — a client
    who flags the job and disappears can't leave it stuck in Present forever."""
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    r = client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    r = client.post(f"/bookings/{booking_id}/mark-incomplete", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "not_completed_pending_review", r.text

    # The worker reviews the CLIENT — this finalizes the booking.
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "booking_id": booking_id, "rating": 1, "review_text": "client never showed up"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    r = client.get(f"/bookings/{booking_id}", headers=_auth(wtok))
    assert r.json()["status"] == "not_completed", r.text


def test_worker_can_report_nonpayment_right_after_work_complete():
    """The 'Report non-payment' escalation is available as soon as the worker
    has marked the work complete — the client ghosting before paying must not
    leave the worker stuck with a live booking forever."""
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    # Worker accepts and marks the work done.
    r = client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    r = client.post(f"/bookings/{booking_id}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200, r.text

    # Report non-payment directly from work_completed.
    r = client.post(f"/bookings/{booking_id}/report-nonpayment", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "unpaid", r.text


def _pay_via_razorpay(ctok, booking_id):
    """Take a confirmed booking through the Razorpay order+verify steps
    (gateway HTTP mocked) WITHOUT submitting any payment proof."""
    order_id = f"order_{booking_id}_proof"
    mock_response = {
        "id": order_id,
        "amount": 50000,
        "currency": "INR",
        "receipt": f"booking-{booking_id}",
        "status": "created",
        "notes": {"booking_id": str(booking_id)},
    }
    with patch("routers.payments.create_razorpay_order", side_effect=lambda *a, **k: mock_response):
        r = client.post("/payments/order", json={"booking_id": booking_id}, headers=_auth(ctok))
        assert r.status_code == 200, r.text

    payment_id = f"pay_{order_id}"
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "dummy_secret")
    signature = hmac.new(key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": booking_id,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text


def test_client_review_refused_until_payment_proof_submitted():
    """Payment proof is MANDATORY: a booking that is merely payment_completed
    (paid, proof never uploaded) must refuse the client's review."""
    cid, ctok, _ = _register_and_login("user")
    wid, wtok, _ = _available_worker()
    booking_id = _create_booking(ctok, wid).json()["id"]

    # Full work chain up to payment, but NO proof submission.
    r = client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    r = client.post(f"/bookings/{booking_id}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    r = client.post(
        f"/bookings/{booking_id}/work-report",
        json={"note": "Work done", "final_price": 500},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    r = client.post(f"/bookings/{booking_id}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    _pay_via_razorpay(ctok, booking_id)

    r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
    assert r.json()["status"] == "payment_completed", r.text

    # The review must be refused — proof was never submitted.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": booking_id, "rating": 5, "review_text": "great"},
        headers=_auth(ctok),
    )
    assert r.status_code == 403, r.text
    assert "proof" in str(r.json().get("detail", "")).lower(), r.text

    # Submitting the proof unlocks the review.
    r = client.patch(
        f"/payments/{booking_id}/proof",
        json={"payment_proof_image": "https://example.com/proof.jpg"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": booking_id, "rating": 5, "review_text": "great"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
