"""Regression tests for the extended profile fields.

The app's profile forms edit age / alternate_phone / timings / pincode /
location — these used to be silently dropped because the columns didn't
exist. These tests lock in that every field round-trips: write via PUT,
read back via GET, for both roles.
"""
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


def test_worker_extended_fields_round_trip():
    wid, wtok = _register_and_login("worker")
    updates = {
        "age": 34,
        "alternate_phone": "+919999888877",
        "timings": "Mon-Sat 9am-6pm",
        "pincode": "500081",
        "location": "Madhapur, Hyderabad",
    }
    r = client.put(f"/workers/{wid}", json=updates, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    body = r.json()
    for key, value in updates.items():
        assert body[key] == value, f"{key} missing from PUT response: {body}"

    # Read back through the directory endpoint too (uses the manual serializer).
    r = client.get(f"/workers/{wid}", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    body = r.json()
    for key, value in updates.items():
        assert body[key] == value, f"{key} missing from GET response: {body}"


def test_user_extended_fields_round_trip():
    uid, utok = _register_and_login("user")
    updates = {
        "age": 28,
        "alternate_phone": "+917777666655",
        "location": "Gachibowli, Hyderabad",
    }
    r = client.put(f"/profiles/user/{uid}", json=updates, headers=_auth(utok))
    assert r.status_code == 200, r.text
    body = r.json()
    for key, value in updates.items():
        assert body[key] == value, f"{key} missing from PUT response: {body}"

    r = client.get(f"/profiles/user/{uid}", headers=_auth(utok))
    assert r.status_code == 200, r.text
    body = r.json()
    for key, value in updates.items():
        assert body[key] == value, f"{key} missing from GET response: {body}"


def test_age_validation_bounds():
    wid, wtok = _register_and_login("worker")
    r = client.put(f"/workers/{wid}", json={"age": -5}, headers=_auth(wtok))
    assert r.status_code == 422, r.text
    r = client.put(f"/workers/{wid}", json={"age": 200}, headers=_auth(wtok))
    assert r.status_code == 422, r.text

    uid, utok = _register_and_login("user")
    r = client.put(f"/profiles/user/{uid}", json={"age": 150}, headers=_auth(utok))
    assert r.status_code == 422, r.text


def test_partial_update_keeps_other_fields():
    wid, wtok = _register_and_login("worker")
    client.put(
        f"/workers/{wid}",
        json={"age": 40, "timings": "Sun 10am-2pm", "bio": "Careful and quick"},
        headers=_auth(wtok),
    )
    # Updating only the bio must not wipe age/timings (partial update).
    r = client.put(f"/workers/{wid}", json={"bio": "Updated bio"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bio"] == "Updated bio"
    assert body["age"] == 40
    assert body["timings"] == "Sun 10am-2pm"
