"""Tests for the multilingual AI provider fallback system.

Covers the three chains (all offline — provider HTTP calls are mocked):

    STT: Sarvam -> Gemini -> Groq
    LLM: Gemini -> Groq -> Sarvam
    TTS: Sarvam -> Gemini

plus provider-client details (request shape, PCM->WAV wrapping, retries)
and two full voice conversations (Telugu + English) through the real
/ai/stt -> /ai/chat -> /ai/tts endpoints with mocked providers.
"""
import sys
import os
import struct
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

from main import app
from conftest import issue_verify_token
from services.providers import orchestrator, sarvam, gemini, groq
from services.providers.base import ProviderError, ProviderNotConfigured
from services import ai as ai_svc

client = TestClient(app)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

class CallTracker:
    """Records which providers were invoked, to prove sequential fallback."""

    def __init__(self):
        self.calls = []

    def fail(self, name):
        def _fn(*args, **kwargs):
            self.calls.append(name)
            raise ProviderError(name, "simulated outage")
        return _fn

    def succeed_stt(self, name, transcript):
        def _fn(*args, **kwargs):
            self.calls.append(name)
            return {"transcript": transcript, "language_code": None, "provider": name}
        return _fn

    def succeed_chat(self, name, content):
        def _fn(*args, **kwargs):
            self.calls.append(name)
            return content
        return _fn

    def succeed_tts(self, name, audio=b"RIFF-fake-wav"):
        def _fn(*args, **kwargs):
            self.calls.append(name)
            return audio
        return _fn


def _patch_stt(monkeypatch, tracker, sarvam_fn=None, gemini_fn=None, groq_fn=None):
    monkeypatch.setattr(sarvam, "stt", sarvam_fn if sarvam_fn else tracker.fail("sarvam"))
    monkeypatch.setattr(gemini, "stt", gemini_fn if gemini_fn else tracker.fail("gemini"))
    monkeypatch.setattr(groq, "stt", groq_fn if groq_fn else tracker.fail("groq"))


def _patch_chat(monkeypatch, tracker, gemini_fn=None, groq_fn=None, sarvam_fn=None):
    monkeypatch.setattr(gemini, "chat", gemini_fn if gemini_fn else tracker.fail("gemini"))
    monkeypatch.setattr(groq, "chat", groq_fn if groq_fn else tracker.fail("groq"))
    monkeypatch.setattr(sarvam, "chat", sarvam_fn if sarvam_fn else tracker.fail("sarvam"))


def _patch_tts(monkeypatch, tracker, sarvam_fn=None, gemini_fn=None):
    monkeypatch.setattr(sarvam, "tts", sarvam_fn if sarvam_fn else tracker.fail("sarvam"))
    monkeypatch.setattr(gemini, "tts", gemini_fn if gemini_fn else tracker.fail("gemini"))


def _register_and_login(role: str = "user"):
    tag = uuid.uuid4().hex[:10]
    email = f"ai-{role}-{tag}@example.com"
    payload = {
        "full_name": f"AI Tester {tag}",
        "phone": f"+91{tag}"[:15],
        "email": email,
        "password": "strongpass123",
        "role": role,
    }
    r = client.post("/register", json=payload, params={"verify_token": issue_verify_token(email)})
    assert r.status_code == 200, r.text
    r = client.post("/login", json={"identifier": email, "password": "strongpass123", "role": role})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------
# 1-3. STT chain: Sarvam success / Gemini fallback / Groq fallback
# --------------------------------------------------------------------------

def test_stt_sarvam_success(monkeypatch):
    t = CallTracker()
    _patch_stt(monkeypatch, t, sarvam_fn=t.succeed_stt("sarvam", "నమస్కారం"))

    result = orchestrator.transcribe(b"audio", "a.wav", lang="te-IN")

    assert result["transcript"] == "నమస్కారం"
    assert result["provider"] == "sarvam"
    assert t.calls == ["sarvam"]  # fallbacks never touched


def test_stt_gemini_fallback(monkeypatch):
    t = CallTracker()
    _patch_stt(monkeypatch, t, gemini_fn=t.succeed_stt("gemini", "hello there"))

    result = orchestrator.transcribe(b"audio", "a.wav", lang="en-IN")

    assert result["transcript"] == "hello there"
    assert result["provider"] == "gemini"
    assert t.calls == ["sarvam", "gemini"]  # sarvam failed first, groq untouched


def test_stt_groq_fallback(monkeypatch):
    t = CallTracker()
    _patch_stt(monkeypatch, t, groq_fn=t.succeed_stt("groq", "last resort text"))

    result = orchestrator.transcribe(b"audio", "a.wav", lang="hi-IN")

    assert result["transcript"] == "last resort text"
    assert result["provider"] == "groq"
    assert t.calls == ["sarvam", "gemini", "groq"]


def test_stt_all_providers_fail(monkeypatch):
    t = CallTracker()
    _patch_stt(monkeypatch, t)

    with pytest.raises(orchestrator.AllProvidersFailedError):
        orchestrator.transcribe(b"audio", "a.wav")
    assert t.calls == ["sarvam", "gemini", "groq"]


# --------------------------------------------------------------------------
# 4-6. LLM chain: Gemini success / Groq fallback / Sarvam fallback
# --------------------------------------------------------------------------

def test_llm_gemini_success(monkeypatch):
    t = CallTracker()
    _patch_chat(monkeypatch, t, gemini_fn=t.succeed_chat("gemini", "Gemini answer."))

    content, provider = orchestrator.generate([{"role": "user", "content": "hi"}])

    assert content == "Gemini answer."
    assert provider == "gemini"
    assert t.calls == ["gemini"]


def test_llm_groq_fallback(monkeypatch):
    t = CallTracker()
    _patch_chat(monkeypatch, t, groq_fn=t.succeed_chat("groq", "Groq answer."))

    content, provider = orchestrator.generate([{"role": "user", "content": "hi"}])

    assert content == "Groq answer."
    assert provider == "groq"
    assert t.calls == ["gemini", "groq"]


def test_llm_sarvam_fallback(monkeypatch):
    t = CallTracker()
    _patch_chat(monkeypatch, t, sarvam_fn=t.succeed_chat("sarvam", "సర్వం సమాధానం."))

    content, provider = orchestrator.generate([{"role": "user", "content": "hi"}])

    assert content == "సర్వం సమాధానం."
    assert provider == "sarvam"
    assert t.calls == ["gemini", "groq", "sarvam"]


def test_llama_chat_falls_back_to_polite_message_when_everything_fails(monkeypatch):
    """The legacy behaviour: when the whole chain AND the HF last resort fail,
    the user gets a friendly message instead of an error bubble."""
    monkeypatch.setattr(ai_svc, "_llm_chain", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("chain down")))
    monkeypatch.setattr(ai_svc, "_hf_chat", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("hf down")))

    reply = ai_svc.llama_chat("Can you help me with this app?")

    assert isinstance(reply, str)
    assert "sorry" in reply.lower() or "trouble" in reply.lower()


# --------------------------------------------------------------------------
# 7-8. TTS chain: Sarvam success / Gemini fallback
# --------------------------------------------------------------------------

def test_tts_sarvam_success(monkeypatch):
    t = CallTracker()
    _patch_tts(monkeypatch, t, sarvam_fn=t.succeed_tts("sarvam", b"RIFF-sarvam"))

    audio, provider = orchestrator.synthesize("హలో", lang="te-IN")

    assert audio == b"RIFF-sarvam"
    assert provider == "sarvam"
    assert t.calls == ["sarvam"]


def test_tts_gemini_fallback(monkeypatch):
    t = CallTracker()
    _patch_tts(monkeypatch, t, gemini_fn=t.succeed_tts("gemini", b"RIFF-gemini"))

    audio, provider = orchestrator.synthesize("hello", lang="en-IN")

    assert audio == b"RIFF-gemini"
    assert provider == "gemini"
    assert t.calls == ["sarvam", "gemini"]


def test_tts_all_providers_fail(monkeypatch):
    t = CallTracker()
    _patch_tts(monkeypatch, t)

    with pytest.raises(orchestrator.AllProvidersFailedError):
        orchestrator.synthesize("hello", lang="en-IN")


# --------------------------------------------------------------------------
# Provider client details (HTTP mocked at the requests level)
# --------------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status=200, json_data=None):
        self.status_code = status
        self._json = json_data or {}
        self.ok = 200 <= status < 300
        self.text = str(json_data)

    def json(self):
        return self._json


def test_sarvam_stt_client_uses_saaras_v3_transcribe_mode(monkeypatch):
    captured = {}

    def fake_post(url, **kw):
        captured["url"] = url
        captured["data"] = kw.get("data")
        captured["files"] = kw.get("files")
        return FakeResponse(200, {"transcript": "నమస్కారం", "language_code": "te-IN"})

    monkeypatch.setattr(sarvam.requests, "post", fake_post)
    result = sarvam.stt(b"audio-bytes", "voice.mp4", lang="te-IN")

    assert captured["url"].endswith("/speech-to-text")
    assert captured["data"]["model"] == sarvam.STT_MODEL
    assert captured["data"]["mode"] == "transcribe"
    assert captured["files"]["file"][2] == "audio/mp4"
    assert result["transcript"] == "నమస్కారం"
    assert result["provider"] == "sarvam"


def test_sarvam_stt_client_retries_once_on_rate_limit(monkeypatch):
    monkeypatch.setattr(sarvam.time, "sleep", lambda s: None)
    calls = {"n": 0}

    def fake_post(url, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return FakeResponse(429, {})
        return FakeResponse(200, {"transcript": "hello", "language_code": "en-IN"})

    monkeypatch.setattr(sarvam.requests, "post", fake_post)
    result = sarvam.stt(b"audio", "a.wav")

    assert calls["n"] == 2  # exactly one retry
    assert result["transcript"] == "hello"


def test_sarvam_tts_client_skips_unsupported_language(monkeypatch):
    """Languages bulbul:v3 can't speak must fail fast (retryable=False) so the
    orchestrator moves on to Gemini instead of burning a paid 4xx call."""
    def boom(*a, **k):
        raise AssertionError("no HTTP call should be made")

    monkeypatch.setattr(sarvam.requests, "post", boom)
    with pytest.raises(ProviderError) as exc:
        sarvam.tts("hello", lang="as-IN")
    assert exc.value.retryable is False


def test_gemini_tts_client_wraps_pcm_in_wav(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    pcm = struct.pack("<4h", 100, -100, 200, -200)
    import base64
    payload = {
        "steps": [{
            "type": "model_output",
            "content": [{"type": "audio", "data": base64.b64encode(pcm).decode(), "mime_type": "audio/l16"}],
        }]
    }
    monkeypatch.setattr(gemini.requests, "post", lambda url, **kw: FakeResponse(200, payload))

    audio = gemini.tts("hello", lang="en-IN")

    assert audio[:4] == b"RIFF"
    assert audio[8:12] == b"WAVE"
    assert audio.endswith(pcm)


def test_gemini_stt_client_parses_steps_text(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    captured = {}

    def fake_post(url, **kw):
        captured["payload"] = kw.get("json")
        return FakeResponse(200, {
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": "నమస్కారం ఎలా ఉన్నారు"}]}]
        })

    monkeypatch.setattr(gemini.requests, "post", fake_post)
    result = gemini.stt(b"audio", "a.m4a", lang="te-IN")

    assert result["transcript"] == "నమస్కారం ఎలా ఉన్నారు"
    payload = captured["payload"]
    assert payload["model"] == gemini.STT_MODEL
    audio_block = payload["input"][1]
    assert audio_block["type"] == "audio"
    assert audio_block["mime_type"] == "audio/mp4"
    assert "Telugu" in payload["input"][0]["text"]  # language hint passed through


def test_gemini_chat_maps_openai_messages_to_interactions(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    captured = {}

    def fake_post(url, **kw):
        captured["payload"] = kw.get("json")
        return FakeResponse(200, {
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": "Fine, thanks."}]}]
        })

    monkeypatch.setattr(gemini.requests, "post", fake_post)
    out = gemini.chat([
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "How are you?"},
    ])

    assert out == "Fine, thanks."
    payload = captured["payload"]
    assert payload["system_instruction"] == "Be brief."
    assert "How are you?" in payload["input"]
    # The Interactions API rejects top-level temperature / max_output_tokens;
    # the token budget must live inside generation_config.
    assert "temperature" not in payload
    assert "max_output_tokens" not in payload
    assert payload["generation_config"]["max_output_tokens"] > 0


def test_groq_stt_client_maps_bcp47_to_iso639(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    captured = {}

    def fake_post(url, **kw):
        captured["url"] = url
        captured["form"] = kw.get("data")
        return FakeResponse(200, {"text": "నమస్కారం"})

    monkeypatch.setattr(groq.requests, "post", fake_post)
    result = groq.stt(b"audio", "a.wav", lang="te-IN")

    assert captured["url"].endswith("/audio/transcriptions")
    assert captured["form"]["model"] == groq.STT_MODEL
    assert captured["form"]["language"] == "te"
    assert result["transcript"] == "నమస్కారం"


def test_groq_stt_client_omits_language_for_auto(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    captured = {}

    def fake_post(url, **kw):
        captured["form"] = kw.get("data")
        return FakeResponse(200, {"text": "something"})

    monkeypatch.setattr(groq.requests, "post", fake_post)
    groq.stt(b"audio", "a.wav", lang="unknown")

    assert "language" not in captured["form"]


def test_groq_chat_retries_with_bigger_budget_for_reasoning_models(monkeypatch):
    """gpt-oss reasoning models burn the token budget on an internal `reasoning`
    trace and return empty content with finish_reason='length'. The client must
    retry once with a larger budget instead of failing."""
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(groq.time, "sleep", lambda s: None)
    budgets_seen = []

    def fake_post(url, **kw):
        body = kw.get("json")
        budgets_seen.append(body["max_tokens"])
        if len(budgets_seen) == 1:
            # First attempt: reasoning used up the whole budget.
            return FakeResponse(200, {"choices": [{"message": {"role": "assistant", "content": ""}, "finish_reason": "length"}]})
        return FakeResponse(200, {"choices": [{"message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}]})

    monkeypatch.setattr(groq.requests, "post", fake_post)
    out = groq.chat([{"role": "user", "content": "hi"}], max_tokens=50)

    assert out == "OK"
    assert len(budgets_seen) == 2
    assert budgets_seen[0] >= 512          # small request budgets are floored
    assert budgets_seen[1] > budgets_seen[0]  # retry uses a larger budget


def test_missing_key_raises_not_configured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(ProviderNotConfigured):
        gemini.chat([{"role": "user", "content": "hi"}])
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(ProviderNotConfigured):
        groq.stt(b"audio", "a.wav")


# --------------------------------------------------------------------------
# 9-10. Full voice conversations through the real endpoints (providers mocked)
# --------------------------------------------------------------------------

def test_full_telugu_voice_conversation(monkeypatch):
    """Record -> STT -> LLM -> TTS in Telugu, end to end through /ai/*."""
    token = _register_and_login("user")
    t = CallTracker()
    telugu_transcript = "నమస్కారం, నాకు ప్లంబర్ కావాలి"
    telugu_reply = "అవును, మేము మీకు ప్లంబర్‌ను పంపిస్తాము."
    fake_wav = b"RIFF" + b"\x00" * 40 + b"WAVE"

    _patch_stt(monkeypatch, t, sarvam_fn=t.succeed_stt("sarvam", telugu_transcript))
    _patch_chat(monkeypatch, t, gemini_fn=t.succeed_chat("gemini", telugu_reply))
    _patch_tts(monkeypatch, t, sarvam_fn=t.succeed_tts("sarvam", fake_wav))

    # 1) STT — audio in, Telugu text out (Sarvam answered, no fallback needed)
    r = client.post(
        "/ai/stt",
        files={"file": ("speech.mp4", b"fake-telugu-audio", "audio/mp4")},
        data={"lang": "te-IN"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["transcript"] == telugu_transcript
    assert r.json()["provider"] == "sarvam"

    # 2) LLM — Telugu text in, Telugu reply out (Gemini answered)
    r = client.post("/ai/chat", json={"prompt": telugu_transcript}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == telugu_reply

    # 3) TTS — Telugu text in, playable audio out (Sarvam answered)
    r = client.post("/ai/tts", json={"text": telugu_reply, "target_lang": "te-IN"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert r.content == fake_wav

    # Each stage used its primary provider; no fallbacks were triggered.
    assert t.calls == ["sarvam", "gemini", "sarvam"]


def test_full_english_voice_conversation_with_fallbacks(monkeypatch):
    """English conversation where Sarvam STT and Sarvam TTS are down — the
    fallbacks (Gemini for both) must take over transparently."""
    token = _register_and_login("user")
    t = CallTracker()
    transcript = "Hello, I need an electrician tomorrow morning."
    reply = "Sure, I can help you book an electrician for tomorrow."
    fake_wav = b"RIFF" + b"\x01" * 24 + b"WAVE"

    _patch_stt(monkeypatch, t, gemini_fn=t.succeed_stt("gemini", transcript))  # sarvam fails
    _patch_chat(monkeypatch, t, gemini_fn=t.succeed_chat("gemini", reply))
    _patch_tts(monkeypatch, t, gemini_fn=t.succeed_tts("gemini", fake_wav))    # sarvam fails

    r = client.post(
        "/ai/stt",
        files={"file": ("speech.wav", b"fake-english-audio", "audio/wav")},
        data={"lang": "en-IN"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["transcript"] == transcript
    assert body["provider"] == "gemini"

    r = client.post("/ai/chat", json={"prompt": transcript}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == reply

    r = client.post("/ai/tts", json={"text": reply, "target_lang": "en-IN"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.content == fake_wav

    # STT fell sarvam->gemini; LLM answered via gemini; TTS fell sarvam->gemini.
    assert t.calls == ["sarvam", "gemini", "gemini", "sarvam", "gemini"]


def test_stt_endpoint_returns_502_when_all_providers_fail(monkeypatch):
    token = _register_and_login("user")
    t = CallTracker()
    _patch_stt(monkeypatch, t)

    r = client.post(
        "/ai/stt",
        files={"file": ("speech.wav", b"audio", "audio/wav")},
        data={"lang": "en-IN"},
        headers=_auth(token),
    )
    assert r.status_code == 502
    assert t.calls == ["sarvam", "gemini", "groq"]
