import pytest
from pydantic import ValidationError
import schemas


def test_user_create_schema_validation():
    """Test UserCreate requires full_name and valid role."""
    valid_user = schemas.UserCreate(
        full_name="Anjali Sharma",
        email="anjali@example.com",
        phone="9876543210",
        password="securePassword123",
        role="user",
    )
    assert valid_user.full_name == "Anjali Sharma"
    assert valid_user.role == "user"


def test_price_proposal_validation():
    """Verify PriceProposal requires amount field."""
    proposal = schemas.PriceProposal(amount=750.50)
    assert proposal.amount == 750.50

    with pytest.raises(ValidationError):
        schemas.PriceProposal()  # Missing amount


def test_user_login_validation():
    """Verify UserLogin requires identifier and password."""
    login = schemas.UserLogin(identifier="user@example.com", password="password123")
    assert login.identifier == "user@example.com"
    assert login.password == "password123"

    with pytest.raises(ValidationError):
        schemas.UserLogin()  # Missing identifier & password


def test_withdraw_request_schema():
    """Verify WithdrawRequestCreate enforces amount."""
    req = schemas.WithdrawRequestCreate(amount=1200.0)
    assert req.amount == 1200.0

