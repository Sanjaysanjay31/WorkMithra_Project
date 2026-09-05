import database
import models


def test_user_model_instantiation():
    """Verify User model fields and default values."""
    db = database.SessionLocal()
    try:
        user = models.User(
            full_name="Ramesh Kumar",
            email="ramesh_test_model@example.com",
            phone="9876543299",
            role="user",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        assert user.full_name == "Ramesh Kumar"
        assert user.email == "ramesh_test_model@example.com"
        assert user.role == "user"
        assert user.token_version == 0
        assert user.is_active is True
    finally:
        db.close()


def test_worker_model_defaults():
    """Verify Worker model fields, default ratings, and availability status."""
    db = database.SessionLocal()
    try:
        worker = models.Worker(
            full_name="Suresh Plumber",
            phone="9876543298",
            email="suresh_test_model@example.com",
            skill="Plumber",
            experience_years=5,
            hourly_rate=300.0,
        )
        db.add(worker)
        db.commit()
        db.refresh(worker)

        assert worker.skill == "Plumber"
        assert worker.rating == 0.0
        assert worker.total_jobs == 0
        assert worker.completed_jobs == 0
        assert worker.availability is True
        assert worker.current_status == "offline"
    finally:
        db.close()


def test_notification_model_with_user_role():
    """Verify Notification model captures audience/user_role properly."""
    notif = models.Notification(
        user_id=1,
        user_role="worker",
        title="New Job Request",
        message="Client requested a plumbing job",
        type="worker:booking_request",
        is_read=False,
    )
    assert notif.user_id == 1
    assert notif.user_role == "worker"
    assert notif.is_read is False


def test_booking_model_attributes():
    """Verify Booking model price negotiation and status fields."""
    booking = models.Booking(
        user_id=1,
        worker_id=2,
        status="pending",
        estimated_price=500.0,
        price_proposed_by="user",
    )
    assert booking.status == "pending"
    assert booking.estimated_price == 500.0
    assert booking.price_proposed_by == "user"
    assert booking.final_price is None

