"""Integration tests for the full sequential work completion and payment chain:

These tests exercise the full lifecycle:

  1. Create a booking (client -> worker)
  2. Worker accepts (pending -> upcoming)
  3. Worker marks work complete (upcoming -> work_completed)
  4. Worker submits work report (work_completed -> work_reported)
  5. Client confirms work (work_reported -> client_confirmed)
  6. Client opens Razorpay order (client_confirmed -> client pays)
  7. Client verifies payment (payment_completed)
  8. Client posts payment proof (payment_completed -> payment_proof_submitted)
  9. Client submits review (payment_proof_submitted -> completed)
 10. Worker receives notification, booking moves to Past

Followed by a parallel "non-payment" branch:

  A. Same as above until step 4 (work report submitted)
  B. Worker reports non-payment (work_reported -> unpaid)
  C. Auto-created 1-star review on client visible via GET /reviews/?user_id=<client>
"""
import hashlib
import hmac
import sys
import os

from unittest.mock import patch, MagicMock
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers (copy from existing tests)
# ---------------------------------------------------------------------------

def _uniq(prefix: str = "work") -> str:
    import uuid
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _register_and_login(role: str):
    tag = _uniq(f"{role}-work")
    email = f"{role}-{tag}@example.com"
    phone = f"+91{tag[-10:]}"  # use last 10 chars for uniqueness
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


def _create_booking(ctok, wid, **overrides):
    body = {"worker_id": wid, "problem_description": "Fix the sink", **overrides}
    r = client.post("/bookings/", json=body, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    return r.json()


def _create_booking_with_work_report(ctok, wid, wtok, **overrides):
    """Complete booking progression to work_reported (Steps 1-4 of the workflow)."""
    b = _create_booking(ctok, wid, **overrides)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    # Step 3: Worker marks work complete
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    assert r.json()["status"] == "work_completed"
    # Step 4: Worker submits work report
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job completed", "images": [], "final_price": 3999},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    return b, r.json()


# ---------------------------------------------------------------------------
# Test utilities for Razorpay mocking
# ---------------------------------------------------------------------------

def _valid_signature(order_id: str, payment_id: str, key_secret: str) -> str:
    return hmac.new(
        key_secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _ensure_razorpay_keys():
    os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_dummy_id")
    os.environ.setdefault("RAZORPAY_KEY_SECRET", "dummy_secret")


# ---------------------------------------------------------------------------
# Happy path: Booking -> Payment -> Review -> Completion
# ---------------------------------------------------------------------------

@patch("routers.payments.create_razorpay_order")
def test_full_payment_and_review_chain(mock_create_order):
    """Full happy path:

    client creates booking → worker accepts → worker marks work complete →
    worker submits work report → client confirms → client pays via Razorpay →
    client posts proof → client submits review → booking auto-completed.
    """
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_full",
        "amount": 399900,  # 3999 * 100
        "currency": "INR",
        "receipt": "booking-full",
        "notes": {"booking_id": 111, "user_id": 1, "worker_id": 2},
    }

    # 1. Clients and worker setup
    client_id, client_token = _register_and_login("user")
    worker_id, worker_token = _available_worker()

    # 2. Client creates a booking
    booking = _create_booking(client_token, worker_id)
    assert booking["status"] == "pending"

    # 3. Worker accepts the booking (pending -> upcoming)
    r = client.put(f"/bookings/{booking['id']}", json={"status": "upcoming"}, headers=_auth(worker_token))
    assert r.status_code == 200
    assert r.json()["status"] == "upcoming"

    # 4. Worker marks work complete (upcoming -> work_completed)
    r = client.post(f"/bookings/{booking['id']}/mark-work-complete", headers=_auth(worker_token))
    assert r.status_code == 200
    assert r.json()["status"] == "work_completed"

    # 5. Worker submits work report (work_completed -> work_reported)
    report = client.post(
        f"/bookings/{booking['id']}/work-report",
        json={"note": "Done", "images": [], "final_price": 3999},
        headers=_auth(worker_token),
    )
    assert report.status_code == 200
    assert report.json()["booking_id"] == booking["id"]

    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "work_reported"

    # 6. Client confirms work (work_reported -> client_confirmed)
    r = client.post(f"/bookings/{booking['id']}/confirm-work", headers=_auth(client_token))
    assert r.status_code == 200
    assert r.json()["status"] == "client_confirmed"

    # 7. Client opens Razorpay order (client_confirmed -> payment)
    r = client.post("/payments/order", json={"booking_id": booking["id"]}, headers=_auth(client_token))
    assert r.status_code == 200
    order_data = r.json()
    payment_id = order_data["payment_id"]
    order_id = order_data["order_id"]
    assert order_id == "order_full"
    assert order_data["amount_paise"] == 399900

    # 8. Client verifies payment with valid signature (booking -> payment_completed)
    valid_sig = _valid_signature(order_id, "pay_done", os.environ["RAZORPAY_KEY_SECRET"])
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": booking["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_done",
            "razorpay_signature": valid_sig,
        },
        headers=_auth(client_token),
    )
    assert r.status_code == 200
    assert r.json()["payment_status"] == "paid"

    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "payment_completed"

    # 9. Client posts payment proof (payment_completed -> payment_proof_submitted)
    r = client.patch(
        f"/payments/{booking['id']}/proof",
        json={"payment_proof_image": "https://example.com/proof.jpg"},
        headers=_auth(client_token),
    )
    assert r.status_code == 200
    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "payment_proof_submitted"

    # 10. Client submits a review for the worker (this auto-completes the booking)
    r = client.post(
        "/reviews/",
        json={
            "worker_id": worker_id,
            "booking_id": booking["id"],
            "rating": 5,
            "review_text": "Excellent work!",
            "images": [],
        },
        headers=_auth(client_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewer_role"] == "user"

    # Booking should now be completed (auto-complete via client review after proof submission)
    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "completed"

    # Worker should have a completion notification
    r = client.get(
        f"/notifications/?audience=worker&recipient_id={worker_id}",
        headers=_auth(worker_token),
    )
    assert r.status_code == 200
    kinds = [n.get("kind") for n in r.json()]
    assert "booking_completed" in kinds

    # Worker should see the completed job in their "Past" bookings (status completed)
    r = client.get(f"/bookings/", headers=_auth(worker_token))
    assert r.status_code == 200
    past = [b for b in r.json() if b["id"] == booking["id"]]
    assert len(past) == 1
    assert past[0]["status"] == "completed"


# ---------------------------------------------------------------------------
# Non-payment branch: Booking -> Work report -> Report non-payment -> Unpaid + Negative review
# ---------------------------------------------------------------------------

def test_non_payment_branch():
    """Worker reports non-payment → booking -> unpaid + auto negative review on client."""
    _ensure_razorpay_keys()

    client_id, client_token = _register_and_login("user")
    worker_id, worker_token = _available_worker()

    # 1. Create booking and get to work report stage (work_reported)
    booking = _create_booking(client_token, worker_id)
    r = client.put(f"/bookings/{booking['id']}", json={"status": "upcoming"}, headers=_auth(worker_token))
    assert r.status_code == 200

    # Worker marks work complete
    r = client.post(f"/bookings/{booking['id']}/mark-work-complete", headers=_auth(worker_token))
    assert r.status_code == 200
    assert r.json()["status"] == "work_completed"

    # Submit work report (price agreed) -> work_reported
    report = client.post(
        f"/bookings/{booking['id']}/work-report",
        json={"note": "Done, waiting for payment", "images": [], "final_price": 2500},
        headers=_auth(worker_token),
    )
    assert report.status_code == 200
    assert report.json()["booking_id"] == booking["id"]

    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "work_reported"

    # 2. Worker reports non-payment (worker-only action)
    r = client.post(
        f"/bookings/{booking['id']}/report-nonpayment",
        json={},
        headers=_auth(worker_token),
    )
    assert r.status_code == 200

    # Booking should now be 'unpaid'
    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "unpaid"

    # There should be a work report associated
    r = client.get(f"/bookings/{booking['id']}/work-report", headers=_auth(client_token))
    assert r.status_code == 200

    # 3. Verify that a 1-star review was auto-created for the client (worker → client review)
    r = client.get(f"/reviews/?user_id={client_id}", headers=_auth(client_token))
    assert r.status_code == 200

    negative_reviews = [
        rev for rev in r.json()
        if rev.get("reviewer_role") == "worker" and rev.get("rating") == 1.0
        and "Payment was not received" in (rev.get("review_text") or "")
    ]
    assert len(negative_reviews) == 1
    negative = negative_reviews[0]

    assert negative["booking_id"] == booking["id"]
    assert negative.get("review_images") == [] or negative.get("review_images") is None

    # 4. The booking should also appear in client's "Past" (via unpaid status)
    r = client.get(f"/bookings/", headers=_auth(client_token))
    assert r.status_code == 200
    client_bookings = r.json()
    unpaid_found = any(b["id"] == booking["id"] for b in client_bookings)
    assert unpaid_found


# ---------------------------------------------------------------------------
# Edge cases: Non-payment path when worker already reviewed client
# ---------------------------------------------------------------------------

def test_non_payment_with_existing_worker_review():
    """Worker reports non-payment from work_reported state (before client pays).
    The report succeeds and creates a 1-star auto-review on the client.
    This test covers the non-payment path; the 'existing review' premise
    reflects the old workflow where workers could review earlier."""
    _ensure_razorpay_keys()

    client_id, client_token = _register_and_login("user")
    worker_id, worker_token = _available_worker()

    booking = _create_booking(client_token, worker_id)
    r = client.put(f"/bookings/{booking['id']}", json={"status": "upcoming"}, headers=_auth(worker_token))
    assert r.status_code == 200

    # Worker marks work complete and submits work report
    r = client.post(f"/bookings/{booking['id']}/mark-work-complete", headers=_auth(worker_token))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{booking['id']}/work-report",
        json={"note": "Work done", "images": [], "final_price": 1500},
        headers=_auth(worker_token),
    )
    assert r.status_code == 200

    # Worker reports non-payment from work_reported (no payment exists yet)
    r = client.post(
        f"/bookings/{booking['id']}/report-nonpayment",
        json={},
        headers=_auth(worker_token),
    )
    assert r.status_code == 200

    # Booking is now unpaid
    r = client.get(f"/bookings/{booking['id']}", headers=_auth(client_token))
    assert r.json()["status"] == "unpaid"

    # A 1-star auto-review was created on the client for non-payment
    r = client.get(f"/reviews/?user_id={client_id}", headers=_auth(client_token))
    reviews_for_client = r.json()
    assert len(reviews_for_client) == 1
    assert reviews_for_client[0]["rating"] == 1
    assert reviews_for_client[0]["reviewer_role"] == "worker"


# ---------------------------------------------------------------------------
# Payment branch: Already paid booking -> cannot report non-payment
# ---------------------------------------------------------------------------

@patch("routers.payments.create_razorpay_order")
def test_non_payment_when_already_paid_fails(mock_create_order):
    """If the booking is already paid, worker cannot report non-payment."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_paid",
        "amount": 500,
        "currency": "INR",
        "receipt": "booking-paid",
        "notes": {"booking_id": 222, "user_id": 1, "worker_id": 2},
    }

    client_id, client_token = _register_and_login("user")
    worker_id, worker_token = _available_worker()

    # Create and progress to work_reported
    booking = _create_booking(client_token, worker_id)
    r = client.put(f"/bookings/{booking['id']}", json={"status": "upcoming"}, headers=_auth(worker_token))
    assert r.status_code == 200

    # Worker marks work complete and submits work report
    r = client.post(f"/bookings/{booking['id']}/mark-work-complete", headers=_auth(worker_token))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{booking['id']}/work-report",
        json={"note": "Done", "images": [], "final_price": 500},
        headers=_auth(worker_token),
    )
    assert r.status_code == 200

    # Worker cannot report non-payment at work_reported stage (paid check is the final guard)
    # The non-payment guard checks if payment exists first, which it doesn't.
    # But once payment is made it should be blocked.
    # Progress to payment_completed via confirm + pay
    r = client.post(f"/bookings/{booking['id']}/confirm-work", headers=_auth(client_token))
    assert r.status_code == 200

    r = client.post("/payments/order", json={"booking_id": booking["id"]}, headers=_auth(client_token))
    assert r.status_code == 200
    order_id = r.json()["order_id"]
    valid_sig = _valid_signature(order_id, "pay_paid", os.environ["RAZORPAY_KEY_SECRET"])
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": booking["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_paid",
            "razorpay_signature": valid_sig,
        },
        headers=_auth(client_token),
    )
    assert r.status_code == 200

    # Worker cannot report non-payment now (booking is paid)
    r = client.post(
        f"/bookings/{booking['id']}/report-nonpayment",
        json={},
        headers=_auth(worker_token),
    )
    assert r.status_code == 409
    assert "already been paid" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
__all__ = [
    "test_full_payment_and_review_chain",
    "test_non_payment_branch",
    "test_non_payment_with_existing_worker_review",
    "test_non_payment_when_already_paid_fails",
]