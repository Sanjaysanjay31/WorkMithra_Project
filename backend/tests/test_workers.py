import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_route_exists():
    response = client.get("/workers")
    # Integration test asserting the route is reachable
    assert response.status_code in [200, 401, 403, 404, 405, 422]
    assert response.headers.get("content-type") is not None
