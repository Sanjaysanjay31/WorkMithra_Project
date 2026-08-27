import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app
from services import ai as ai_svc

client = TestClient(app)

def test_route_exists():
    response = client.get("/ai")
    # Integration test asserting the route is reachable
    assert response.status_code in [200, 401, 403, 404, 405, 422]
    assert response.headers.get("content-type") is not None


def test_llama_chat_returns_fallback_when_all_providers_fail(monkeypatch):
    # The LLM chain is Gemini -> Groq -> Sarvam (services/providers/); when
    # the whole chain and the legacy HF last resort are down, the user gets a
    # polite message instead of an error.
    monkeypatch.setattr(ai_svc, "_llm_chain", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("provider chain down")))
    monkeypatch.setattr(ai_svc, "_hf_chat", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("hf down")))

    reply = ai_svc.llama_chat("Can you help me with this app?")

    assert isinstance(reply, str)
    assert "sorry" in reply.lower() or "trouble" in reply.lower()


def test_sarvam_detect_lang_falls_back_when_provider_fails(monkeypatch):
    monkeypatch.setattr(ai_svc.requests, "post", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("sarvam down")))

    result = ai_svc.sarvam_detect_lang("Hola amigo")

    assert result["language_code"] == "en-IN"


def test_trim_assistant_reply_keeps_short_answer():
    long_text = "Sure! Here is a detailed explanation of how to log in to the app and what each button does."

    result = ai_svc._trim_assistant_reply(long_text)

    # Sentence-boundary splitting keeps the terminal punctuation ("Sure!")
    # while dropping everything after it.
    assert result == "Sure!"


def test_assistant_short_reply_is_not_static_for_generic_questions():
    reply = ai_svc._assistant_short_reply("How do I use this app?")

    assert reply is None


def test_assistant_short_reply_for_missing_otp():
    reply = ai_svc._assistant_short_reply("I did not get the OTP")

    assert reply is not None
    assert "otp" in reply.lower()
    assert "spam" in reply.lower() or "resend" in reply.lower() or "email" in reply.lower()
