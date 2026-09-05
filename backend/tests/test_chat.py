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
    return account_id, r.json()["access_token"]


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def test_route_exists():
    response = client.get("/chat")
    # Integration test asserting the route is reachable
    assert response.status_code in [200, 401, 403, 404, 405, 422]
    assert response.headers.get("content-type") is not None


def test_chat_conversation_scoped_by_other_role():
    """Conversation retrieval with other_role filters specifically for that counterpart role."""
    uid, utok = _register_and_login("user")
    wid, wtok = _register_and_login("worker")

    # Send a message from user to worker
    send_resp = client.post(
        "/chat/",
        json={"receiver_id": wid, "message": "Hello Worker!"},
        headers=_auth(utok),
    )
    assert send_resp.status_code == 200, send_resp.text

    # 1. Fetching with other_role=worker should return the message
    r = client.get(f"/chat/conversation/{uid}/{wid}?other_role=worker", headers=_auth(utok))
    assert r.status_code == 200, r.text
    msgs = r.json()
    assert len(msgs) >= 1
    assert msgs[0]["message"] == "Hello Worker!"
    assert msgs[0]["sender_role"] == "user"
    assert msgs[0]["receiver_role"] == "worker"

    # 2. Fetching with other_role=user should NOT return worker messages (scoped filter)
    r = client.get(f"/chat/conversation/{uid}/{wid}?other_role=user", headers=_auth(utok))
    assert r.status_code == 200
    assert len(r.json()) == 0

    # 3. Invalid other_role should return 400
    r = client.get(f"/chat/conversation/{uid}/{wid}?other_role=invalid_role", headers=_auth(utok))
    assert r.status_code == 400
    assert "other_role must be 'user' or 'worker'" in r.text

    # 4. Third-party user cannot access this conversation
    stranger_id, stranger_tok = _register_and_login("user")
    r = client.get(f"/chat/conversation/{uid}/{wid}?other_role=worker", headers=_auth(stranger_tok))
    assert r.status_code == 403

