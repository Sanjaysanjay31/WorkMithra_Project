"""Provider clients for the multilingual AI fallback system.

Each provider module (sarvam, gemini, groq) exposes plain functions for the
capabilities it supports (stt / llm / tts). The orchestrator chains them with
sequential fallback — providers are never called in parallel:

    STT: Sarvam -> Gemini -> Groq
    LLM: Gemini -> Groq -> Sarvam
    TTS: Sarvam -> Gemini

All API keys live in backend/.env; nothing here is exposed to the frontend.
"""
