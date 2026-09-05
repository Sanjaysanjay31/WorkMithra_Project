import pytest
from sqlalchemy import text
import database
import models


def test_database_connection():
    """Test that the database connection is active and executes simple queries."""
    db = database.SessionLocal()
    try:
        result = db.execute(text("SELECT 1")).scalar()
        assert result == 1
    finally:
        db.close()


def test_session_lifecycle():
    """Test that get_db generator properly yields a session and closes it."""
    gen = database.get_db()
    session = next(gen)
    assert session is not None
    assert session.is_active
    # Advance generator to simulate request completion and closure
    with pytest.raises(StopIteration):
        next(gen)


def test_metadata_tables_exist():
    """Verify that all essential tables are mapped in SQLAlchemy metadata."""
    table_names = models.Base.metadata.tables.keys()
    assert "users" in table_names
    assert "workers" in table_names
    assert "bookings" in table_names
    assert "payments" in table_names
    assert "notifications" in table_names
    assert "chat_messages" in table_names
    assert "ratings_reviews" in table_names
    assert "withdrawal_requests" in table_names

