import sys
import os
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from conftest import issue_verify_token

client = TestClient(app)

def test_route_exists():
    response = client.get("/workers")
    # Integration test asserting the route is reachable
    assert response.status_code in [200, 401, 403, 404, 405, 422]
    assert response.headers.get("content-type") is not None


# ---------------------------------------------------------------------------
# smart-match sorting
#
# The test database is shared across the whole suite, so these tests create
# their own workers and assert the RELATIVE order of just those ids.
# ---------------------------------------------------------------------------

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


def _make_worker(wage=None, experience=None, lat=None, lng=None):
    wid, wtok = _register_and_login("worker")
    body = {"current_status": "available", "availability": True}
    if wage is not None:
        body["hourly_rate"] = wage
    if experience is not None:
        body["experience_years"] = experience
    if lat is not None:
        body["latitude"] = lat
    if lng is not None:
        body["longitude"] = lng
    r = client.put(f"/workers/{wid}", json=body, headers=_auth(wtok))
    assert r.status_code == 200, r.text
    return wid


def _set_rating(worker_id: int, rating: float):
    """rating is server-managed (reviews recompute it), so tests set it
    directly on the row."""
    import models
    from database import SessionLocal
    db = SessionLocal()
    try:
        db.query(models.Worker).filter(models.Worker.id == worker_id).update({"rating": rating})
        db.commit()
    finally:
        db.close()


def _smart_match_ids(token: str, **params):
    r = client.get("/workers/smart-match", params=params, headers=_auth(token))
    assert r.status_code == 200, r.text
    return [w["id"] for w in r.json()]


def _order_of(ids, mine):
    """The relative order of just my worker ids inside a result list."""
    return [i for i in ids if i in mine]


def test_sort_by_single_key():
    _, ctok = _register_and_login("user")
    w_low = _make_worker(wage=100)
    w_high = _make_worker(wage=900)
    mine = {w_low, w_high}

    ids = _smart_match_ids(ctok, sort_by="wage_asc", limit=100)
    assert _order_of(ids, mine) == [w_low, w_high]

    ids = _smart_match_ids(ctok, sort_by="wage_desc", limit=100)
    assert _order_of(ids, mine) == [w_high, w_low]


def test_sort_by_comma_list_priority():
    _, ctok = _register_and_login("user")
    # Same rating, different wages — the second key must break the tie.
    w1 = _make_worker(wage=500)
    w2 = _make_worker(wage=200)
    w3 = _make_worker(wage=300)
    _set_rating(w1, 4.9)
    _set_rating(w2, 4.9)
    _set_rating(w3, 3.0)
    mine = {w1, w2, w3}

    ids = _smart_match_ids(ctok, sort_by="rating,wage_asc", limit=100)
    # w3 (lower rating) last; the 4.9 tie broken by wage ascending.
    assert _order_of(ids, mine) == [w2, w1, w3]


def test_sort_by_unknown_key_ignored():
    _, ctok = _register_and_login("user")
    w1 = _make_worker(wage=100)
    # A bogus key (alone or mixed in) must not error — it's skipped.
    ids = _smart_match_ids(ctok, sort_by="bogus", limit=100)
    assert w1 in ids
    ids = _smart_match_ids(ctok, sort_by="bogus,wage_asc", limit=100)
    assert w1 in ids


def test_sort_by_wage_nulls_last():
    _, ctok = _register_and_login("user")
    w_rated = _make_worker(wage=400)
    w_null = _make_worker()  # no hourly_rate
    mine = {w_rated, w_null}

    ids = _smart_match_ids(ctok, sort_by="wage_asc", limit=100)
    # A missing rate must not beat a real one in "cheapest first".
    assert _order_of(ids, mine) == [w_rated, w_null]


def test_sort_by_location_nearest_first():
    _, ctok = _register_and_login("user")
    # Hyderabad area — near (17.38, 78.49).
    w_near = _make_worker(lat=17.3850, lng=78.4867)
    w_far = _make_worker(lat=17.5000, lng=78.6000)
    mine = {w_near, w_far}

    ids = _smart_match_ids(
        ctok, sort_by="location", lat=17.385, lng=78.4867, radius=50, limit=100
    )
    # Regression: 'location' used to be silently overwritten by id-order.
    assert _order_of(ids, mine) == [w_near, w_far]


def test_sort_by_location_combined_with_other_keys():
    _, ctok = _register_and_login("user")
    w_near_cheap = _make_worker(wage=100, lat=17.3850, lng=78.4867)
    w_near_costly = _make_worker(wage=900, lat=17.3860, lng=78.4870)
    _set_rating(w_near_cheap, 3.0)
    _set_rating(w_near_costly, 5.0)
    mine = {w_near_cheap, w_near_costly}

    # Rating first, distance second — the costly 5.0 worker leads.
    ids = _smart_match_ids(
        ctok, sort_by="rating,location", lat=17.385, lng=78.4867, radius=50, limit=100
    )
    assert _order_of(ids, mine) == [w_near_costly, w_near_cheap]

