import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Disable per-IP rate limiting before any test module imports `main`.
# Every request in the suite comes from the same TestClient IP, which would
# otherwise trip the auth endpoint limits mid-run.
os.environ["RATE_LIMITING"] = "0"

# Point the app at a throwaway SQLite database BEFORE `database` is imported.
# load_dotenv() never overrides existing env vars, so this wins over the
# (production) DATABASE_URL in backend/.env — tests must never touch Supabase.
_db_path = os.path.join(tempfile.gettempdir(), "workmithra_tests.db")
if os.path.exists(_db_path):
    os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")

# SQLite engines don't accept the pool_size/max_overflow args used for Postgres.
import sqlalchemy

_orig_create_engine = sqlalchemy.create_engine


def _create_engine_for_tests(url, **kw):
    if str(url).startswith("sqlite"):
        kw = {k: v for k, v in kw.items() if k in ("pool_pre_ping",)}
    return _orig_create_engine(url, **kw)


sqlalchemy.create_engine = _create_engine_for_tests


def issue_verify_token(email: str) -> str:
    """Test-only stand-in for the email OTP challenge.

    /register requires the `verify_token` issued by /verify-otp, but that
    endpoint verifies OTPs against Supabase over the network — unavailable in
    offline tests. This reproduces the server-side half of the flow (pending
    EmailVerification row + signed email_verify token) so tests can exercise
    the real registration path end to end.
    """
    import secrets
    from auth import create_email_verify_token, hash_reset_jti
    from database import SessionLocal
    import models

    jti = secrets.token_urlsafe(16)
    db = SessionLocal()
    try:
        ev = (
            db.query(models.EmailVerification)
            .filter(models.EmailVerification.email == email)
            .first()
        )
        if ev is None:
            ev = models.EmailVerification(email=email)
            db.add(ev)
        ev.jti = hash_reset_jti(jti)
        ev.consumed_at = None
        db.commit()
    finally:
        db.close()
    return create_email_verify_token(email, jti)

# Set Razorpay test environment variables for tests that need payments
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_dummy_key_id")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "dummy_secret")


# ---------------------------------------------------------------------------
# Shared test helpers (usable across all test modules)
# ---------------------------------------------------------------------------
from fastapi.testclient import TestClient
from main import app as _app

_test_client = TestClient(_app)


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client=_test_client, booking_id=None):
    """Bring a booking from `upcoming` to `payment_proof_submitted` via the full
    8-step sequential workflow:

      upcoming → work_completed → work_reported → client_confirmed
      → payment_completed → payment_proof_submitted

    The booking is left in `payment_proof_submitted` status with a paid Payment row.
    No reviews are submitted. The caller can then submit reviews in any order.

    Returns the booking dict (status=payment_proof_submitted, payment verified).
    """
    import hmac
    import hashlib
    from unittest.mock import patch

    if booking_id is None:
        # 1. Create booking and have worker accept it (pending → upcoming)
        r = client.post(
            "/bookings/",
            json={"worker_id": wid, "problem_description": "Test job"},
            headers=_auth(ctok),
        )
        assert r.status_code == 200, r.text
        b = r.json()
        booking_id = b["id"]

        r = client.put(f"/bookings/{booking_id}", json={"status": "upcoming"}, headers=_auth(wtok))
        assert r.status_code == 200, r.text
    else:
        # Use existing booking
        r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
        assert r.status_code == 200, r.text
        b = r.json()

    # 2. Worker marks work complete (upcoming → work_completed)
    r = client.post(f"/bookings/{booking_id}/mark-work-complete", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "work_completed"

    # 3. Worker submits work report (work_completed → work_reported)
    r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
    existing = r.json()
    agreed_price = existing.get("final_price") or existing.get("estimated_price") or 500
    work_report_payload = {"note": "Work done", "final_price": agreed_price}
    r = client.post(
        f"/bookings/{booking_id}/work-report",
        json=work_report_payload,
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "work_reported"

    # 4. Client confirms work (work_reported → client_confirmed)
    r = client.post(f"/bookings/{booking_id}/confirm-work", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "client_confirmed"

    # 5. Client creates Razorpay order — mock the HTTP call
    razorpay_order_id = f"order_{booking_id}_{wid}"
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "dummy_secret")

    mock_response = {
        "id": razorpay_order_id,
        "amount": 50000,
        "currency": "INR",
        "receipt": f"booking-{booking_id}",
        "status": "created",
        "notes": {"booking_id": str(booking_id)},
    }

    def fake_create_order(*args, **kwargs):
        return mock_response

    with patch("routers.payments.create_razorpay_order", side_effect=fake_create_order):
        r = client.post(
            "/payments/order",
            json={"booking_id": booking_id},
            headers=_auth(ctok),
        )
        assert r.status_code == 200, r.text

    razorpay_payment_id = f"pay_{razorpay_order_id}"

    # 6. Verify payment (client_confirmed → payment_completed)
    msg = f"{razorpay_order_id}|{razorpay_payment_id}"
    signature = hmac.new(key_secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    r = client.post(
        "/payments/verify",
        json={
            "booking_id": booking_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_signature": signature,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "payment_completed"

    # 7. Client posts payment proof (payment_completed → payment_proof_submitted)
    r = client.patch(
        f"/payments/{booking_id}/proof",
        json={"payment_proof_image": "https://example.com/proof.jpg"},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    # Booking is now payment_proof_submitted with paid=True
    r = client.get(f"/bookings/{booking_id}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "payment_proof_submitted"
    return r.json()


def complete_booking_via_work_report(ctok, wtok, wid, client=_test_client, booking_id=None):
    """Bring a booking from `upcoming` to `completed` via the full 8-step
    sequential workflow followed by a client review to auto-complete.

    Delegates to `complete_booking_work_report_to_awaiting_payment` (which now
    goes to `payment_proof_submitted`) and then submits a client review to
    trigger the final auto-completion.

    Returns the booking dict (status=completed).
    """
    b = complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client, booking_id)
    assert b["status"] == "payment_proof_submitted"

    # 8. Client reviews worker → auto-completes booking
    r = client.post(
        "/reviews/",
        json={
            "worker_id": wid,
            "booking_id": b["id"],
            "rating": 5,
            "review_text": "Great work",
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    # 9. Confirm booking is completed and return the fresh state
    r = client.get(f"/bookings/{b['id']}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    return r.json()
