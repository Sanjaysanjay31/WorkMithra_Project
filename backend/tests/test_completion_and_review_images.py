"""Both-sides completion + review image tests.

Completion now happens automatically when the client submits a review after
paying via Razorpay (work-report → payment → review → auto-complete).
The old manual PUT /bookings/{id} {status: "completed"} is no longer allowed.
"""
import sys
import os
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token, complete_booking_via_work_report, complete_booking_work_report_to_awaiting_payment

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


def _booking(ctok, wid, **overrides):
    body = {"worker_id": wid, "problem_description": "Fix the sink", **overrides}
    r = client.post("/bookings/", json=body, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    return r.json()


def test_client_cannot_accept_pending_booking():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    # Acceptance stays worker-only — the client can't self-accept.
    r = client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(ctok))
    assert r.status_code == 403, r.text


def test_client_can_mark_upcoming_booking_completed():
    """Submitting a client review after paying auto-completes the booking.
    Verifies all side-effects (job-history, worker stats, notification) match
    what the old manual completion produced."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()

    # Worker stats before completion.
    r = client.get(f"/workers/{wid}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    completed_before = r.json().get("completed_jobs") or 0

    # Bring the booking to completed via the proper chain:
    # worker accepts → work report → client pays → client reviews → auto-complete
    b = complete_booking_via_work_report(ctok, wtok, wid, client)
    assert b["status"] == "completed"

    # Same side effects as the old manual completion:
    # 1. job-history entry visible to the client
    r = client.get(f"/job-history/?with_worker={wid}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    entries = [e for e in r.json() if e.get("booking_id") == b["id"]]
    assert len(entries) == 1

    # 2. worker completed_jobs bumped
    r = client.get(f"/workers/{wid}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    assert (r.json().get("completed_jobs") or 0) == completed_before + 1

    # 3. worker got a completion notification
    r = client.get(
        f"/notifications/?audience=worker&recipient_id={wid}",
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    kinds = [n.get("kind") for n in r.json()]
    assert "booking_completed" in kinds


def test_review_with_image_url():
    """A client review can carry a photo URL, which is returned in list reads."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client)

    image_url = "https://example.supabase.co/storage/v1/object/public/all_images/review_user_1/x.jpg"
    r = client.post(
        "/reviews/",
        json={
            "worker_id": wid,
            "booking_id": b["id"],
            "rating": 5,
            "review_text": "Great work, photo attached",
            "review_image": image_url,
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    assert r.json()["review_image"] == image_url

    # The photo rides along on list reads too.
    r = client.get(f"/reviews/?worker_id={wid}", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    mine = [x for x in r.json() if x.get("review_text") == "Great work, photo attached"]
    assert mine and mine[0]["review_image"] == image_url


def test_review_image_must_be_http_url():
    """A non-HTTP review_image value is rejected."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client)

    # Worker reviews the client (worker can only review after payment_proof_submitted)
    r = client.post(
        "/reviews/",
        json={"user_id": cid, "booking_id": b["id"], "rating": 4, "review_text": "ok"},
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text

    # Client tries to attach a non-HTTP review image — must be rejected.
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": b["id"], "rating": 4, "review_text": "ok", "review_image": "javascript:alert(1)"},
        headers=_auth(ctok),
    )
    assert r.status_code == 400, r.text


def _url(i: int) -> str:
    return f"https://example.supabase.co/storage/v1/object/public/all_images/review_user_9/p{i}.jpg"


def test_review_accepts_five_images_and_keeps_legacy_field_synced():
    """Reviews can carry up to 5 photo URLs; the legacy single-image field
    stays synced to the first photo."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client)

    urls = [_url(i) for i in range(5)]
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": b["id"], "rating": 5, "review_text": "five photos", "review_images": urls},
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["review_images"] == urls
    # Backward compatibility: the legacy single-image field mirrors photo #1.
    assert body["review_image"] == urls[0]

    r = client.get(f"/reviews/?worker_id={wid}", headers=_auth(ctok))
    mine = [x for x in r.json() if x.get("review_text") == "five photos"]
    assert mine and mine[0]["review_images"] == urls


def test_review_rejects_more_than_five_images():
    """Six photos in review_images are rejected."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client)

    six_urls = [_url(i) for i in range(6)]
    r = client.post(
        "/reviews/",
        json={"worker_id": wid, "booking_id": b["id"], "rating": 5, "review_text": "six photos", "review_images": six_urls},
        headers=_auth(ctok),
    )
    assert r.status_code in (400, 422), r.text

    # No review must have been created.
    r = client.get(f"/reviews/?worker_id={wid}", headers=_auth(ctok))
    assert all(x.get("review_text") != "six photos" for x in r.json())


def test_review_multi_image_urls_must_be_http():
    """A non-HTTP URL in review_images is rejected."""
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = complete_booking_work_report_to_awaiting_payment(ctok, wtok, wid, client)

    r = client.post(
        "/reviews/",
        json={
            "worker_id": wid,
            "booking_id": b["id"],
            "rating": 3,
            "review_text": "bad array entry",
            "review_images": [_url(0), "file:///etc/passwd"],
        },
        headers=_auth(ctok),
    )
    assert r.status_code in (400, 422), r.text
