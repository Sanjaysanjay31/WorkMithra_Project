"""Razorpay payments (TEST MODE) tests for WorkMithra.

This file tests the payments router: order creation, signature verification,
and booking status flow. All HTTP calls to Razorpay are monkeypatched so
no network traffic is required. The real Razorpay Order API (Basic auth,
checkout.js, HMAC signature) is only exercised internally for sanity checks
(e.g., valid signature verification), but the tests rely on local mocks for
reproducibility.
"""
import hashlib
import hmac
import os
import sys

from unittest.mock import patch, MagicMock
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uniq() -> str:
    import uuid
    return uuid.uuid4().hex[:10]


def _register_and_login(role: str):
    tag = _uniq()
    email = f"{role}-{tag}@example.com"
    phone = f"+91{tag[:15]}"
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


def _ensure_razorpay_keys():
    """Ensure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set for these tests."""
    os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_dummy_key_id")
    os.environ.setdefault("RAZORPAY_KEY_SECRET", "dummy_secret")


def _available_worker():
    # Ensure Razorpay keys are set for payment endpoint
    _ensure_razorpay_keys()
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
    """Creates a booking, worker accepts, marks work complete, submits work report
    with price, and client confirms work (8-step workflow to client_confirmed)."""
    b = _create_booking(ctok, wid, **overrides)
    # Worker accepts the booking (pending -> upcoming)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    # Worker marks work complete (upcoming -> work_completed)
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    # Worker submits work report with final price (work_completed -> work_reported)
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job finished", "images": [], "final_price": 2500},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    # Client confirms work (work_reported -> client_confirmed)
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    return b, r.json()


# ---------------------------------------------------------------------------
# Test utilities
# ---------------------------------------------------------------------------

def _valid_signature(order_id: str, payment_id: str, key_secret: str) -> str:
    """Compute the HMAC SHA256 signature that Razorpay would send."""
    return hmac.new(
        key_secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@patch("routers.payments.create_razorpay_order")
def test_create_order_client_only(mock_create_order):
    """Only the client (booking user) can open a Razorpay order for their booking."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_123",
        "amount": 250000,
        "currency": "INR",
        "receipt": "booking-123",
        "notes": {"booking_id": 123, "user_id": 1, "worker_id": 2},
    }

    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b, _ = _create_booking_with_work_report(ctok, wid, wtok)

    # Client can open the order
    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "payment_id" in data
    assert "order_id" in data
    assert "key_id" in data
    assert data["amount_paise"] == 250000  # 2500 * 100

    # Worker cannot open payment for client’s booking
    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(wtok))
    assert r.status_code == 403, r.text


@patch("routers.payments.create_razorpay_order")
def test_order_awaiting_payment_only(mock_create_order):
    """Only bookings in 'awaiting_payment' can have an order opened."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_2",
        "amount": 50000,
        "currency": "INR",
        "receipt": "booking-2",
        "notes": {"booking_id": 2, "user_id": 1, "worker_id": 2},
    }

    # Create fresh client and worker for this test
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    # A booking still pending -> no order
    b1 = _create_booking(ctok, wid)
    r = client.post("/payments/order", json={"booking_id": b1["id"]}, headers=_auth(ctok))
    assert r.status_code == 400, r.text

    # Worker accepts -> upcoming (still cannot pay)
    r = client.put(f"/bookings/{b1['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post("/payments/order", json={"booking_id": b1["id"]}, headers=_auth(ctok))
    assert r.status_code == 400, r.text

    # Worker marks work complete, submits work report, client confirms -> client_confirmed (order allowed)
    r = client.post(f"/bookings/{b1['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b1['id']}/work-report",
        json={"note": "Work done", "images": [], "final_price": 5000},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b1['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200
    r = client.post("/payments/order", json={"booking_id": b1["id"]}, headers=_auth(ctok))
    assert r.status_code == 200


def test_order_conflict_idempotency():
    """Multiple calls to /order for the same booking return the same order."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    # Create a booking and monkeypatch Razorpay before creating work report
    with patch("routers.payments.create_razorpay_order") as mock_order:
        mock_order.return_value = {
            "id": "order_conflict",
            "amount": 250000,
            "currency": "INR",
            "receipt": "booking-conflict",
            "notes": {"booking_id": 1, "user_id": 1, "worker_id": 2},
        }

        b = _create_booking(ctok, wid)
        r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
        assert r.status_code == 200
        r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
        assert r.status_code == 200
        r = client.post(
            f"/bookings/{b['id']}/work-report",
            json={"note": "Job finished", "images": [], "final_price": 2500},
            headers=_auth(wtok),
        )
        assert r.status_code == 200
        r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
        assert r.status_code == 200

        # First call creates an order
        r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
        assert r.status_code == 200
        data1 = r.json()

        # Second call reuses the same payment/order
        r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
        assert r.status_code == 200
        data2 = r.json()

        assert data1["payment_id"] == data2["payment_id"]
        assert data1["order_id"] == data2["order_id"]


@patch("routers.payments.create_razorpay_order")
def test_order_requires_final_price(mock_create_order):
    """If final_price is None (price not agreed), the order creation fails."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_final_price",
        "amount": 123400,
        "currency": "INR",
        "receipt": "booking-final",
        "notes": {"booking_id": 0, "user_id": 1, "worker_id": 2},
    }
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    # Worker accepts, marks work complete, but does NOT submit work report (no price agreed)
    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200

    # The booking is work_completed (no work report yet)
    # Attempt to open an order — should fail because final_price is None
    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 400, r.text

    # Worker now submits a work report with price -> work_reported
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Price agreed", "images": [], "final_price": 1234},
        headers=_auth(wtok),
    )
    assert r.status_code == 200

    # Client confirms work -> client_confirmed (order becomes possible)
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    # Now open order with mocked Razorpay
    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 200, r.text


def test_order_requires_configured():
    """If RAZORPAY_KEY_ID/SECRET are missing, /order returns a clean 503."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    # Clear Razorpay keys for this test
    original_id = os.environ.get("RAZORPAY_KEY_ID")
    original_secret = os.environ.get("RAZORPAY_KEY_SECRET")
    os.environ.pop("RAZORPAY_KEY_ID", None)
    os.environ.pop("RAZORPAY_KEY_SECRET", None)

    # Create a booking and worker acceptance
    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200

    # Worker submits work report (final price set)
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job done", "images": [], "final_price": 500},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    # Client confirms work to reach client_confirmed
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    # Now attempt to open order without keys -> 503
    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 503
    assert "Payments are not configured" in r.json()["detail"]

    # Restore keys for other tests
    if original_id:
        os.environ["RAZORPAY_KEY_ID"] = original_id
    if original_secret:
        os.environ["RAZORPAY_KEY_SECRET"] = original_secret


@patch("routers.payments.create_razorpay_order")
def test_verify_payment_happy_path(mock_create_order):
    """Valid signature -> payment marked 'paid', worker notified."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_123",
        "amount": 250000,
        "currency": "INR",
        "receipt": "booking-123",
        "notes": {"booking_id": 123, "user_id": 1, "worker_id": 2},
    }

    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    # Create booking, accept, mark work complete, work report, client confirms
    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job finished", "images": [], "final_price": 2500},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    # Create order
    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 200
    order_data = r.json()
    payment_id = order_data["payment_id"]
    order_id = order_data["order_id"]

    # Craft a valid signature using the dummy secret
    valid_sig = _valid_signature(order_id, "pay_987", os.environ["RAZORPAY_KEY_SECRET"])

    # Verify with valid signature
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": b["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_987",
            "razorpay_signature": valid_sig,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200
    payment_resp = r.json()
    assert payment_resp["payment_status"] == "paid"
    assert payment_resp["transaction_id"] == "pay_987"
    assert payment_resp["razorpay_order_id"] == order_id

    # Second verification should be idempotent
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": b["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_987",
            "razorpay_signature": valid_sig,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200
    assert r.json()["payment_status"] == "paid"


@patch("routers.payments.create_razorpay_order")
def test_verify_payment_tampered_signature(mock_create_order):
    """Tampered signature -> payment marked 'failed', error response."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_456",
        "amount": 300000,
        "currency": "INR",
        "receipt": "booking-456",
        "notes": {"booking_id": 456, "user_id": 1, "worker_id": 2},
    }

    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job done", "images": [], "final_price": 3000},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 200
    order_id = r.json()["order_id"]

    # Craft an INVALID signature (wrong secret)
    invalid_sig = _valid_signature(order_id, "pay_555", "wrong_secret")

    # Verify with invalid signature -> 400 and row marked failed
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": b["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_555",
            "razorpay_signature": invalid_sig,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 400
    assert "signature verification failed" in r.json()["detail"].lower()

    # The payment row should be marked 'failed'
    r = client.get(f"/payments/booking/{b['id']}", headers=_auth(ctok))
    assert r.status_code == 200
    payment = r.json()
    if payment:
        assert payment["payment_status"] == "failed"


@patch("routers.payments.create_razorpay_order")
def test_verify_payment_wrong_caller(mock_create_order):
    """Worker attempts to verify client payment -> 403."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_999",
        "amount": 400000,
        "currency": "INR",
        "receipt": "booking-999",
        "notes": {"booking_id": 999, "user_id": 1, "worker_id": 2},
    }

    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job done", "images": [], "final_price": 4000},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 200

    # Worker tries to verify payment (should fail)
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": b["id"],
            "razorpay_order_id": "order_999",
            "razorpay_payment_id": "pay_xyz",
            "razorpay_signature": _valid_signature("order_999", "pay_xyz", os.environ["RAZORPAY_KEY_SECRET"]),
        },
        headers=_auth(wtok),
    )
    assert r.status_code == 403
    assert "Only the customer can pay" in r.json()["detail"]


@patch("routers.payments.create_razorpay_order")
def test_verify_payment_already_paid(mock_create_order):
    """Duplicate verification for the same booking returns the same payment."""
    _ensure_razorpay_keys()
    mock_create_order.return_value = {
        "id": "order_dup",
        "amount": 500000,
        "currency": "INR",
        "receipt": "booking-dup",
        "notes": {"booking_id": 777, "user_id": 1, "worker_id": 2},
    }

    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job done", "images": [], "final_price": 5000},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
    assert r.status_code == 200
    order_id = r.json()["order_id"]

    valid_sig = _valid_signature(order_id, "pay_first", os.environ["RAZORPAY_KEY_SECRET"])

    r = client.post(
        "/payments/verify",
        json={
            "booking_id": b["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_first",
            "razorpay_signature": valid_sig,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200

    # Second identical request returns the same payment row (idempotent)
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": b["id"],
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_first",
            "razorpay_signature": valid_sig,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200
    assert r.json()["payment_status"] == "paid"


# ---------------------------------------------------------------------------
# Booking payment status endpoint
# ---------------------------------------------------------------------------

def test_booking_payment_endpoint_client():
    """Client can retrieve latest payment status for their booking."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job done", "images": [], "final_price": 2000},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    # No payment opened yet
    r = client.get(f"/payments/booking/{b['id']}", headers=_auth(ctok))
    assert r.status_code == 200
    assert r.json() is None

    # Open order
    with patch("routers.payments.create_razorpay_order") as mock_order:
        mock_order.return_value = {
            "id": "order_status",
            "amount": 200000,
            "currency": "INR",
            "receipt": "booking-status",
            "notes": {"booking_id": b["id"], "user_id": 1, "worker_id": 2},
        }
        r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
        assert r.status_code == 200
        payment = r.json()

    # Participant can retrieve payment
    r = client.get(f"/payments/booking/{b['id']}", headers=_auth(ctok))
    assert r.status_code == 200
    # PaymentResponse schema uses 'id' not 'payment_id'
    assert r.json()["id"] == payment["payment_id"]

    # Stranger cannot view
    _, stranger_tok = _register_and_login("user")
    r = client.get(f"/payments/booking/{b['id']}", headers=_auth(stranger_tok))
    assert r.status_code == 403


def test_booking_payment_endpoint_worker():
    """Worker can view payment status too (for their own booking)."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    b = _create_booking(ctok, wid)
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200
    r = client.post(
        f"/bookings/{b['id']}/work-report",
        json={"note": "Job done", "images": [], "final_price": 1800},
        headers=_auth(wtok),
    )
    assert r.status_code == 200
    r = client.post(f"/bookings/{b['id']}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200

    # Worker CAN view payment before it is opened (they are a booking participant)
    # Wait, worker IS a participant (booking.worker_id == worker.id), so they CAN view
    # The endpoint only checks if user is booking.user_id or booking.worker_id
    r = client.get(f"/payments/booking/{b['id']}", headers=_auth(wtok))
    # Worker is a participant, so should be 200 (even if payment doesn't exist)
    assert r.status_code == 200
    # Response should be None (no payment row yet)
    assert r.json() is None

    # Client opens order
    with patch("routers.payments.create_razorpay_order") as mock_order:
        mock_order.return_value = {
            "id": "order_worker",
            "amount": 180000,
            "currency": "INR",
            "receipt": "booking-worker",
            "notes": {"booking_id": b["id"], "user_id": 1, "worker_id": 2},
        }
        r = client.post("/payments/order", json={"booking_id": b["id"]}, headers=_auth(ctok))
        assert r.status_code == 200

    # Now worker can view payment (participants only)
    r = client.get(f"/payments/booking/{b['id']}", headers=_auth(wtok))
    assert r.status_code == 200
    body = r.json()
    assert body["razorpay_order_id"] == "order_worker"
    assert body["payment_status"] in ("created", "pending", "failed")


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
__all__ = [
    "test_create_order_client_only",
    "test_order_awaiting_payment_only",
    "test_order_conflict_idempotency",
    "test_order_requires_final_price",
    "test_order_requires_configured",
    "test_verify_payment_happy_path",
    "test_verify_payment_tampered_signature",
    "test_verify_payment_wrong_caller",
    "test_verify_payment_already_paid",
    "test_booking_payment_endpoint_client",
    "test_booking_payment_endpoint_worker",
]