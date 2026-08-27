"""Sarvam AI provider client (STT / TTS / LLM).

Preferred for Indian-language speech, especially Telugu. Endpoints and model
names verified against docs.sarvam.ai (Aug 2026):

    STT  POST /speech-to-text        model saaras:v3 (modes: transcribe, ...)
    TTS  POST /text-to-speech        model bulbul:v3 (language_code, speaker)
    LLM  POST /v1/chat/completions   model sarvam-105b-conversations

Auth is the `api-subscription-key` header. All values configurable via
backend/.env (SARVAM_* variables).
"""
import base64
import os
import time
from typing import Any, Dict, List, Optional

import requests

from .base import ProviderError, ProviderNotConfigured, is_retryable_status

NAME = "sarvam"
BASE_URL = "https://api.sarvam.ai"

# Defaults match the current Sarvam docs. saarika/saaras v2.5 and bulbul v2
# are legacy — pin them via env vars only if you have a reason to.
STT_MODEL = os.getenv("SARVAM_STT_MODEL", "saaras:v3")
LLM_MODEL = os.getenv("SARVAM_LLM_MODEL", os.getenv("SARVAM_CHAT_MODEL", "sarvam-105b-conversations"))
TTS_MODEL = os.getenv("SARVAM_TTS_MODEL", "bulbul:v3")
# Speaker names are case-sensitive lowercase. ishita is a documented top pick
# for Telugu (and most Indian languages) on bulbul:v3.
TTS_SPEAKER = os.getenv("SARVAM_TTS_SPEAKER", "ishita")

STT_TIMEOUT = float(os.getenv("SARVAM_STT_TIMEOUT", "45"))
TTS_TIMEOUT = float(os.getenv("SARVAM_TTS_TIMEOUT", "30"))
LLM_TIMEOUT = float(os.getenv("SARVAM_LLM_TIMEOUT", "45"))
RETRY_BACKOFF = 1.0  # seconds before the single retry on transient errors

# Languages bulbul:v3 synthesizes (docs: 10 Indian + English). The app's
# or-IN (Odia) is spelled od-IN in Sarvam's docs.
_TTS_LANGS = {
    "hi-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN",
    "mr-IN", "gu-IN", "pa-IN", "od-IN", "en-IN",
}
_LANG_ALIASES = {"or-IN": "od-IN"}


def _api_key() -> str:
    key = os.getenv("SARVAM_API_KEY", "")
    if not key:
        raise ProviderNotConfigured(NAME, "SARVAM_API_KEY")
    return key


def _headers() -> Dict[str, str]:
    return {"api-subscription-key": _api_key()}


def _post_with_retry(method_kwargs: Dict[str, Any], timeout: float, what: str) -> requests.Response:
    """POST once, retry exactly once on transient failures (timeout / 429 / 5xx)."""
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            r = requests.post(timeout=timeout, **method_kwargs)
            if r.ok:
                return r
            if is_retryable_status(r.status_code) and attempt == 0:
                last_exc = ProviderError(NAME, f"{what} HTTP {r.status_code}")
                time.sleep(RETRY_BACKOFF)
                continue
            # Never echo the response body — it can contain the API key in
            # error messages or user PII. Status only.
            raise ProviderError(NAME, f"{what} HTTP {r.status_code}", retryable=True)
        except requests.RequestException as e:
            if attempt == 0:
                last_exc = e
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"{what} network error: {e.__class__.__name__}") from e
    raise ProviderError(NAME, f"{what} failed after retry: {last_exc}")


def stt(audio_bytes: bytes, filename: str = "audio.wav", lang: str = "unknown") -> Dict[str, Any]:
    """Transcribe audio. Returns {"transcript": ..., "language_code": ..., "provider": "sarvam"}."""
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

    form: Dict[str, str] = {"model": STT_MODEL}
    if STT_MODEL.startswith(("saaras:v3", "saarika:v3")):
        # v3 auto-detects the language and selects the output via `mode`.
        # transcribe = keep the spoken language (handles Telugu-English mix).
        form["mode"] = "transcribe"
    else:
        # Legacy v2.x models take an explicit language_code ("unknown" = auto).
        lang_norm = "unknown" if (not lang or lang.lower() in ("auto", "")) else lang
        form["language_code"] = lang_norm

    r = _post_with_retry(
        {
            "url": f"{BASE_URL}/speech-to-text",
            "headers": _headers(),
            "files": {"file": (filename, audio_bytes, mime)},
            "data": form,
        },
        timeout=STT_TIMEOUT,
        what="STT",
    )
    data = r.json()
    transcript = (data.get("transcript") or "").strip()
    if not transcript:
        raise ProviderError(NAME, "STT returned an empty transcript", retryable=False)
    return {
        "transcript": transcript,
        "language_code": data.get("language_code"),
        "provider": NAME,
    }


def tts(text: str, lang: str = "en-IN", speaker: Optional[str] = None) -> bytes:
    """Synthesize speech. Returns WAV bytes."""
    lang = _LANG_ALIASES.get(lang, lang)
    if lang not in _TTS_LANGS:
        # Skip straight to the next provider instead of burning a paid call
        # that Sarvam will reject.
        raise ProviderError(NAME, f"language {lang} not supported by Sarvam TTS", retryable=False)
    r = _post_with_retry(
        {
            "url": f"{BASE_URL}/text-to-speech",
            "headers": {**_headers(), "Content-Type": "application/json"},
            "json": {
                "text": text,
                # language_code is the current docs' field; target_language_code
                # kept for bulbul:v2 compatibility (extra fields are ignored).
                "language_code": lang,
                "target_language_code": lang,
                "speaker": speaker or TTS_SPEAKER,
                "model": TTS_MODEL,
            },
        },
        timeout=TTS_TIMEOUT,
        what="TTS",
    )
    data = r.json()
    audios = data.get("audios") or []
    if not audios:
        raise ProviderError(NAME, "TTS returned no audio")
    try:
        return base64.b64decode("".join(audios))
    except Exception as e:
        raise ProviderError(NAME, f"TTS audio decode failed: {e.__class__.__name__}")


def chat(messages: List[Dict[str, str]], max_tokens: int = 512, temperature: float = 0.3) -> str:
    """OpenAI-compatible chat completion. Returns the model content UNMODIFIED —
    trimming for display is the caller's job."""
    r = _post_with_retry(
        {
            "url": f"{BASE_URL}/v1/chat/completions",
            "headers": {**_headers(), "Content-Type": "application/json"},
            "json": {
                "model": LLM_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
        },
        timeout=LLM_TIMEOUT,
        what="chat",
    )
    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise ProviderError(NAME, "chat returned no choices")
    content = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not content:
        # Never return reasoning_content as the answer — it is the model's
        # internal (usually English) analysis, not a user-facing reply.
        raise ProviderError(NAME, "chat returned empty content")
    return content
