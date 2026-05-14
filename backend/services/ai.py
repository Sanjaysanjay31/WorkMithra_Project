"""Thin wrappers around Sarvam AI (STT/TTS/Translate) and HuggingFace (Llama 3.1)."""
import os
import json
import base64
import requests
from typing import Optional, Dict, Any

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")
HF_TOKEN = os.getenv("HF_TOKEN", "")
HF_MODEL = os.getenv("MODEL_NAME", "meta-llama/Llama-3.1-8B-Instruct")

SARVAM_BASE = "https://api.sarvam.ai"


def _sarvam_headers():
    return {"api-subscription-key": SARVAM_API_KEY}


def sarvam_tts(text: str, target_lang: str = "en-IN", speaker: str = "anushka") -> bytes:
    """Returns WAV audio bytes."""
    if not SARVAM_API_KEY:
        raise RuntimeError("SARVAM_API_KEY is not set")
    r = requests.post(
        f"{SARVAM_BASE}/text-to-speech",
        headers={**_sarvam_headers(), "Content-Type": "application/json"},
        json={
            "text": text,
            "target_language_code": target_lang,
            "speaker": speaker,
            "model": "bulbul:v2",
        },
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    audios = data.get("audios") or []
    if not audios:
        raise RuntimeError("Sarvam TTS returned no audio")
    return base64.b64decode(audios[0])


def sarvam_stt(audio_bytes: bytes, filename: str = "audio.wav", lang: str = "unknown") -> Dict[str, Any]:
    if not SARVAM_API_KEY:
        raise RuntimeError("SARVAM_API_KEY is not set")
    ext = (filename.rsplit(".", 1)[-1] or "wav").lower()
    mime = {
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "mp4": "audio/mp4",
        "mp3": "audio/mpeg",
        "webm": "audio/webm",
        "flac": "audio/flac",
    }.get(ext, "audio/wav")
    files = {"file": (filename, audio_bytes, mime)}
    # Sarvam expects language_code like "en-IN" or "unknown". Normalize "auto" → "unknown".
    lang_norm = "unknown" if (not lang or lang.lower() in ("auto", "")) else lang
    data = {"model": "saarika:v2.5", "language_code": lang_norm}
    r = requests.post(
        f"{SARVAM_BASE}/speech-to-text",
        headers=_sarvam_headers(),
        files=files,
        data=data,
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"Sarvam {r.status_code}: {r.text[:300]}")
    return r.json()


def sarvam_translate(text: str, source_lang: str, target_lang: str) -> Dict[str, Any]:
    if not SARVAM_API_KEY:
        raise RuntimeError("SARVAM_API_KEY is not set")

    # Normalize: Sarvam expects values like "en-IN", "te-IN", or "auto" for source.
    # If source is empty / unknown, fall back to "auto" so Sarvam can detect.
    src = (source_lang or "").strip() or "auto"
    if src in ("unknown", ""):
        src = "auto"
    tgt = (target_lang or "").strip() or "en-IN"
    if src == tgt:
        return {"translated_text": text, "source_language_code": src}

    body = {
        "input": text,
        "source_language_code": src,
        "target_language_code": tgt,
        # Keep the body minimal — optional fields like speaker_gender / mode /
        # enable_preprocessing were causing 4xx with current Sarvam API.
    }
    r = requests.post(
        f"{SARVAM_BASE}/translate",
        headers={**_sarvam_headers(), "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    if r.status_code >= 400:
        # Log so we can see what's wrong server-side, then raise with detail.
        print(f"[Sarvam translate] {r.status_code} body={body} resp={r.text[:300]}")
        raise RuntimeError(f"Sarvam translate {r.status_code}: {r.text[:200]}")
    return r.json()


def sarvam_detect_lang(text: str) -> Dict[str, Any]:
    if not SARVAM_API_KEY:
        raise RuntimeError("SARVAM_API_KEY is not set")
    r = requests.post(
        f"{SARVAM_BASE}/text-lang-detection",
        headers={**_sarvam_headers(), "Content-Type": "application/json"},
        json={"input": text},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def _sarvam_chat(messages: list, max_tokens: int = 512) -> str:
    if not SARVAM_API_KEY:
        raise RuntimeError("SARVAM_API_KEY not set")
    r = requests.post(
        f"{SARVAM_BASE}/v1/chat/completions",
        headers={**_sarvam_headers(), "Content-Type": "application/json"},
        json={
            "model": "sarvam-m",
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.3,
        },
        timeout=60,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Sarvam chat {r.status_code}: {r.text[:300]}")
    data = r.json()
    return data["choices"][0]["message"]["content"]


def _hf_chat(messages: list, max_tokens: int = 512) -> str:
    """Fallback: HF Inference Providers router, multiple provider attempts."""
    if not HF_TOKEN:
        raise RuntimeError("HF_TOKEN not set")
    headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}
    # Try a few model:provider combinations the router accepts
    candidates = [
        (HF_MODEL, "https://router.huggingface.co/v1/chat/completions"),
        ("meta-llama/Llama-3.1-8B-Instruct:novita", "https://router.huggingface.co/v1/chat/completions"),
        ("meta-llama/Meta-Llama-3-8B-Instruct", "https://router.huggingface.co/v1/chat/completions"),
        ("Qwen/Qwen2.5-7B-Instruct", "https://router.huggingface.co/v1/chat/completions"),
    ]
    last_err = ""
    import time
    for model, url in candidates:
        for _ in range(2):
            try:
                r = requests.post(
                    url, headers=headers,
                    json={"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3},
                    timeout=60,
                )
                if r.status_code == 503:
                    time.sleep(3); continue
                if r.status_code >= 400:
                    last_err = f"{model} -> {r.status_code} {r.text[:200]}"
                    break
                data = r.json()
                if "choices" in data and data["choices"]:
                    return data["choices"][0]["message"]["content"]
                last_err = f"{model} -> unexpected: {str(data)[:200]}"
                break
            except Exception as e:
                last_err = f"{model} -> {e}"
                break
    raise RuntimeError(f"HF chat failed. Last: {last_err}")


def llama_chat(prompt: str, system: Optional[str] = None, max_tokens: int = 512) -> str:
    """Chat with the user. Primary: Sarvam chat (sarvam-m, multilingual). Fallback: HF router."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    # Try Sarvam first (you already have a working key, multilingual native)
    try:
        return _sarvam_chat(messages, max_tokens=max_tokens)
    except Exception as e_sarvam:
        try:
            return _hf_chat(messages, max_tokens=max_tokens)
        except Exception as e_hf:
            raise RuntimeError(f"Both Sarvam and HF chat failed. Sarvam: {e_sarvam} | HF: {e_hf}")


def llama_extract_json(user_text: str, schema_hint: str) -> Dict[str, Any]:
    """Asks Llama to extract structured JSON matching schema_hint."""
    system = (
        "You are a strict JSON extractor. Read the user's text and output ONLY a JSON object "
        "matching this schema. No prose, no code fences. Use null for missing fields.\n"
        f"Schema:\n{schema_hint}"
    )
    raw = llama_chat(user_text, system=system, max_tokens=400)
    raw = raw.strip().strip("`")
    if raw.lower().startswith("json"):
        raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except Exception:
        # last-ditch: find first '{' and last '}'
        i, j = raw.find("{"), raw.rfind("}")
        if i >= 0 and j > i:
            return json.loads(raw[i : j + 1])
        raise
