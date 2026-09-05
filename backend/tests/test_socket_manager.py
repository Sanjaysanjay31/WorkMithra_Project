from socket_manager import SocketManager


def test_socket_manager_add_and_is_online():
    mgr = SocketManager()
    mgr.add_connection(user_id=10, socket_id="sock_abc", role="user")
    assert mgr.is_user_online(10, role="user") is True
    assert mgr.is_user_online(10, role="worker") is False
    assert mgr.get_user_status(10, role="user") == "online"


def test_socket_manager_role_isolation():
    """Verify user:5 and worker:5 are treated as completely distinct identities."""
    mgr = SocketManager()
    mgr.add_connection(user_id=5, socket_id="sock_user", role="user")
    mgr.add_connection(user_id=5, socket_id="sock_worker", role="worker")

    assert mgr.get_user_for_socket("sock_user") == (5, "user")
    assert mgr.get_user_for_socket("sock_worker") == (5, "worker")
    assert len(mgr.get_online_users()) == 2


def test_socket_manager_multi_connection_disconnect():
    """Closing one socket of a multi-tab user leaves the user online."""
    mgr = SocketManager()
    mgr.add_connection(user_id=20, socket_id="sock_tab1", role="user")
    mgr.add_connection(user_id=20, socket_id="sock_tab2", role="user")

    # Disconnect first socket — user is still online via tab2
    res1 = mgr.remove_connection("sock_tab1")
    assert res1 is None
    assert mgr.is_user_online(20, role="user") is True

    # Disconnect last socket — user goes offline and returns identity
    res2 = mgr.remove_connection("sock_tab2")
    assert res2 == (20, "user")
    assert mgr.is_user_online(20, role="user") is False
    assert mgr.get_user_status(20, role="user") == "offline"


def test_socket_manager_stats():
    mgr = SocketManager()
    mgr.add_connection(user_id=1, socket_id="s1", role="user")
    mgr.add_connection(user_id=2, socket_id="s2", role="worker")
    stats = mgr.get_stats()
    assert stats["total_connections"] == 2
    assert stats["total_online_users"] == 2

