"""Realtime notification emit regression tests.

Every persisted notification must be pushed to the recipient's private socket
room as 'notification_created' (with a fresh unread count) — this is what
lets the badge screens drop their polling interval.
"""
import os
import sys
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token
import routers.notifications as notifications_router

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


def _booking(ctok, wid):
    body = {"worker_id": wid, "problem_description": "Fix the sink"}
    r = client.post("/bookings/", json=body, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    return r.json()


def _capture_emits(monkeypatch):
    events = []

    def fake_emit(user_id, event, data, role="user"):
        events.append((user_id, event, data, role))
        return True

    # publish_notification() resolves emit_to_user from this module's globals,
    # so patching here covers both the POST endpoint and the bookings flow.
    monkeypatch.setattr(notifications_router, "emit_to_user", fake_emit)
    return events


def test_create_notification_emits_socket_event(monkeypatch):
    events = _capture_emits(monkeypatch)
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    _booking(ctok, wid)  # anti-spoofing: sender must share a booking
    # Booking creation itself now persists+pushes a worker notification
    # ("new booking request"), so the inbox already has one unread row.
    assert len(events) == 1
    assert events[0][1] == "notification_created"
    assert events[0][2]["kind"] == "booking_request"

    r = client.post(
        "/notifications/",
        json={
            "audience": "worker",
            "recipient_id": str(wid),
            "title": "Hello",
            "body": "On my way",
            "kind": "info",
        },
        headers=_auth(ctok),
    )
    assert r.status_code == 200, r.text

    assert len(events) == 2
    user_id, event, data, role = events[-1]
    assert user_id == wid
    assert event == "notification_created"
    assert role == "worker"
    assert data["title"] == "Hello"
    assert data["kind"] == "info"
    assert data["read"] is False
    assert data["unread_count"] == 2


def test_booking_request_persists_worker_notification(monkeypatch):
    """A booking request must leave a DB row behind, not just a socket ping —
    an OFFLINE worker must still find the request in their inbox."""
    events = _capture_emits(monkeypatch)
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    # Socket push happened for the online worker...
    assert len(events) == 1
    assert events[0][1] == "notification_created"
    assert events[0][2]["kind"] == "booking_request"

    # ...and the row is queryable by the worker afterwards.
    r = client.get(
        f"/notifications/?audience=worker&recipient_id={wid}",
        headers=_auth(wtok),
    )
    assert r.status_code == 200, r.text
    rows = r.json()
    assert any(
        n["kind"] == "booking_request" and n["read"] is False for n in rows
    ), rows


def test_price_proposal_emits_notification_created(monkeypatch):
    events = _capture_emits(monkeypatch)
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 500}, headers=_auth(wtok))
    assert r.status_code == 200, r.text

    # events[0] is the booking-request notification to the worker; the price
    # proposal is the second push, aimed at the client.
    assert len(events) == 2
    user_id, event, data, role = events[-1]
    assert user_id == cid
    assert event == "notification_created"
    assert role == "user"
    assert data["kind"] == "price_proposed"
    assert data["unread_count"] == 1


def test_unread_count_tracks_emitted_payload(monkeypatch):
    events = _capture_emits(monkeypatch)
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    _booking(ctok, wid)

    for i in range(2):
        r = client.post(
            "/notifications/",
            json={
                "audience": "worker",
                "recipient_id": str(wid),
                "title": f"Msg {i}",
                "body": "body",
                "kind": "info",
            },
            headers=_auth(ctok),
        )
        assert r.status_code == 200, r.text

    # The emitted counts are cumulative, so a badge can trust the latest one.
    # events[0] is the booking-request push (count 1); the two explicit
    # messages continue the sequence at 2 and 3.
    assert [e[2]["unread_count"] for e in events] == [1, 2, 3]
    r = client.get(f"/notifications/unread-count?audience=worker&recipient_id={wid}", headers=_auth(wtok))
    assert r.status_code == 200
    assert r.json()["count"] == 3
