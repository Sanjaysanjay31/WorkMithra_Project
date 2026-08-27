"""Groq provider client (STT via Whisper, LLM via OpenAI-compatible chat).

Verified against console.groq.com/docs (Aug 2026):

    STT  POST https://api.groq.com/openai/v1/audio/transcriptions
         models: whisper-large-v3-turbo (fast) / whisper-large-v3 (accuracy)
    LLM  POST https://api.groq.com/openai/v1/chat/completions
         model: llama-3.3-70b-versatile

Groq is the last-resort STT fallback and the first LLM fallback after Gemini.
"""
import os
import time
from typing import Any, Dict, List, Optional

import requests

from .base import ProviderError, ProviderNotConfigured, is_retryable_status

NAME = "groq"
STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
LLM_URL = "https://api.groq.com/openai/v1/chat/completions"

STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")
LLM_MODEL = os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile")

STT_TIMEOUT = float(os.getenv("GROQ_STT_TIMEOUT", "45"))
LLM_TIMEOUT = float(os.getenv("GROQ_LLM_TIMEOUT", "45"))
RETRY_BACKOFF = 1.0

# Whisper takes ISO-639-1 codes; the app uses BCP-47 (te-IN). Map the prefix.
_LANG_ISO = {
    "en": "en", "hi": "hi", "te": "te", "ta": "ta", "kn": "kn", "ml": "ml",
    "mr": "mr", "bn": "bn", "gu": "gu", "pa": "pa", "or": "or", "od": "or",
    "as": "as", "ur": "ur",
}


def _api_key() -> str:
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        raise ProviderNotConfigured(NAME, "GROQ_API_KEY")
    return key


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {_api_key()}"}


def _whisper_lang(lang: Optional[str]) -> Optional[str]:
    if not lang or lang.lower() in ("auto", "unknown"):
        return None  # let Whisper auto-detect
    prefix = lang.strip().lower().split("-")[0]
    return _LANG_ISO.get(prefix)


def stt(audio_bytes: bytes, filename: str = "audio.wav", lang: str = "unknown") -> Dict[str, Any]:
    if not audio_bytes:
        raise ProviderError(NAME, "empty audio", retryable=False)
    ext = (filename.rsplit(".", 1)[-1] or "wav").lower()
    mime = {
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "mp4": "audio/mp4",
        "mp3": "audio/mpeg",
        "webm": "audio/webm",
        "flac": "audio/flac",
        "ogg": "audio/ogg",
        "aac": "audio/aac",
    }.get(ext, "audio/wav")

    form: Dict[str, str] = {"model": STT_MODEL, "response_format": "json"}
    whisper_lang = _whisper_lang(lang)
    if whisper_lang:
        form["language"] = whisper_lang

    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            r = requests.post(
                STT_URL,
                headers=_headers(),
                files={"file": (filename, audio_bytes, mime)},
                data=form,
                timeout=STT_TIMEOUT,
            )
            if r.ok:
                transcript = ((r.json() or {}).get("text") or "").strip()
                if not transcript:
                    raise ProviderError(NAME, "STT returned an empty transcript", retryable=False)
                return {"transcript": transcript, "language_code": None, "provider": NAME}
            if is_retryable_status(r.status_code) and attempt == 0:
                last_exc = ProviderError(NAME, f"STT HTTP {r.status_code}")
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"STT HTTP {r.status_code}", retryable=True)
        except requests.RequestException as e:
            if attempt == 0:
                last_exc = e
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"STT network error: {e.__class__.__name__}") from e
    raise ProviderError(NAME, f"STT failed after retry: {last_exc}")


def chat(messages: List[Dict[str, str]], max_tokens: int = 512, temperature: float = 0.3) -> str:
    # Reasoning models (e.g. openai/gpt-oss-*) spend part of the token budget
    # on an internal `reasoning` trace before emitting `content`. A small budget
    # gets exhausted by reasoning and returns empty content with
    # finish_reason="length". Floor the budget, and if that still runs dry,
    # retry once with a much larger one.
    budget = max(int(max_tokens or 0), 512)

    def _post(chat_max_tokens: int) -> Dict[str, Any]:
        return requests.post(
            LLM_URL,
            headers={**_headers(), "Content-Type": "application/json"},
            json={
                "model": LLM_MODEL,
                "messages": messages,
                "max_tokens": chat_max_tokens,
                "temperature": temperature,
            },
            timeout=LLM_TIMEOUT,
        )

    last_exc: Optional[Exception] = None
    budgets = [budget, max(budget * 4, 2048)]  # second attempt for reasoning models
    for attempt, chat_budget in enumerate(budgets):
        try:
            r = _post(chat_budget)
            if r.ok:
                data = r.json()
                choices = data.get("choices") or []
                if not choices:
                    raise ProviderError(NAME, "chat returned no choices")
                choice = choices[0]
                content = ((choice.get("message") or {}).get("content") or "").strip()
                if content:
                    return content
                # Empty content: if the model ran out of tokens mid-reasoning,
                # try the next (larger) budget; otherwise it's a real failure.
                if choice.get("finish_reason") == "length" and attempt < len(budgets) - 1:
                    last_exc = ProviderError(NAME, "chat content empty (reasoning used the token budget)")
                    continue
                raise ProviderError(NAME, "chat returned empty content")
            if is_retryable_status(r.status_code) and attempt == 0:
                last_exc = ProviderError(NAME, f"chat HTTP {r.status_code}")
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"chat HTTP {r.status_code}", retryable=True)
        except requests.RequestException as e:
            if attempt == 0:
                last_exc = e
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"chat network error: {e.__class__.__name__}") from e
    raise ProviderError(NAME, f"chat failed after retry: {last_exc}")
