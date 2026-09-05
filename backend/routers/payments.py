"""Razorpay payments (TEST MODE) for WorkMithra.

Flow: the worker submits a work report (booking -> 'awaiting_payment'), the
client opens a Razorpay order here, pays in the in-app checkout, and the
checkout callback is verified server-side before the payment is accepted:

    POST /payments/order    -> create Razorpay order + Payment row ('created')
    POST /payments/verify   -> HMAC-verify the checkout signature -> 'paid'
    GET  /payments/booking/{id} -> payment state for UI badges

Security notes:
  - Only the booking's CLIENT can create/verify a payment for it.
  - The amount is always the locked final_price — never client-supplied.
  - The key SECRET never leaves the backend; the checkout only receives the
    public key id (returned by /order).
  - Verification is HMAC_SHA256(order_id + "|" + payment_id, key_secret),
    Razorpay's standard checkout signature. A tampered payload is rejected
    and recorded as 'failed'.
  - The Razorpay HTTP call is isolated in create_razorpay_order() so tests
    can monkeypatch it without network access.
"""

import hashlib
import hmac
import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

import database, models, schemas
from auth import get_current_user
from rate_limit import limiter
from routers.notifications import build_notification, publish_notification
from socket_events import emit_to_user

router = APIRouter()

_RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"


def _key_id() -> str:
    return os.getenv("RAZORPAY_KEY_ID", "").strip()


def _key_secret() -> str:
    return os.getenv("RAZORPAY_KEY_SECRET", "").strip()


def _webhook_secret() -> str:
    return os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip() or _key_secret()


def _require_configured() -> None:
    """Payments are optional at startup — but calling them without keys must
    fail with a clean 503 instead of a half-built order."""
    if not _key_id() or not _key_secret():
        raise HTTPException(
            status_code=503,
            detail="Payments are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)",
        )


def create_razorpay_order(amount_paise: int, receipt: str, notes: Dict[str, Any]) -> Dict[str, Any]:
    """Create an order on Razorpay. Isolated so tests can monkeypatch it.
    Raises HTTPException(502) when the gateway rejects/fails the request."""
    resp = requests.post(
        _RAZORPAY_ORDERS_URL,
        auth=(_key_id(), _key_secret()),
        json={
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": notes,
            "payment_capture": 1,
        },
        timeout=20,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Razorpay order creation failed (HTTP {resp.status_code})",
        )
    data = resp.json()
    if not data.get("id"):
        raise HTTPException(status_code=502, detail="Razorpay returned an invalid order")
    return data


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


def _load_booking(db: Session, booking_id: int) -> models.Booking:
    booking = (
        db.query(models.Booking)
        .filter(models.Booking.id == booking_id)
        .with_for_update()
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking


def _assert_client(booking: models.Booking, current: Dict[str, Any]) -> int:
    """Only the booking's client (role 'user') pays. A worker token must not
    open or verify payments on their own booking."""
    uid = _current_user_id(current)
    if current.get("role") == "worker" or booking.user_id != uid:
        raise HTTPException(status_code=403, detail="Only the customer can pay for this booking")
    return uid


def _assert_participant(booking: models.Booking, current: Dict[str, Any]) -> None:
    uid = _current_user_id(current)
    role = current.get("role")
    if role == "worker":
        if booking.worker_id != uid:
            raise HTTPException(status_code=403, detail="Not your booking")
    else:
        if booking.user_id != uid:
            raise HTTPException(status_code=403, detail="Not your booking")


def _paid_payment(db: Session, booking_id: int) -> Optional[models.Payment]:
    return (
        db.query(models.Payment)
        .filter(
            models.Payment.booking_id == booking_id,
            models.Payment.payment_status == "paid",
        )
        .first()
    )


def is_booking_paid(db: Session, booking_id: int) -> bool:
    """Shared with the reviews router: the client's review (and the booking's
    auto-completion) is gated on a verified payment."""
    return _paid_payment(db, booking_id) is not None


def _fmt_price(value) -> str:
    return f"₹{float(value):g}"


@router.post("/order", response_model=schemas.PaymentOrderResponse)
@limiter.limit("10/minute")
def create_order(
    request: Request,
    payload: schemas.PaymentOrderRequest,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Open a Razorpay order for the booking's locked final_price and return
    everything the app needs to launch Razorpay Checkout."""
    _require_configured()
    booking = _load_booking(db, payload.booking_id)
    uid = _assert_client(booking, current)

    status = (booking.status or "").strip().lower()
    if status != "client_confirmed":
        raise HTTPException(
            status_code=400,
            detail="Payment is only open after the client confirms the work report",
        )
    if _paid_payment(db, booking.id) is not None:
        raise HTTPException(status_code=409, detail="This booking is already paid")
    if booking.final_price is None:
        # Work-report submission settles the price, so this shouldn't happen —
        # guard anyway rather than opening a ₹0 order.
        raise HTTPException(status_code=400, detail="No agreed price to pay for this booking")

    amount = float(booking.final_price)
    amount_paise = int(round(amount * 100))

    # One open Payment row per booking: reuse a 'created'/'pending' row so
    # retries don't pile up orphan rows; a fresh row otherwise.
    payment = (
        db.query(models.Payment)
        .filter(
            models.Payment.booking_id == booking.id,
            models.Payment.payment_status.in_(["created", "pending", "failed"]),
        )
        .order_by(models.Payment.id.desc())
        .first()
    )

    order = create_razorpay_order(
        amount_paise,
        receipt=f"booking-{booking.id}",
        notes={"booking_id": booking.id, "user_id": booking.user_id, "worker_id": booking.worker_id},
    )

    if payment is None:
        payment = models.Payment(
            booking_id=booking.id,
            user_id=uid,
            worker_id=booking.worker_id,
            amount=amount,
        )
        db.add(payment)
    payment.payment_method = "razorpay"
    payment.payment_status = "created"
    payment.razorpay_order_id = order["id"]
    db.commit()
    db.refresh(payment)

    return schemas.PaymentOrderResponse(
        payment_id=payment.id,
        order_id=order["id"],
        key_id=_key_id(),
        amount_paise=amount_paise,
        amount=amount,
        currency="INR",
    )


@router.post("/verify", response_model=schemas.PaymentResponse)
@limiter.limit("10/minute")
def verify_payment(
    request: Request,
    payload: schemas.PaymentVerifyRequest,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Verify the Razorpay Checkout success signature and mark the booking
    paid. The signature binds order+payment to our key secret, so a client
    can't fake success with a forged payment id."""
    _require_configured()
    booking = _load_booking(db, payload.booking_id)
    _assert_client(booking, current)

    payment = (
        db.query(models.Payment)
        .filter(
            models.Payment.booking_id == booking.id,
            models.Payment.razorpay_order_id == payload.razorpay_order_id,
        )
        .order_by(models.Payment.id.desc())
        .first()
    )
    if payment is None:
        raise HTTPException(status_code=404, detail="No payment request found for this order")
    if payment.payment_status == "paid":
        return payment  # idempotent: a retried verify succeeds

    expected = hmac.new(
        _key_secret().encode("utf-8"),
        f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature or ""):
        payment.payment_status = "failed"
        payment.razorpay_payment_id = payload.razorpay_payment_id
        payment.razorpay_signature = payload.razorpay_signature
        db.commit()
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    payment.payment_status = "paid"
    payment.payment_method = "razorpay"
    payment.transaction_id = payload.razorpay_payment_id
    payment.razorpay_payment_id = payload.razorpay_payment_id
    payment.razorpay_signature = payload.razorpay_signature
    payment.paid_at = datetime.utcnow()

    # Move booking to payment_completed — this unlocks the payment proof step.
    booking.status = "payment_completed"

    # Persist the worker's notification in the SAME transaction so an offline
    # worker still sees it later; publish (socket + push) after the commit.
    notif = None
    if booking.worker_id is not None:
        notif = build_notification(
            db, booking.worker_id, "worker", "payment_received",
            "Payment received 💰",
            f"The client paid {_fmt_price(payment.amount)} for your job. Once they submit a review and proof, the booking completes.",
        )
    db.commit()
    db.refresh(payment)

    if notif is not None:
        publish_notification(db, notif, "worker")
    # Realtime badge flip on the worker's requests screen.
    if booking.worker_id is not None:
        emit_to_user(booking.worker_id, "payment_received", {
            "booking_id": booking.id,
            "payment_id": payment.id,
            "amount": float(payment.amount),
            "timestamp": datetime.utcnow().isoformat(),
        }, role="worker")

    return payment


@router.post("/webhook")
async def razorpay_webhook(
    request: Request,
    db: Session = Depends(database.get_db),
):
    """Server-to-server Razorpay webhook listener. Reconciles payments if the mobile
    client dropped connection or closed the app during checkout."""
    secret = _webhook_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook not configured")

    signature = request.headers.get("X-Razorpay-Signature", "")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing X-Razorpay-Signature header")

    raw_body = await request.body()
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        event_data = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event_type = event_data.get("event")
    if event_type in ("payment.captured", "order.paid"):
        payload_data = event_data.get("payload", {})
        entity = (
            payload_data.get("payment", {}).get("entity")
            or payload_data.get("order", {}).get("entity", {})
        )
        order_id = entity.get("order_id") or entity.get("id")
        payment_id = entity.get("id") if entity.get("order_id") else None

        payment = (
            db.query(models.Payment)
            .filter(models.Payment.razorpay_order_id == order_id)
            .order_by(models.Payment.id.desc())
            .first()
        )
        if payment and payment.payment_status != "paid":
            payment.payment_status = "paid"
            if payment_id:
                payment.transaction_id = payment_id
                payment.razorpay_payment_id = payment_id
            payment.paid_at = datetime.utcnow()

            booking = db.query(models.Booking).filter(models.Booking.id == payment.booking_id).first()
            if booking and booking.status != "completed":
                booking.status = "payment_completed"

            notif = None
            if payment.worker_id is not None:
                notif = build_notification(
                    db,
                    payment.worker_id,
                    "worker",
                    "payment_received",
                    "Payment received 💰",
                    f"The client paid {_fmt_price(payment.amount)} for your job (verified via webhook).",
                )
            db.commit()
            if notif is not None:
                publish_notification(db, notif, "worker")
            if payment.worker_id is not None:
                emit_to_user(
                    payment.worker_id,
                    "payment_received",
                    {
                        "booking_id": payment.booking_id,
                        "payment_id": payment.id,
                        "amount": float(payment.amount),
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                    role="worker",
                )

    return {"status": "ok", "event": event_type}


@router.patch("/{booking_id}/proof", response_model=schemas.PaymentResponse)
def upload_payment_proof(
    booking_id: int,
    payload: schemas.PaymentProofRequest,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Upload a payment proof screenshot/UPI reference after a successful payment.
    Only the client who made the payment can add proof, and only after payment
    is verified (booking in 'payment_completed'). Moves the booking to
    'payment_proof_submitted', which unlocks the review step."""
    booking = _load_booking(db, booking_id)
    _assert_client(booking, current)

    payment = _paid_payment(db, booking_id)
    if payment is None:
        raise HTTPException(status_code=400, detail="Payment must be completed before uploading proof")

    status = (booking.status or "").strip().lower()
    if status != "payment_completed":
        raise HTTPException(
            status_code=400,
            detail="Payment must be completed before uploading proof",
        )

    payment.payment_proof_image = payload.payment_proof_image
    booking.status = "payment_proof_submitted"
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/booking/{booking_id}", response_model=Optional[schemas.PaymentResponse])
def booking_payment(
    booking_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Latest payment state for a booking (either participant) — the client
    screen uses it to swap Pay/Rate buttons, the worker screen for the Paid
    badge. Null when no payment was ever opened."""
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _assert_participant(booking, current)

    payment = (
        db.query(models.Payment)
        .filter(models.Payment.booking_id == booking_id)
        .order_by(
            # 'paid' first so a paid row always wins over stale open ones,
            # then newest.
            models.Payment.payment_status != "paid",
            models.Payment.id.desc(),
        )
        .first()
    )
    return payment


# ── Withdrawal Requests ────────────────────────────────────────────────────────

@router.post("/withdraw", response_model=schemas.WithdrawalRequestResponse)
@limiter.limit("5/minute")
def request_withdrawal(
    request: Request,
    payload: schemas.WithdrawRequestCreate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Worker requests a withdrawal of their available balance. The amount is
    validated against the worker's computed available balance (sum of paid payments
    minus prior successful withdrawals). The admin updates the status directly in
    the database (Supabase) to 'success' or 'failed'."""
    if current.get("role") != "worker":
        raise HTTPException(status_code=403, detail="Only workers can request withdrawals")

    worker_id = _current_user_id(current)

    # Pessimistic row lock to eliminate race conditions between concurrent withdrawal requests
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).with_for_update().first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    # SQL-level aggregation instead of loading all payment rows into memory
    total_received = float(
        db.query(func.coalesce(func.sum(models.Payment.amount), 0))
        .filter(
            models.Payment.worker_id == worker_id,
            models.Payment.payment_status == "paid",
        )
        .scalar() or 0.0
    )

    # Subtract both successful AND pending withdrawals (deducted immediately to avoid double-spend)
    total_withdrawn = float(
        db.query(func.coalesce(func.sum(models.WithdrawalRequest.amount), 0))
        .filter(
            models.WithdrawalRequest.worker_id == worker_id,
            models.WithdrawalRequest.status.in_(["success", "pending"]),
        )
        .scalar() or 0.0
    )

    available = total_received - total_withdrawn
    if payload.amount > available + 0.01:  # small float tolerance
        raise HTTPException(
            status_code=400,
            detail=f"Amount exceeds available balance of ₹{available:.2f}",
        )

    # Prevent duplicate pending requests.
    pending = db.query(models.WithdrawalRequest).filter(
        models.WithdrawalRequest.worker_id == worker_id,
        models.WithdrawalRequest.status == "pending",
    ).first()
    if pending is not None:
        raise HTTPException(
            status_code=409,
            detail="A withdrawal request is already pending. Wait for it to be processed.",
        )

    withdrawal = models.WithdrawalRequest(
        worker_id=worker_id,
        amount=payload.amount,
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db.add(withdrawal)
    db.commit()
    db.refresh(withdrawal)
    return withdrawal


@router.get("/withdraw/history", response_model=List[schemas.WithdrawalRequestResponse])
def withdraw_history(
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Returns all withdrawal requests for the current worker, newest first."""
    if current.get("role") != "worker":
        raise HTTPException(status_code=403, detail="Only workers can view their withdrawal history")

    worker_id = _current_user_id(current)
    return (
        db.query(models.WithdrawalRequest)
        .filter(models.WithdrawalRequest.worker_id == worker_id)
        .order_by(models.WithdrawalRequest.requested_at.desc())
        .all()
    )


# ── Worker Bank Account ─────────────────────────────────────────────────────────

@router.get("/bank-account", response_model=Optional[schemas.WorkerBankAccountResponse])
def get_bank_account(
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Returns the worker's saved bank account / UPI details."""
    if current.get("role") != "worker":
        raise HTTPException(status_code=403, detail="Only workers can view their bank details")

    worker_id = _current_user_id(current)
    return (
        db.query(models.WorkerBankAccount)
        .filter(models.WorkerBankAccount.worker_id == worker_id)
        .first()
    )


@router.put("/bank-account", response_model=schemas.WorkerBankAccountResponse)
def save_bank_account(
    payload: schemas.WorkerBankAccountBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Upserts the worker's bank account / UPI details. Clears any field set to
    an empty string so NULL is stored instead."""
    if current.get("role") != "worker":
        raise HTTPException(status_code=403, detail="Only workers can save bank details")

    worker_id = _current_user_id(current)

    bank_account = (
        db.query(models.WorkerBankAccount)
        .filter(models.WorkerBankAccount.worker_id == worker_id)
        .first()
    )

    cleaned = {k: (v if v else None) for k, v in payload.model_dump().items()}

    if bank_account is None:
        bank_account = models.WorkerBankAccount(worker_id=worker_id, **cleaned)
        db.add(bank_account)
    else:
        for key, value in cleaned.items():
            setattr(bank_account, key, value)
        bank_account.worker_id = worker_id  # ensure FK is set

    db.commit()
    db.refresh(bank_account)
    return bank_account
