"""AI service facade: multilingual provider fallback for STT / LLM / TTS.

The heavy lifting lives in services/providers/ (sarvam, gemini, groq clients
plus the orchestrator). This module keeps the historical function names the
routers and tests rely on, and adds the legacy HuggingFace router as a final
LLM last-resort after the Gemini -> Groq -> Sarvam chain.

Fallback order (sequential, never parallel):
    STT: Sarvam -> Gemini -> Groq Whisper
    LLM: Gemini -> Groq -> Sarvam (-> HuggingFace router if HF_TOKEN is set)
    TTS: Sarvam -> Gemini
"""
import os
import json
import re
import requests
from typing import Optional, Dict, Any

from dotenv import load_dotenv
from pathlib import Path

from services.providers import orchestrator
from services.providers import sarvam as sarvam_provider
from services.providers.orchestrator import AllProvidersFailedError  # noqa: F401 (re-exported for routers/tests)

backend_env = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(backend_env)
load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN", "")
HF_MODEL = os.getenv("MODEL_NAME", "meta-llama/Llama-3.1-8B-Instruct")

SARVAM_BASE = "https://api.sarvam.ai"

# Language codes the app supports (Sarvam's Indian-language set). Validated
# server-side so a bad client code becomes a clean 400 instead of a provider
# error surfaced as a 502.
SUPPORTED_LANG_CODES = {
    "en-IN", "hi-IN", "te-IN", "ta-IN", "kn-IN", "ml-IN",
    "mr-IN", "bn-IN", "gu-IN", "pa-IN", "or-IN", "as-IN",
}


def normalize_lang_code(code: Optional[str], default: str = "en-IN") -> str:
    """Case-insensitive match against the supported set ('te-in' -> 'te-IN')."""
    if not code:
        return default
    c = str(code).strip()
    for known in SUPPORTED_LANG_CODES:
        if known.lower() == c.lower():
            return known
    return default


def is_supported_lang_code(code: Optional[str]) -> bool:
    if not code:
        return False
    c = str(code).strip().lower()
    return any(k.lower() == c for k in SUPPORTED_LANG_CODES)


def sarvam_tts(text: str, target_lang: str = "en-IN", speaker: Optional[str] = None) -> bytes:
    """Returns WAV audio bytes. Tries Sarvam first (preferred for Indian
    languages, especially Telugu), then Gemini. `speaker=None` lets the
    provider use its configured default voice."""
    audio, provider = orchestrator.synthesize(text, lang=normalize_lang_code(target_lang))
    print(f"[/ai/tts] synthesized via {provider}")
    return audio


def sarvam_stt(audio_bytes: bytes, filename: str = "audio.wav", lang: str = "unknown") -> Dict[str, Any]:
    """Transcribe audio. Sarvam first (best for Indian languages / Telugu),
    then Gemini, then Groq Whisper. Returns
    {"transcript", "language_code", "provider"}."""
    result = orchestrator.transcribe(audio_bytes, filename=filename, lang=lang)
    print(f"[/ai/stt] transcribed via {result.get('provider')}")
    return result


def sarvam_translate(text: str, source_lang: str, target_lang: str) -> Dict[str, Any]:
    if not os.getenv("SARVAM_API_KEY", ""):
        raise RuntimeError("SARVAM_API_KEY is not set")

    src = (source_lang or "").strip() or "auto"
    if src.lower() in ("unknown", ""):
        src = "auto"
    tgt = (target_lang or "").strip() or "en-IN"
    # Compare case-insensitively so "en-IN" vs "en-in" doesn't burn a paid
    # call to translate text into the same language.
    if src.lower() == tgt.lower():
        return {"translated_text": text, "source_language_code": src}

    body = {
        "input": text,
        "source_language_code": src,
        "target_language_code": tgt,
    }
    r = requests.post(
        f"{SARVAM_BASE}/translate",
        headers={
            "api-subscription-key": os.getenv("SARVAM_API_KEY", ""),
            "Content-Type": "application/json",
        },
        json=body,
        timeout=30,
    )
    if r.status_code >= 400:
        # Never log the user's text (PII) — status only.
        print(f"[Sarvam translate] failed with status {r.status_code}")
        raise RuntimeError(f"Sarvam translate failed with status {r.status_code}")
    return r.json()


def _fallback_lang_detection() -> Dict[str, Any]:
    return {"language_code": "en-IN", "confidence": 0.3, "fallback": True}


def sarvam_detect_lang(text: str) -> Dict[str, Any]:
    if not os.getenv("SARVAM_API_KEY", ""):
        return _fallback_lang_detection()
    try:
        r = requests.post(
            f"{SARVAM_BASE}/text-lang-detection",
            headers={
                "api-subscription-key": os.getenv("SARVAM_API_KEY", ""),
                "Content-Type": "application/json",
            },
            json={"input": text},
            timeout=20,
        )
        if not r.ok:
            raise RuntimeError(f"Sarvam detect-lang status {r.status_code}")
        return r.json()
    except Exception as e:
        # The fallback keeps the UI usable, but the failure is logged —
        # a silently mislabeled source language produces garbage
        # translations downstream. The "fallback": True flag lets callers
        # treat low-confidence detections differently.
        print(f"[Sarvam detect-lang] failed, falling back to en-IN: {e}")
        return _fallback_lang_detection()


def _clean_reasoning_fallback(reasoning: str) -> str:
    if not reasoning:
        return ""
    for marker in ["Draft the Response", "Final Response", "Response:", "సమాధానం:"]:
        if marker in reasoning:
            parts = reasoning.split(marker)
            return parts[-1].strip().strip(":").strip("*").strip('"').strip("'")
    lines = reasoning.split("\n")
    clean_lines = [
        l for l in lines
        if not any(k in l for k in ["Analyze", "Deconstruct", "Identify", "Brainstorm", "Scenario", "Draft", "Core Task", "Telugu query"])
    ]
    return "\n".join(clean_lines).strip()


def _trim_assistant_reply(text: str) -> str:
    if not text:
        return ""
    cleaned = text.strip()
    cleaned = cleaned.replace("**", "").replace("```", "")
    cleaned = cleaned.replace("\n\n", "\n")
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return ""

    first_line = lines[0]
    if first_line.lower().startswith(("answer:", "response:", "final response:")):
        first_line = first_line.split(":", 1)[1].strip()

    # Keep only the first sentence if the answer is verbose. A sentence end
    # requires whitespace after the punctuation, so decimals ("₹450.50 per
    # hour") and abbreviations glued to text survive instead of being cut at
    # the first period.
    sentences = re.split(r"(?<=[.!?])\s+", first_line)
    if len(sentences) > 1:
        first_line = sentences[0].strip()

    # Cap length at a word boundary so we never slice a Telugu/other word mid-way.
    if len(first_line) > 160:
        cut = first_line[:157].rstrip()
        last_space = cut.rfind(" ")
        if last_space > 80:
            cut = cut[:last_space]
        first_line = cut.rstrip() + "..."
    return first_line.strip()


def _assistant_short_reply(user_text: str) -> Optional[str]:
    text = (user_text or "").strip()
    if not text:
        return "నమసకారం! నేను మీకు సహాయం చేయగలను."

    normalized = text.lower()
    otp_keywords = ["otp", "one time password", "verification code", "verify otp"]
    missing_keywords = ["not get", "didn't get", "did not get", "not received", "not arrive", "not came", "not come", "రాలేదు", "రాలేద", "రాదు"]
    if any(k in normalized for k in otp_keywords) and any(k in normalized for k in missing_keywords):
        return "Please check your inbox and spam folder, confirm the email is correct, and tap resend OTP. If it still doesn't arrive, wait a minute and try again."

    return None


def _sarvam_chat(messages: list, max_tokens: int = 2048) -> str:
    """Raw Sarvam chat completion (kept for direct use / tests). Returns the
    model content UNMODIFIED — trimming for display is the caller's job."""
    return sarvam_provider.chat(messages, max_tokens=max_tokens)


def _llm_chain(messages: list, max_tokens: int = 512) -> tuple:
    """The main LLM path: Gemini -> Groq -> Sarvam, sequential fallback.
    Returns (content, provider). Module-level attribute so tests can
    monkeypatch the whole chain."""
    return orchestrator.generate(messages, max_tokens=max_tokens)


def _hf_chat(messages: list, max_tokens: int = 512) -> str:
    """Legacy last resort: HF Inference Providers router, a couple of provider
    attempts. Bounded tightly (2 candidates x 1 attempt x 30s) so a degraded
    provider can't hold a worker thread for minutes."""
    if not HF_TOKEN:
        raise RuntimeError("HF_TOKEN not set")
    headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}
    # Try a few model:provider combinations the router accepts
    candidates = [
        (HF_MODEL, "https://router.huggingface.co/v1/chat/completions"),
        ("meta-llama/Llama-3.1-8B-Instruct:novita", "https://router.huggingface.co/v1/chat/completions"),
    ]
    last_err = ""
    import time
    for model, url in candidates:
        try:
            r = requests.post(
                url, headers=headers,
                json={"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3},
                timeout=30,
            )
            if r.status_code == 503:
                time.sleep(1); continue
            if r.status_code >= 400:
                last_err = f"{model} -> {r.status_code} {r.text[:200]}"
                continue
            data = r.json()
            if "choices" in data and data["choices"]:
                return data["choices"][0]["message"]["content"]
            last_err = f"{model} -> unexpected: {str(data)[:200]}"
        except Exception as e:
            last_err = f"{model} -> {e}"
            continue
    raise RuntimeError(f"HF chat failed. Last: {last_err}")


def llama_chat(prompt: str, system: Optional[str] = None, max_tokens: int = 512) -> str:
    """Chat with the user. Chain: Gemini -> Groq -> Sarvam (-> legacy HF).
    Replies in the language the user speaks; the system prompt carries the
    target-language instruction from the client."""
    quick_reply = _assistant_short_reply(prompt)
    if quick_reply is not None:
        return quick_reply

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    # Trimming happens exactly once, here — the chain returns raw content.
    try:
        content, provider = _llm_chain(messages, max_tokens=max_tokens)
        print(f"[llama_chat] answered via {provider}")
        return _trim_assistant_reply(content)
    except Exception as e_chain:
        print(f"[llama_chat] provider chain failed: {e_chain}")
        try:
            return _trim_assistant_reply(_hf_chat(messages, max_tokens=max_tokens))
        except Exception as e_hf:
            print(f"[llama_chat] HF failed: {e_hf}")
            fallback_msg = (
                "I'm sorry, I'm having trouble reaching my AI service right now. "
                "Please try again in a moment or ask a simpler question."
            )
            return fallback_msg


def _raw_completion(user_text: str, system: str, max_tokens: int = 400) -> str:
    """Raw LLM completion for structured extraction — NO reply trimming, NO
    quick-reply heuristics. The chat formatter cuts text at the first period
    and caps it at 160 chars, which destroys JSON (decimals, emails, any
    object longer than one line)."""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_text},
    ]
    try:
        content, _provider = _llm_chain(messages, max_tokens=max_tokens)
        return content
    except Exception as e_chain:
        print(f"[extract] provider chain failed: {e_chain}")
        return _hf_chat(messages, max_tokens=max_tokens)


def llama_extract_json(user_text: str, schema_hint: str) -> Dict[str, Any]:
    """Ask the LLM to extract structured JSON matching schema_hint.

    Returns a dict or raises — callers get a clean 502 when the model output
    can't be parsed into an object (never a list/scalar, never prose)."""
    system = (
        "You are a strict JSON extractor. Read the user's text and output ONLY a JSON object "
        "matching this schema. No prose, no code fences. Use null for missing fields.\n"
        f"Schema:\n{schema_hint}"
    )
    raw = _raw_completion(user_text, system, max_tokens=400)
    raw = raw.strip().strip("`")
    if raw.lower().startswith("json"):
        raw = raw[4:].strip()
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        # last-ditch: find first '{' and last '}'
        i, j = raw.find("{"), raw.rfind("}")
        if i >= 0 and j > i:
            parsed = json.loads(raw[i : j + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError("Extraction did not produce a JSON object")
    return parsed
