"""Push token registration + device push delivery tests.

System pushes go through the Expo push API: devices register their token at
POST /notifications/push-token (role always derived from the JWT), and every
published notification fans out to the recipient's registered tokens.
"""
import os
import sys
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token
import database
import models
import routers.notifications as notifications_router

client = TestClient(app)


def _uniq():
    return uuid.uuid4().hex[:10]


def _register_and_login(role: str):
    tag = _uniq()
    email = f"push-{role}-{tag}@example.com"
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


def test_register_push_token_requires_auth():
    r = client.post("/notifications/push-token", json={"token": "ExpoPushToken[anon]"})
    assert r.status_code == 401


def test_register_push_token_rejects_empty():
    _, tok = _register_and_login("user")
    r = client.post("/notifications/push-token", json={"token": "   "}, headers=_auth(tok))
    assert r.status_code == 400


def test_register_push_token_binds_caller_role_from_jwt():
    uid, tok = _register_and_login("worker")
    token_value = f"ExpoPushToken[{_uniq()}]"
    r = client.post("/notifications/push-token", json={"token": token_value}, headers=_auth(tok))
    assert r.status_code == 200, r.text

    db = database.SessionLocal()
    try:
        row = db.query(models.PushToken).filter_by(token=token_value).first()
        assert row is not None
        assert row.user_id == int(uid)
        # Role comes from the JWT — a worker account must be stored as worker.
        assert row.role == "worker"
    finally:
        db.close()


def test_reregister_reassigns_token_to_new_account():
    _, tok_a = _register_and_login("user")
    uid_b, tok_b = _register_and_login("user")
    token_value = f"ExpoPushToken[{_uniq()}]"

    r = client.post("/notifications/push-token", json={"token": token_value}, headers=_auth(tok_a))
    assert r.status_code == 200
    r = client.post("/notifications/push-token", json={"token": token_value}, headers=_auth(tok_b))
    assert r.status_code == 200

    db = database.SessionLocal()
    try:
        rows = db.query(models.PushToken).filter_by(token=token_value).all()
        # Exactly one owner — the stale binding to account A is gone.
        assert len(rows) == 1
        assert rows[0].user_id == int(uid_b)
    finally:
        db.close()


def test_unregister_removes_caller_tokens():
    _, tok = _register_and_login("user")
    r = client.post("/notifications/push-token", json={"token": f"ExpoPushToken[{_uniq()}]"}, headers=_auth(tok))
    assert r.status_code == 200
    r = client.delete("/notifications/push-token", headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["deleted"] >= 1


def test_send_expo_push_posts_expected_payload(monkeypatch):
    calls = {}

    def fake_post(url, json=None, timeout=None):
        calls["url"] = url
        calls["json"] = json
        calls["timeout"] = timeout

        class _Resp:
            status_code = 200

        return _Resp()

    monkeypatch.setattr(notifications_router.requests, "post", fake_post)
    notifications_router._send_expo_push(
        ["ExpoPushToken[abc]"], "New booking", "Body text", {"id": 7, "kind": "booking_request"}
    )
    assert calls["url"] == notifications_router.EXPO_PUSH_URL
    msg = calls["json"][0]
    assert msg["to"] == "ExpoPushToken[abc]"
    assert msg["title"] == "New booking"
    assert msg["data"]["kind"] == "booking_request"


def test_publish_pushes_to_registered_device(monkeypatch):
    """publish_notification must fan out to the recipient's push tokens."""
    wid, wtok = _register_and_login("worker")
    token_value = f"ExpoPushToken[{_uniq()}]"
    r = client.post("/notifications/push-token", json={"token": token_value}, headers=_auth(wtok))
    assert r.status_code == 200

    captured = {}

    class _InlineThread:
        def __init__(self, target=None, args=(), daemon=None):
            target(*args)

        def start(self):
            pass

    monkeypatch.setattr(notifications_router.threading, "Thread", _InlineThread)
    monkeypatch.setattr(
        notifications_router,
        "_send_expo_push",
        lambda tokens, title, body, data: captured.update(tokens=tokens, title=title, body=body, data=data),
    )

    db = database.SessionLocal()
    try:
        n = notifications_router.build_notification(
            db, int(wid), "worker", "booking_request", "New request", "A client booked you"
        )
        db.commit()
        db.refresh(n)
        notifications_router.publish_notification(db, n, "worker")
    finally:
        db.close()

    assert captured["tokens"] == [token_value]
    assert captured["title"] == "New request"
    assert captured["data"]["kind"] == "booking_request"
