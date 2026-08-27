"""Shared error types and helpers for the AI provider clients."""
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load backend/.env as soon as any provider is imported. Provider modules read
# their model names at import time, and services/ai.py imports the providers
# before it calls load_dotenv() itself — without this the .env model overrides
# (SARVAM_STT_MODEL, GEMINI_LLM_MODEL, ...) would be silently ignored in the
# running app. load_dotenv() never overrides already-set variables, so this is
# safe to run repeatedly.
_BACKEND_ENV = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(_BACKEND_ENV)
load_dotenv()


class ProviderError(RuntimeError):
    """A provider call failed.

    `retryable` marks transient failures (timeout, rate limit, quota, 5xx,
    connection trouble) — the kind the orchestrator should answer by moving
    on to the next provider. Permanent failures (missing key, bad request,
    unsupported input) also fall through, but are logged differently.
    """

    def __init__(self, provider: str, message: str, retryable: bool = True):
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
        self.retryable = retryable


class ProviderNotConfigured(ProviderError):
    """The provider's API key is missing from backend/.env."""

    def __init__(self, provider: str, key_name: str):
        super().__init__(
            provider, f"{key_name} is not set", retryable=False
        )


# HTTP statuses that mean "try the next provider" rather than "the request
# itself was bad". 400 is intentionally excluded: a malformed payload would
# fail identically on every provider, but provider-specific quirks (audio
# format rejected by one, accepted by another) make falling through safer.
RETRYABLE_HTTP_STATUS = {408, 429, 500, 502, 503, 504}


def is_retryable_status(status_code: int) -> bool:
    return status_code in RETRYABLE_HTTP_STATUS


def error_summary(exc: Exception, max_len: int = 200) -> str:
    """Single-line, key-free summary of a failure for logging."""
    text = str(exc).replace("\n", " ")
    return text[:max_len]
