"""Sequential provider fallback orchestration.

    STT: Sarvam -> Gemini -> Groq     (Sarvam preferred for Indian languages)
    LLM: Gemini -> Groq -> Sarvam     (Gemini is the default LLM)
    TTS: Sarvam -> Gemini             (Sarvam preferred for Indian voices)

Providers are tried strictly one after another — never in parallel — and only
after the previous one failed (timeout, rate limit, quota, server error, or a
provider-specific rejection). Each provider already applies one internal
retry to transient HTTP errors before giving up, so the orchestrator itself
never re-runs a provider it has already moved past.
"""
from typing import Any, Callable, Dict, List, Tuple

from . import gemini, groq, sarvam
from .base import ProviderError, error_summary


class AllProvidersFailedError(RuntimeError):
    """Every provider in the chain failed."""

    def __init__(self, capability: str, errors: List[str]):
        detail = "; ".join(errors) if errors else "no providers configured"
        super().__init__(f"All {capability} providers failed: {detail}")
        self.capability = capability
        self.errors = errors


def _run_chain(
    capability: str,
    chain: List[Tuple[str, Callable[[], Any]]],
) -> Tuple[Any, str]:
    """Run providers in order; return (result, provider_name) of the first
    success. Raises AllProvidersFailedError when none succeed."""
    errors: List[str] = []
    for name, call in chain:
        try:
            return call(), name
        except ProviderError as e:
            errors.append(error_summary(e))
            print(f"[ai:{capability}] {name} failed, trying next: {error_summary(e)}")
        except Exception as e:  # defensive: a bug in one client must not kill the chain
            errors.append(f"[{name}] unexpected {e.__class__.__name__}")
            print(f"[ai:{capability}] {name} crashed, trying next: {e.__class__.__name__}")
    raise AllProvidersFailedError(capability, errors)


def transcribe(audio_bytes: bytes, filename: str = "audio.wav", lang: str = "unknown") -> Dict[str, Any]:
    """STT chain: Sarvam -> Gemini -> Groq.

    Returns {"transcript", "language_code", "provider"}. An empty transcript
    from one provider counts as failure and falls through to the next.
    """
    result, _ = _run_chain(
        "stt",
        [
            (sarvam.NAME, lambda: sarvam.stt(audio_bytes, filename, lang)),
            (gemini.NAME, lambda: gemini.stt(audio_bytes, filename, lang)),
            (groq.NAME, lambda: groq.stt(audio_bytes, filename, lang)),
        ],
    )
    return result


def generate(messages: List[Dict[str, str]], max_tokens: int = 512, temperature: float = 0.3) -> Tuple[str, str]:
    """LLM chain: Gemini -> Groq -> Sarvam. Returns (content, provider)."""
    return _run_chain(
        "llm",
        [
            (gemini.NAME, lambda: gemini.chat(messages, max_tokens, temperature)),
            (groq.NAME, lambda: groq.chat(messages, max_tokens, temperature)),
            (sarvam.NAME, lambda: sarvam.chat(messages, max_tokens, temperature)),
        ],
    )


def synthesize(text: str, lang: str = "en-IN") -> Tuple[bytes, str]:
    """TTS chain: Sarvam -> Gemini. Returns (wav_bytes, provider)."""
    return _run_chain(
        "tts",
        [
            (sarvam.NAME, lambda: sarvam.tts(text, lang)),
            (gemini.NAME, lambda: gemini.tts(text, lang)),
        ],
    )
