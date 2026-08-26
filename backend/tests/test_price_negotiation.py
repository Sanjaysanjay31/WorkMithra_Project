"""Price negotiation regression tests.

Locks in the quote → counter → accept lifecycle:
  estimated_price holds the latest proposal, price_proposed_by says who made
  it, and acceptance copies it into final_price — after which the price is
  locked against unilateral changes from either side.
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


def test_worker_quote_then_client_accepts():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    # Worker quotes ₹500.
    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 500}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estimated_price"] == 500
    assert body["final_price"] is None
    assert body["price_proposed_by"] == "worker"

    # Worker cannot accept their own quote.
    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(wtok))
    assert r.status_code == 400, r.text

    # Client accepts → price locked.
    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(ctok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["final_price"] == 500
    assert body["estimated_price"] == 500

    # Locked: worker can't rewrite the agreed price via PUT or new proposal.
    r = client.put(f"/bookings/{b['id']}", json={"estimated_price": 999}, headers=_auth(wtok))
    assert r.status_code == 400, r.text
    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 999}, headers=_auth(wtok))
    assert r.status_code == 400, r.text


def test_client_counter_then_worker_accepts():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    # Worker quotes ₹800, client counters ₹600.
    client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 800}, headers=_auth(wtok))
    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 600}, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estimated_price"] == 600
    assert body["price_proposed_by"] == "user"

    # Client can't accept their own counter.
    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(ctok))
    assert r.status_code == 400, r.text

    # Worker accepts the counter.
    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["final_price"] == 600


def test_client_budget_at_booking_is_a_proposal():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid, estimated_price=300)

    assert b["estimated_price"] == 300
    assert b["price_proposed_by"] == "user"

    # The worker can accept the client's budget outright.
    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["final_price"] == 300


def test_client_price_via_put_is_still_rejected():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    r = client.put(f"/bookings/{b['id']}", json={"estimated_price": 100}, headers=_auth(ctok))
    assert r.status_code == 200, r.text  # request succeeds…
    assert r.json()["estimated_price"] is None  # …but the price field was dropped


def test_accept_without_any_proposal():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(ctok))
    assert r.status_code == 400, r.text


def test_non_participant_blocked():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    other_id, other_tok = _register_and_login("user")
    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 5}, headers=_auth(other_tok))
    assert r.status_code == 403, r.text
    r = client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(other_tok))
    assert r.status_code == 403, r.text


def test_invalid_amounts_rejected():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 0}, headers=_auth(ctok))
    assert r.status_code == 422, r.text
    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": -10}, headers=_auth(ctok))
    assert r.status_code == 422, r.text
    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 99_999_999}, headers=_auth(ctok))
    assert r.status_code == 400, r.text


def test_terminal_booking_price_frozen():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    # Full lifecycle: quote → accept price → accept job → complete.
    client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 500}, headers=_auth(wtok))
    client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(ctok))
    client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    r = client.put(f"/bookings/{b['id']}", json={"status": "completed"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    # Completion settles the agreed price as final.
    assert r.json()["final_price"] == 500

    r = client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 700}, headers=_auth(ctok))
    assert r.status_code == 400, r.text


def test_completion_settles_unagreed_price():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    # Job finishes without explicit agreement — the last number on the table
    # (here a worker quote) becomes the final price.
    client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 450}, headers=_auth(wtok))
    client.put(f"/bookings/{b['id']}", json={"status": "upcoming"}, headers=_auth(wtok))
    r = client.put(f"/bookings/{b['id']}", json={"status": "completed"}, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    assert r.json()["final_price"] == 450


def test_price_events_create_notifications():
    cid, ctok = _register_and_login("user")
    wid, wtok = _available_worker()
    b = _booking(ctok, wid)

    client.post(f"/bookings/{b['id']}/propose-price", json={"amount": 500}, headers=_auth(wtok))

    # The client's inbox now carries the quote notification.
    r = client.get("/notifications/?audience=user&recipient_id=%d" % cid, headers=_auth(ctok))
    assert r.status_code == 200, r.text
    kinds = [n["kind"] for n in r.json()]
    assert "price_proposed" in kinds

    client.post(f"/bookings/{b['id']}/accept-price", headers=_auth(ctok))

    # The worker's inbox carries the agreement notification.
    r = client.get("/notifications/?audience=worker&recipient_id=%d" % wid, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    kinds = [n["kind"] for n in r.json()]
    assert "price_agreed" in kinds
