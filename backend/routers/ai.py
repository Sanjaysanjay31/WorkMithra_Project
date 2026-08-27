from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, Depends, Request
from fastapi.responses import Response
from typing import Optional, Dict, Any
from services import ai as ai_svc
from auth import get_current_user
from rate_limit import limiter

router = APIRouter()

# Every /ai/* call is a paid provider call (Sarvam / Gemini / Groq, with
# sequential fallback — see services/providers/) — bounded inputs plus per-IP
# rate limits keep a single client from draining the provider quotas.
_MAX_TEXT_CHARS = 2000       # chat / extract / detect
_MAX_TRANSLATE_CHARS = 5000  # chat messages can be a bit longer
_MAX_TTS_CHARS = 1000        # frontend chunks long speech itself
_MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB of audio is far more than a voice note


@router.post("/tts")
@limiter.limit("15/minute")
def tts(request: Request, payload: Dict[str, Any] = Body(...), current: Dict[str, Any] = Depends(get_current_user)):
    text = (payload.get("text") or "").strip()
    target = payload.get("target_lang") or "en-IN"
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > _MAX_TTS_CHARS:
        raise HTTPException(status_code=400, detail=f"text is too long (max {_MAX_TTS_CHARS} characters)")
    if not ai_svc.is_supported_lang_code(target):
        raise HTTPException(status_code=400, detail="Unsupported target_lang")
    try:
        audio = ai_svc.sarvam_tts(text, target_lang=ai_svc.normalize_lang_code(target))
    except Exception as e:
        print(f"[/ai/tts] failed: {e}")
        raise HTTPException(status_code=502, detail="Text-to-speech is unavailable right now")
    return Response(content=audio, media_type="audio/wav")


@router.post("/stt")
@limiter.limit("15/minute")
def stt(request: Request, file: UploadFile = File(...), lang: str = Form("unknown"), current: Dict[str, Any] = Depends(get_current_user)):
    """Speech-to-text. Sync endpoint on purpose: the provider call blocks, and
    FastAPI runs sync endpoints in its threadpool instead of stalling the
    event loop (which would freeze every other request, socket heartbeats
    included)."""
    audio_bytes = file.file.read(_MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio too large (max 10 MB)")
    try:
        return ai_svc.sarvam_stt(audio_bytes, filename=file.filename or "audio.wav", lang=lang)
    except Exception as e:
        print(f"[/ai/stt] failed: {e}")
        raise HTTPException(status_code=502, detail="Speech-to-text is unavailable right now")


@router.post("/detect-lang")
@limiter.limit("30/minute")
def detect_lang(request: Request, payload: Dict[str, Any] = Body(...), current: Dict[str, Any] = Depends(get_current_user)):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > _MAX_TEXT_CHARS:
        raise HTTPException(status_code=400, detail=f"text is too long (max {_MAX_TEXT_CHARS} characters)")
    # sarvam_detect_lang never raises — it degrades to a flagged fallback.
    return ai_svc.sarvam_detect_lang(text)


@router.post("/translate")
@limiter.limit("30/minute")
def translate(request: Request, payload: Dict[str, Any] = Body(...), current: Dict[str, Any] = Depends(get_current_user)):
    text = (payload.get("text") or "").strip()
    src = payload.get("source_lang") or "auto"
    tgt = payload.get("target_lang") or "en-IN"
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > _MAX_TRANSLATE_CHARS:
        raise HTTPException(status_code=400, detail=f"text is too long (max {_MAX_TRANSLATE_CHARS} characters)")
    if not ai_svc.is_supported_lang_code(tgt):
        raise HTTPException(status_code=400, detail="Unsupported target_lang")
    if src not in ("auto", "unknown") and not ai_svc.is_supported_lang_code(src):
        raise HTTPException(status_code=400, detail="Unsupported source_lang")
    try:
        return ai_svc.sarvam_translate(text, source_lang=src, target_lang=ai_svc.normalize_lang_code(tgt))
    except Exception as e:
        # Graceful fallback: return the original text so the UI keeps working.
        # The error field is generic — provider internals stay server-side.
        print(f"[/ai/translate] failed: {e}")
        return {
            "translated_text": text,
            "source_language_code": src,
            "target_language_code": tgt,
            "error": "Translation unavailable — showing the original text",
        }


@router.post("/extract")
@limiter.limit("20/minute")
def extract(request: Request, payload: Dict[str, Any] = Body(...), current: Dict[str, Any] = Depends(get_current_user)):
    """Extract structured fields from free text using the LLM."""
    text = (payload.get("text") or "").strip()
    schema = str(payload.get("schema") or '{ "value": string }')
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > _MAX_TEXT_CHARS:
        raise HTTPException(status_code=400, detail=f"text is too long (max {_MAX_TEXT_CHARS} characters)")
    if len(schema) > 500:
        raise HTTPException(status_code=400, detail="schema is too long (max 500 characters)")
    try:
        return ai_svc.llama_extract_json(text, schema)
    except Exception as e:
        print(f"[/ai/extract] failed: {e}")
        raise HTTPException(status_code=502, detail="Could not extract details from that text — please try again")


# Server-side base persona for the assistant. Client-supplied context is
# appended as a bounded hint — the client never fully controls the system
# prompt (unrestricted persona injection surface).
_ASSISTANT_BASE_SYSTEM = (
    "You are WorkMithra's friendly voice assistant for booking home services in India. "
    "Answer the user's question directly in 1 short, simple sentence (maximum 20 words). "
    "Do not use markdown. Do not include meta prefixes. Speak naturally in the user's language."
)


@router.post("/chat")
@limiter.limit("20/minute")
def chat(request: Request, payload: Dict[str, Any] = Body(...), current: Dict[str, Any] = Depends(get_current_user)):
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    if len(prompt) > _MAX_TEXT_CHARS:
        raise HTTPException(status_code=400, detail=f"prompt is too long (max {_MAX_TEXT_CHARS} characters)")
    client_hint = str(payload.get("system") or "").strip()[:500]
    system = _ASSISTANT_BASE_SYSTEM + (f"\nAdditional context: {client_hint}" if client_hint else "")
    try:
        return {"reply": ai_svc.llama_chat(prompt, system=system)}
    except Exception:
        return {
            "reply": "I’m sorry, I’m having trouble reaching my AI service right now. Please try again in a moment."
        }
