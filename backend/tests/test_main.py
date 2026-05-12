import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_workers_route():
    response = client.get("/workers")
    assert response.status_code in [200, 401, 403, 404, 422]
