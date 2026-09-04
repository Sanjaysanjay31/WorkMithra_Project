"""Canonical booking status lifecycle for WorkMithra.

Single source of truth shared by the bookings router and socket events:

    pending -> upcoming -> awaiting_payment -> completed
        \\------------> rejected
    awaiting_payment -> unpaid   (worker reports non-payment)

The worker submits a work report to move a job upcoming -> awaiting_payment;
the client then pays (Razorpay) and submits a review, which auto-completes
the booking. A job the client never pays for ends terminal "unpaid".

The statuses, legacy aliases, and active set are defined ONCE in
shared/booking-status.json (repo root) and consumed by both this module and
lib/booking-status.ts — change the JSON, both sides follow.

Legacy values written by older app versions are normalized on write so the
database converges on the canonical set.
"""

import json
from pathlib import Path

_SPEC_PATH = Path(__file__).resolve().parent.parent / "shared" / "booking-status.json"

try:
    with open(_SPEC_PATH, encoding="utf-8") as _f:
        _spec = json.load(_f)
except FileNotFoundError as e:
    raise RuntimeError(
        f"shared/booking-status.json not found at {_SPEC_PATH}. "
        "It is the single source of truth for booking statuses."
    ) from e

BOOKING_STATUSES = tuple(_spec["statuses"])

_LEGACY_MAP = dict(_spec["legacy_map"])

ACTIVE_STATUSES = frozenset(_spec["active"])


def normalize_status(value):
    """Map a raw status string to the canonical enum, or None if invalid."""
    if value is None:
        return None
    s = str(value).strip().lower()
    s = _LEGACY_MAP.get(s, s)
    return s if s in BOOKING_STATUSES else None


def is_active_status(value):
    """True when a (raw or canonical) status is still active."""
    normalized = normalize_status(value)
    return normalized in ACTIVE_STATUSES if normalized else False
