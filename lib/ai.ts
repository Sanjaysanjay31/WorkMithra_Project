import { Platform } from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export type LangCode =
  | 'en-IN' | 'hi-IN' | 'te-IN' | 'ta-IN' | 'kn-IN' | 'ml-IN'
  | 'mr-IN' | 'gu-IN' | 'bn-IN' | 'pa-IN' | 'or-IN' | 'as-IN' | 'ur-IN'
  | 'auto';

export const ALL_LANGS: { code: LangCode; label: string; english: string }[] = [
  { code: 'en-IN', label: 'English',   english: 'English' },
  { code: 'hi-IN', label: 'हिन्दी',     english: 'Hindi' },
  { code: 'te-IN', label: 'తెలుగు',     english: 'Telugu' },
  { code: 'ta-IN', label: 'தமிழ்',       english: 'Tamil' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ',       english: 'Kannada' },
  { code: 'ml-IN', label: 'മലയാളം',     english: 'Malayalam' },
  { code: 'mr-IN', label: 'मराठी',       english: 'Marathi' },
  { code: 'gu-IN', label: 'ગુજરાતી',     english: 'Gujarati' },
  { code: 'bn-IN', label: 'বাংলা',       english: 'Bengali' },
  { code: 'pa-IN', label: 'ਪੰਜਾਬੀ',     english: 'Punjabi' },
  { code: 'or-IN', label: 'ଓଡ଼ିଆ',       english: 'Odia' },
  { code: 'as-IN', label: 'অসমীয়া',     english: 'Assamese' },
  { code: 'ur-IN', label: 'اردو',        english: 'Urdu' },
];

// Default pinned set shown as quick chips
export const LANGS = ALL_LANGS.slice(0, 6);

export async function aiDetectLang(text: string): Promise<LangCode> {
  if (!text.trim()) return 'en-IN';
  try {
    const res = await fetch(`${BASE_URL}/ai/detect-lang`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('detect failed');
    const data = await res.json();
    const code = (data.language_code || data.languageCode || '').toString();
    if (code) return code as LangCode;
  } catch {}
  // fallback: heuristic by Unicode block
  if (/[ఀ-౿]/.test(text)) return 'te-IN';
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN';
  if (/[஀-௿]/.test(text)) return 'ta-IN';
  if (/[ಀ-೿]/.test(text)) return 'kn-IN';
  if (/[ഀ-ൿ]/.test(text)) return 'ml-IN';
  return 'en-IN';
}

export async function aiTranslate(text: string, source: LangCode, target: LangCode): Promise<string> {
  if (!text.trim() || source === target) return text;
  const res = await fetch(`${BASE_URL}/ai/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source_lang: source, target_lang: target }),
  });
  if (!res.ok) throw new Error('translate failed');
  const data = await res.json();
  return data.translated_text || data.output || text;
}

export async function aiExtract(text: string, schemaHint: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/ai/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, schema: schemaHint }),
  });
  if (!res.ok) throw new Error('extract failed');
  return res.json();
}

export async function aiChat(prompt: string, system?: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { const j = await res.json(); detail = j.detail || JSON.stringify(j); } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  return data.reply || '';
}

/** Returns a playable audio URL (web: object URL; native: data URI). */
export async function aiTTS(text: string, targetLang: LangCode = 'en-IN'): Promise<string> {
  const res = await fetch(`${BASE_URL}/ai/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target_lang: targetLang }),
  });
  if (!res.ok) throw new Error('tts failed');
  const blob = await res.blob();
  if (Platform.OS === 'web') {
    return URL.createObjectURL(blob);
  }
  // native: convert to base64 data URI
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Tracks the currently playing audio so we can stop it, plus a mute flag
// that suppresses pending playbacks (e.g. when the assistant modal was closed
// while a TTS fetch was still in flight).
let _currentAudio: any = null;
let _muted = false;
let _paused = false;
let _pauseResolvers: Array<() => void> = [];

export function setMuted(v: boolean) {
  _muted = v;
  if (v) stopAudio();
}

export function stopAudio() {
  try {
    if (_currentAudio) {
      _currentAudio.pause();
      _currentAudio.currentTime = 0;
      _currentAudio = null;
    }
  } catch {}
  // unblock any waiters so speakLong loop can exit
  _paused = false;
  const r = _pauseResolvers; _pauseResolvers = [];
  r.forEach((fn) => fn());
}

export function pauseAudio() {
  _paused = true;
  try { _currentAudio?.pause(); } catch {}
}

export function resumeAudio() {
  _paused = false;
  try { _currentAudio?.play()?.catch?.(() => {}); } catch {}
  const r = _pauseResolvers; _pauseResolvers = [];
  r.forEach((fn) => fn());
}

export function isPaused() {
  return _paused;
}

function waitWhileNotPaused(): Promise<void> {
  if (!_paused) return Promise.resolve();
  return new Promise((res) => _pauseResolvers.push(res));
}

/** Plays a TTS audio URL (web only). Respects mute flag and stops any previous audio. */
export function playAudio(url: string): Promise<void> {
  if (Platform.OS !== 'web') return Promise.resolve();
  if (_muted) return Promise.resolve();
  const Ctor: any = (globalThis as any).Audio;
  if (!Ctor) return Promise.resolve();
  stopAudio();
  return new Promise((resolve, reject) => {
    if (_muted) return resolve();
    const a = new Ctor(url);
    _currentAudio = a;
    a.onended = () => { if (_currentAudio === a) _currentAudio = null; resolve(); };
    a.onerror = (e: any) => { if (_currentAudio === a) _currentAudio = null; reject(e); };
    a.play().then(() => {}).catch((e: any) => { if (_currentAudio === a) _currentAudio = null; reject(e); });
  });
}

/** Convenience: TTS the text and play it. Skips entirely if muted. */
export async function speak(text: string, lang: LangCode = 'en-IN'): Promise<void> {
  if (!text.trim() || _muted) return;
  const url = await aiTTS(text, lang);
  if (_muted) return;
  await playAudio(url);
}

/**
 * Speaks long text by splitting into sentence-sized chunks (Sarvam TTS has
 * per-request length limits). Plays them sequentially. Respects muted flag —
 * if `setMuted(true)` is called mid-stream, remaining chunks are skipped.
 */
export async function speakLong(text: string, lang: LangCode = 'en-IN'): Promise<void> {
  if (!text.trim() || _muted) return;
  const chunks = splitForTTS(text, 450);
  for (const c of chunks) {
    if (_muted) return;
    await waitWhileNotPaused();
    if (_muted) return;
    try {
      const url = await aiTTS(c, lang);
      if (_muted) return;
      await waitWhileNotPaused();
      if (_muted) return;
      await playAudio(url);
    } catch (e) {
      console.warn('TTS chunk failed:', e);
    }
  }
}

function splitForTTS(text: string, maxLen: number): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。!?]|\n)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).trim().length > maxLen) {
      if (buf) out.push(buf.trim());
      if (s.length > maxLen) {
        // hard split
        for (let i = 0; i < s.length; i += maxLen) out.push(s.slice(i, i + maxLen));
        buf = '';
      } else {
        buf = s;
      }
    } else {
      buf = (buf ? buf + ' ' : '') + s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text];
}

/**
 * Browser STT via Web Speech API. Hard-stops after `maxMs` so the mic never
 * stays on indefinitely (default 4s). Resolves with the transcript captured
 * up to that point (or '' if nothing).
 */
export function webSTT(lang: LangCode = 'en-IN', maxMs: number = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Platform.OS !== 'web') return reject(new Error('web only'));
    const SR: any = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SR) return reject(new Error('Speech recognition not supported in this browser'));
    const recog = new SR();
    recog.lang = lang === 'auto' ? 'en-IN' : lang;
    recog.interimResults = true;     // capture in-progress text for the hard-cut case
    recog.maxAlternatives = 1;

    let bestTranscript = '';
    let settled = false;

    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { recog.stop(); } catch {}
      resolve(text);
    };

    recog.onresult = (e: any) => {
      // Concatenate all available alternatives so we keep what was heard.
      try {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) {
          txt += e.results[i][0].transcript || '';
        }
        if (txt) bestTranscript = txt;
        // If a final result fires before the timer, resolve immediately.
        if (e.results[e.results.length - 1]?.isFinal) finish(bestTranscript);
      } catch {}
    };
    recog.onerror = (e: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e?.error || new Error('stt error'));
    };
    recog.onend = () => { if (!settled) finish(bestTranscript); };

    const timer = setTimeout(() => finish(bestTranscript), maxMs);

    try { recog.start(); } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
