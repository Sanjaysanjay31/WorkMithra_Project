"""Google Gemini provider client (STT / LLM / TTS) via the Interactions API.

Verified against ai.google.dev (Aug 2026). Gemini's current REST surface is
the Interactions API:

    POST https://generativelanguage.googleapis.com/v1beta/interactions
    header: x-goog-api-key: <GEMINI_API_KEY>

Text responses arrive as `steps[].content[]` blocks with {"type": "text"};
audio as {"type": "audio", "data": <base64>} (PCM unless mime says otherwise).
The legacy generateContent shape (candidates[].content.parts[]) is also
accepted by the parsers so a staged API rollout can't break the fallback.

Models (all configurable via backend/.env):
    STT/LLM: gemini-3.7-flash   TTS: gemini-3.1-flash-tts-preview
"""
import base64
import os
import struct
import time
from typing import Any, Dict, List, Optional

import requests

from .base import ProviderError, ProviderNotConfigured, is_retryable_status

NAME = "gemini"
BASE_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

STT_MODEL = os.getenv("GEMINI_STT_MODEL", "gemini-3.5-transcribe")
# gemini-3.7-flash hangs on chat completions; 3.6-flash is the verified-working
# default (see backend/.env.example notes).
LLM_MODEL = os.getenv("GEMINI_LLM_MODEL", "gemini-3.6-flash")
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
# Documented TTS voices include Zephyr, Kore, Leda, Puck, ... (30 options).
TTS_VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")

STT_TIMEOUT = float(os.getenv("GEMINI_STT_TIMEOUT", "60"))
LLM_TIMEOUT = float(os.getenv("GEMINI_LLM_TIMEOUT", "45"))
TTS_TIMEOUT = float(os.getenv("GEMINI_TTS_TIMEOUT", "45"))
RETRY_BACKOFF = 1.0

_LANG_NAMES = {
    "en-IN": "English", "hi-IN": "Hindi", "te-IN": "Telugu", "ta-IN": "Tamil",
    "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi",
    "bn-IN": "Bengali", "gu-IN": "Gujarati", "pa-IN": "Punjabi",
    "or-IN": "Odia", "od-IN": "Odia", "as-IN": "Assamese", "ur-IN": "Urdu",
}


def _api_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ProviderNotConfigured(NAME, "GEMINI_API_KEY")
    return key


def _headers() -> Dict[str, str]:
    return {"x-goog-api-key": _api_key(), "Content-Type": "application/json"}


def _post_with_retry(payload: Dict[str, Any], timeout: float, what: str) -> requests.Response:
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            r = requests.post(BASE_URL, headers=_headers(), json=payload, timeout=timeout)
            if r.ok:
                return r
            if is_retryable_status(r.status_code) and attempt == 0:
                last_exc = ProviderError(NAME, f"{what} HTTP {r.status_code}")
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"{what} HTTP {r.status_code}", retryable=True)
        except requests.RequestException as e:
            if attempt == 0:
                last_exc = e
                time.sleep(RETRY_BACKOFF)
                continue
            raise ProviderError(NAME, f"{what} network error: {e.__class__.__name__}") from e
    raise ProviderError(NAME, f"{what} failed after retry: {last_exc}")


def _extract_text(data: Dict[str, Any]) -> str:
    """Pull text out of an Interactions response (or legacy generateContent)."""
    parts: List[str] = []
    for step in data.get("steps") or []:
        for block in step.get("content") or []:
            if block.get("type") == "text" and block.get("text"):
                parts.append(block["text"])
    if parts:
        return "\n".join(parts).strip()
    if data.get("output_text"):
        return str(data["output_text"]).strip()
    # Legacy generateContent shape
    for cand in data.get("candidates") or []:
        for part in ((cand.get("content") or {}).get("parts")) or []:
            if part.get("text"):
                parts.append(part["text"])
    return "\n".join(parts).strip()


def _extract_audio(data: Dict[str, Any]) -> Optional[bytes]:
    """Pull audio bytes out of an Interactions response, wrapping raw PCM in a
    WAV header so the frontend can play it unchanged."""
    block = None
    for step in data.get("steps") or []:
        for b in step.get("content") or []:
            if b.get("type") == "audio" and b.get("data"):
                block = b
    if block is None and isinstance(data.get("output_audio"), dict):
        block = data["output_audio"]
    if block is None:
        for cand in data.get("candidates") or []:
            for part in ((cand.get("content") or {}).get("parts")) or []:
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if inline.get("data"):
                    block = {"data": inline["data"], "mime_type": inline.get("mimeType") or inline.get("mime_type")}
    if block is None:
        return None
    try:
        raw = base64.b64decode(block["data"])
    except Exception as e:
        raise ProviderError(NAME, f"TTS audio decode failed: {e.__class__.__name__}")
    mime = (block.get("mime_type") or "").lower()
    if "wav" in mime or raw[:4] == b"RIFF":
        return raw
    # Gemini TTS emits raw 16-bit mono PCM (24 kHz by default).
    sample_rate = int(block.get("sample_rate") or block.get("sampleRate") or 24000)
    return _pcm_to_wav(raw, sample_rate)


def _pcm_to_wav(pcm: bytes, sample_rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = sample_rate * channels * (bits // 8)
    block_align = channels * (bits // 8)
    header = (
        b"RIFF"
        + struct.pack("<I", 36 + len(pcm))
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits)
        + b"data"
        + struct.pack("<I", len(pcm))
    )
    return header + pcm


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

    prompt = (
        "Transcribe this speech exactly as spoken, in the language it is spoken. "
        "Keep code-mixed speech (e.g. Telugu-English) as-is in its original scripts. "
        "Output ONLY the transcript text — no labels, no translation, no commentary."
    )
    lang_name = _LANG_NAMES.get(lang)
    if lang_name:
        prompt += f" The speech is most likely {lang_name}."

    r = _post_with_retry(
        {
            "model": STT_MODEL,
            "input": [
                {"type": "text", "text": prompt},
                {
                    "type": "audio",
                    "data": base64.b64encode(audio_bytes).decode("utf-8"),
                    "mime_type": mime,
                },
            ],
        },
        timeout=STT_TIMEOUT,
        what="STT",
    )
    transcript = _extract_text(r.json())
    if not transcript:
        raise ProviderError(NAME, "STT returned an empty transcript", retryable=False)
    return {"transcript": transcript, "language_code": None, "provider": NAME}


def tts(text: str, lang: str = "en-IN", voice: Optional[str] = None) -> bytes:
    lang_name = _LANG_NAMES.get(lang, "the same language as this text")
    instruction = (
        f"Say the following text naturally in {lang_name}. "
        "Speak only the text itself, nothing else.\n\n" + text
    )
    r = _post_with_retry(
        {
            "model": TTS_MODEL,
            "input": instruction,
            "response_format": {"type": "audio"},
            "generation_config": {
                "speech_config": [{"voice": voice or TTS_VOICE}],
            },
        },
        timeout=TTS_TIMEOUT,
        what="TTS",
    )
    audio = _extract_audio(r.json())
    if not audio:
        raise ProviderError(NAME, "TTS returned no audio")
    return audio


def chat(messages: List[Dict[str, str]], max_tokens: int = 512, temperature: float = 0.3) -> str:
    """Accepts OpenAI-style messages; maps them onto the Interactions API."""
    system_parts: List[str] = []
    convo_parts: List[str] = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            system_parts.append(content)
        elif role == "assistant":
            convo_parts.append(f"Assistant: {content}")
        else:
            convo_parts.append(f"User: {content}")
    # The final user turn is the actual prompt; earlier turns are context.
    input_text = "\n".join(convo_parts) if convo_parts else ""
    if not input_text:
        raise ProviderError(NAME, "chat called with no user message", retryable=False)

    # The Interactions API rejects top-level `temperature` and
    # `max_output_tokens` (HTTP 400 "Unknown parameter"). Token budget belongs
    # inside generation_config; sampling temperature is not a supported field on
    # this endpoint at all, so it is intentionally not sent.
    payload: Dict[str, Any] = {
        "model": LLM_MODEL,
        "input": input_text,
        "generation_config": {"max_output_tokens": max_tokens},
    }
    if system_parts:
        payload["system_instruction"] = "\n".join(system_parts)

    r = _post_with_retry(payload, timeout=LLM_TIMEOUT, what="chat")
    text = _extract_text(r.json())
    if not text:
        raise ProviderError(NAME, "chat returned empty content")
    return text
