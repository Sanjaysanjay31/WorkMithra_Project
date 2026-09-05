import socket_events


def test_room_for_naming():
    """Verify room naming is strictly role-scoped to avoid collisions."""
    assert socket_events.room_for(1, "user") == "user_1"
    assert socket_events.room_for(1, "worker") == "worker_1"
    assert socket_events.room_for(42) == "user_42"
    # Default fallback for unknown roles
    assert socket_events.room_for(10, "admin") == "user_10"


def test_allowed_socket_statuses():
    """Ensure socket status whitelist contains standard presence values."""
    assert "online" in socket_events._ALLOWED_STATUSES
    assert "offline" in socket_events._ALLOWED_STATUSES
    assert "busy" in socket_events._ALLOWED_STATUSES
    assert "available" in socket_events._ALLOWED_STATUSES
    assert "invalid_status" not in socket_events._ALLOWED_STATUSES


def test_emit_to_user_safe_handling():
    """emit_to_user should cleanly return False without crashing when loop is unconfigured."""
    # When loop is None (outside running ASGI server), it gracefully returns False
    res = socket_events.emit_to_user(user_id=1, event="test_event", data={}, role="user")
    assert res is False

