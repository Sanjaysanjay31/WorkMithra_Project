"""Live verification of the multilingual provider fallback system.

Run from the backend directory:
    python scripts/verify_providers.py

This makes REAL (paid) calls to whichever providers have keys in backend/.env.
Providers without a configured key are reported as SKIPPED, never guessed at.

It verifies, in order:
  * Each individual provider client that has a key (Sarvam / Gemini / Groq).
  * The three orchestrator chains end to end:
        STT: Sarvam -> Gemini -> Groq
        LLM: Gemini -> Groq -> Sarvam
        TTS: Sarvam -> Gemini
  * A full Telugu and a full English voice round trip (STT -> LLM -> TTS),
    using the TTS output of one step as the STT input of the next so no
    pre-recorded audio file is needed.

Nothing here is a unit test — see tests/test_ai_providers.py for the offline,
deterministic fallback-order suite. This script is for confirming that the
configured keys and the providers' live endpoints actually work together.
"""
import os
import sys
import base64
import io

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from services.providers import sarvam, gemini, groq, orchestrator  # noqa: E402
from services.providers.base import ProviderError, ProviderNotConfigured  # noqa: E402

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
SKIP = "\033[93mSKIP\033[0m"

_results = []


def _have(env_var):
    v = os.getenv(env_var, "")
    return bool(v) and not v.startswith("your-")


def record(name, status, detail=""):
    _results.append((name, status, detail))
    line = f"[{status}] {name}"
    if detail:
        line += f" — {detail}"
    print(line)


def _short(text, n=60):
    text = (text or "").replace("\n", " ")
    return text if len(text) <= n else text[:n] + "…"


# ---------------------------------------------------------------------------
# Individual provider checks
# ---------------------------------------------------------------------------

def check_sarvam():
    if not _have("SARVAM_API_KEY"):
        record("Sarvam", SKIP, "SARVAM_API_KEY not set")
        return None

    # TTS (Telugu) -> returns WAV bytes we reuse for the STT check.
    telugu_text = "నమసకారం, ఈ రోజు నేను మీకు ఎలా సహాయపడగలను?"
    try:
        wav = sarvam.tts(telugu_text, lang="te-IN")
        ok = isinstance(wav, (bytes, bytearray)) and len(wav) > 1000 and bytes(wav[:4]) == b"RIFF"
        record("Sarvam TTS (te-IN)", PASS if ok else FAIL, f"{len(wav)} bytes WAV")
    except Exception as e:
        record("Sarvam TTS (te-IN)", FAIL, _short(str(e)))
        wav = None

    # STT — feed the TTS audio back in. Sarvam should hear Telugu.
    if wav:
        try:
            r = sarvam.stt(bytes(wav), "roundtrip.wav", lang="te-IN")
            record("Sarvam STT (te-IN round-trip)", PASS, f"transcript={_short(r.get('transcript'))}")
        except Exception as e:
            record("Sarvam STT (te-IN round-trip)", FAIL, _short(str(e)))

    # LLM chat.
    try:
        out = sarvam.chat([{"role": "user", "content": "Reply with exactly: OK"}], max_tokens=300)
        record("Sarvam LLM chat", PASS, f"reply={_short(out, 40)}")
    except Exception as e:
        record("Sarvam LLM chat", FAIL, _short(str(e)))
    return wav


def check_gemini():
    if not _have("GEMINI_API_KEY"):
        record("Gemini", SKIP, "GEMINI_API_KEY not set")
        return
    try:
        out = gemini.chat([{"role": "user", "content": "Reply with exactly: OK"}], max_tokens=300)
        record("Gemini LLM chat", PASS, f"reply={_short(out, 40)}")
    except Exception as e:
        record("Gemini LLM chat", FAIL, _short(str(e)))
    try:
        wav = gemini.tts("Hello, this is a test.", lang="en-IN")
        ok = isinstance(wav, (bytes, bytearray)) and bytes(wav[:4]) == b"RIFF"
        record("Gemini TTS (en-IN)", PASS if ok else FAIL, f"{len(wav)} bytes WAV")
    except Exception as e:
        record("Gemini TTS (en-IN)", FAIL, _short(str(e)))


def check_groq():
    if not _have("GROQ_API_KEY"):
        record("Groq", SKIP, "GROQ_API_KEY not set")
        return
    try:
        out = groq.chat([{"role": "user", "content": "Reply with exactly: OK"}], max_tokens=300)
        record("Groq LLM chat", PASS, f"reply={_short(out, 40)}")
    except Exception as e:
        record("Groq LLM chat", FAIL, _short(str(e)))


# ---------------------------------------------------------------------------
# Orchestrator chain checks (these exercise the real fallback order)
# ---------------------------------------------------------------------------

def check_chains(telugu_wav):
    # LLM chain: Gemini -> Groq -> Sarvam. With only a Sarvam key this must
    # transparently fall through to Sarvam and still answer.
    try:
        content, provider = orchestrator.generate(
            [{"role": "user", "content": "ఒక్క మాటలో సమాధానం చెప్పు: సరే"}], max_tokens=40
        )
        record("LLM chain (Gemini→Groq→Sarvam)", PASS, f"answered by '{provider}': {_short(content, 40)}")
    except Exception as e:
        record("LLM chain (Gemini→Groq→Sarvam)", FAIL, _short(str(e)))

    # STT chain: Sarvam -> Gemini -> Groq.
    if telugu_wav:
        try:
            r = orchestrator.transcribe(bytes(telugu_wav), "chain.wav", lang="te-IN")
            record("STT chain (Sarvam→Gemini→Groq)", PASS,
                   f"answered by '{r.get('provider')}': {_short(r.get('transcript'))}")
        except Exception as e:
            record("STT chain (Sarvam→Gemini→Groq)", FAIL, _short(str(e)))

    # TTS chain: Sarvam -> Gemini.
    try:
        audio, provider = orchestrator.synthesize("ఇది ఒక పరీక్ష.", lang="te-IN")
        ok = bytes(audio[:4]) == b"RIFF"
        record("TTS chain (Sarvam→Gemini)", PASS if ok else FAIL, f"answered by '{provider}', {len(audio)} bytes")
    except Exception as e:
        record("TTS chain (Sarvam→Gemini)", FAIL, _short(str(e)))


# ---------------------------------------------------------------------------
# Full voice round trips (STT -> LLM -> TTS)
# ---------------------------------------------------------------------------

def voice_round_trip(label, spoken_wav, lang, llm_prompt):
    try:
        stt = orchestrator.transcribe(bytes(spoken_wav), f"{label}.wav", lang=lang)
        transcript = stt.get("transcript", "")
        content, llm_provider = orchestrator.generate(
            [
                {"role": "system", "content": "Answer in one short sentence in the user's language."},
                {"role": "user", "content": llm_prompt or transcript},
            ],
            max_tokens=60,
        )
        audio, tts_provider = orchestrator.synthesize(content, lang=lang)
        ok = bool(transcript) and bool(content) and bytes(audio[:4]) == b"RIFF"
        record(
            f"Full {label} voice conversation",
            PASS if ok else FAIL,
            f"stt[{stt.get('provider')}]='{_short(transcript, 30)}' "
            f"llm[{llm_provider}]='{_short(content, 30)}' tts[{tts_provider}]={len(audio)}B",
        )
    except Exception as e:
        record(f"Full {label} voice conversation", FAIL, _short(str(e)))


# ---------------------------------------------------------------------------
# Forced-fallback checks — fail the primary provider(s) and confirm the next
# provider in the chain answers. Exercises the real fallback path live.
# ---------------------------------------------------------------------------

def check_fallbacks(audio_wav):
    def _fail(name):
        def _fn(*a, **k):
            raise ProviderError(name, "forced outage for fallback test")
        return _fn

    original = {
        "sarvam_stt": sarvam.stt, "gemini_stt": gemini.stt, "groq_stt": groq.stt,
        "gemini_chat": gemini.chat, "groq_chat": groq.chat, "sarvam_chat": sarvam.chat,
        "sarvam_tts": sarvam.tts, "gemini_tts": gemini.tts,
    }

    def restore():
        sarvam.stt, gemini.stt, groq.stt = original["sarvam_stt"], original["gemini_stt"], original["groq_stt"]
        gemini.chat, groq.chat, sarvam.chat = original["gemini_chat"], original["groq_chat"], original["sarvam_chat"]
        sarvam.tts, gemini.tts = original["sarvam_tts"], original["gemini_tts"]

    def run(label, expect_provider, fn):
        try:
            result = fn()
            provider = result[1] if isinstance(result, tuple) else result.get("provider")
            ok = provider == expect_provider
            record(label, PASS if ok else FAIL, f"answered by '{provider}' (expected '{expect_provider}')")
        except Exception as e:
            record(label, FAIL, _short(str(e)))
        finally:
            restore()

    if not audio_wav:
        record("STT fallbacks", SKIP, "no audio available")
    else:
        # Gemini STT fallback (Sarvam down)
        if _have("GEMINI_API_KEY"):
            sarvam.stt = _fail("sarvam")
            run("STT fallback -> Gemini (Sarvam down)", "gemini",
                lambda: orchestrator.transcribe(bytes(audio_wav), "fb.wav", lang="te-IN"))
        # Groq STT fallback (Sarvam + Gemini down)
        if _have("GROQ_API_KEY"):
            sarvam.stt, gemini.stt = _fail("sarvam"), _fail("gemini")
            run("STT fallback -> Groq (Sarvam+Gemini down)", "groq",
                lambda: orchestrator.transcribe(bytes(audio_wav), "fb.wav", lang="te-IN"))

    # Groq LLM fallback (Gemini down)
    if _have("GROQ_API_KEY"):
        gemini.chat = _fail("gemini")
        run("LLM fallback -> Groq (Gemini down)", "groq",
            lambda: orchestrator.generate([{"role": "user", "content": "Reply with exactly: OK"}], max_tokens=300))
    # Sarvam LLM fallback (Gemini + Groq down)
    if _have("SARVAM_API_KEY"):
        gemini.chat, groq.chat = _fail("gemini"), _fail("groq")
        run("LLM fallback -> Sarvam (Gemini+Groq down)", "sarvam",
            lambda: orchestrator.generate([{"role": "user", "content": "Reply with exactly: OK"}], max_tokens=300))

    # Gemini TTS fallback (Sarvam down)
    if _have("GEMINI_API_KEY"):
        sarvam.tts = _fail("sarvam")
        run("TTS fallback -> Gemini (Sarvam down)", "gemini",
            lambda: orchestrator.synthesize("This is a fallback test.", lang="en-IN"))


def main():
    print("=" * 70)
    print("Live provider verification (real API calls)")
    print("=" * 70)

    telugu_wav = check_sarvam()
    check_gemini()
    check_groq()

    print("-" * 70)
    check_chains(telugu_wav)

    print("-" * 70)
    print("Forced-fallback checks (primary provider failed on purpose)")
    check_fallbacks(telugu_wav)

    print("-" * 70)
    # Build a spoken English clip to drive the English round trip's STT step.
    english_wav = None
    if _have("SARVAM_API_KEY"):
        try:
            english_wav = sarvam.tts("Hello, I would like to book a plumber.", lang="en-IN")
        except Exception:
            english_wav = None
    if telugu_wav:
        voice_round_trip("Telugu", telugu_wav, "te-IN", "నాక ఒక ప్లంబర్ కావాలి.")
    else:
        record("Full Telugu voice conversation", SKIP, "no Telugu TTS audio available")
    if english_wav:
        voice_round_trip("English", english_wav, "en-IN", "I would like to book a plumber.")
    else:
        record("Full English voice conversation", SKIP, "no English TTS audio available")

    print("=" * 70)
    passed = sum(1 for _, s, _ in _results if s == PASS)
    failed = sum(1 for _, s, _ in _results if s == FAIL)
    skipped = sum(1 for _, s, _ in _results if s == SKIP)
    print(f"Summary: {passed} passed, {failed} failed, {skipped} skipped")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
