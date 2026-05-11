from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body
from fastapi.responses import Response
from typing import Optional, Dict, Any
from services import ai as ai_svc

router = APIRouter()


@router.post("/tts")
def tts(payload: Dict[str, Any] = Body(...)):
    text = (payload.get("text") or "").strip()
    target = payload.get("target_lang") or "en-IN"
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        audio = ai_svc.sarvam_tts(text, target_lang=target)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")
    return Response(content=audio, media_type="audio/wav")


@router.post("/stt")
async def stt(file: UploadFile = File(...), lang: str = Form("unknown")):
    try:
        audio_bytes = await file.read()
        result = ai_svc.sarvam_stt(audio_bytes, filename=file.filename or "audio.wav", lang=lang)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"STT failed: {e}")


@router.post("/detect-lang")
def detect_lang(payload: Dict[str, Any] = Body(...)):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return ai_svc.sarvam_detect_lang(text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Detect failed: {e}")


@router.post("/translate")
def translate(payload: Dict[str, Any] = Body(...)):
    text = (payload.get("text") or "").strip()
    src = payload.get("source_lang") or "auto"
    tgt = payload.get("target_lang") or "en-IN"
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return ai_svc.sarvam_translate(text, source_lang=src, target_lang=tgt)
    except Exception as e:
        # Graceful fallback: return original text + the error so the UI doesn't
        # break, and we can still see what failed in the response.
        print(f"[/ai/translate] failed: {e}")
        return {
            "translated_text": text,
            "source_language_code": src,
            "target_language_code": tgt,
            "error": str(e),
        }


@router.post("/extract")
def extract(payload: Dict[str, Any] = Body(...)):
    """Extract structured fields from free text using Llama."""
    text = (payload.get("text") or "").strip()
    schema = payload.get("schema") or "{ \"value\": string }"
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return ai_svc.llama_extract_json(text, schema)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Extract failed: {e}")


@router.post("/chat")
def chat(payload: Dict[str, Any] = Body(...)):
    prompt = (payload.get("prompt") or "").strip()
    system = payload.get("system")
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    try:
        return {"reply": ai_svc.llama_chat(prompt, system=system)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chat failed: {e}")
