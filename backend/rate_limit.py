"""Shared slowapi limiter.

Lives in its own module so routers (e.g. routers/assistant.py) can apply
rate limits without importing main.py (which imports the routers — a circular
import). main.py assigns this limiter to app.state.limiter.

In-memory and per-IP: limits reset on restart and are not shared across
processes. That is acceptable for a single-process deployment; move to a
Redis-backed storage URI if the API is ever scaled out.
"""
import os

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    enabled=os.getenv("RATE_LIMITING", "1") not in ("0", "false", "False"),
)
