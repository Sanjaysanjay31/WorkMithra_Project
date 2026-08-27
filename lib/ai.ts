import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { BASE_URL, authFetch, getToken } from '@/lib/api';

// Re-exported for existing imports; the value comes from lib/api (single source).
export { BASE_URL };

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

const DEFAULT_LANG: LangCode = 'en-IN';

/** Coerce an arbitrary backend value to a supported LangCode. */
export function asLangCode(value: unknown, fallback: LangCode = DEFAULT_LANG): LangCode {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v) return fallback;
  if (v === 'auto' || v === 'unknown') return fallback;
  const match = ALL_LANGS.find((l) => l.code.toLowerCase() === v.toLowerCase());
  return match ? match.code : fallback;
}

/**
 * Look up the preferred language of the OTHER participant in a chat.
 *
 * Translation only works if each side knows what language the other side
 * speaks. Both languages are persisted server-side (users.preferred_language
 * and workers.preferred_language), so this reads them instead of each side
 * guessing the other's.
 *
 * @param otherId    The other participant's id (worker id when I'm a user,
 *                   user id when I'm a worker).
 * @param otherRole  'user' | 'worker' — the OTHER side's role.
 * @param myFallback What to use when the other side hasn't set a language.
 */
export async function getOtherLanguage(
  otherId: string,
  otherRole: 'user' | 'worker',
  myFallback: LangCode = DEFAULT_LANG,
): Promise<LangCode> {
  if (!otherId) return myFallback;
  try {
    // Workers are looked up via /workers/{id} (returns WorkerResponse with
    // preferred_language); users via /profiles/user/{id}. Both endpoints
    // require authentication, which is fine — chat is only ever opened by an
    // authenticated participant.
    const path =
      otherRole === 'worker'
        ? `/workers/${encodeURIComponent(otherId)}`
        : `/profiles/user/${encodeURIComponent(otherId)}`;
    const res = await authFetch(path);
    if (!res.ok) return myFallback;
    const data = await res.json();
    const lang = data?.preferred_language ?? data?.preferredLanguage;
    return asLangCode(lang, myFallback);
  } catch {
    return myFallback;
  }
}

/**
 * Persist MY language choice so future chats start with it and the other
 * participant's translation targets it automatically. Fire-and-forget: a
 * failed save only means the pick isn't remembered next time — the current
 * conversation still uses the locally selected value.
 */
export function saveMyLanguage(myId: string, myRole: 'user' | 'worker', lang: LangCode): void {
  if (!myId || !lang || lang === 'auto') return;
  const path =
    myRole === 'worker'
      ? `/workers/${encodeURIComponent(myId)}`
      : `/profiles/user/${encodeURIComponent(myId)}`;
  void authFetch(path, { method: 'PUT', json: { preferred_language: lang } }).catch(() => {});
}

export async function aiDetectLang(text: string): Promise<LangCode> {
  if (!text.trim()) return 'en-IN';
  // Fast local script checks (0ms latency, saves network call)
  if (/[ఀ-౿]/.test(text)) return 'te-IN';
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN';
  if (/[஀-௿]/.test(text)) return 'ta-IN';
  if (/[ಀ-೿]/.test(text)) return 'kn-IN';
  if (/[ഀ-ൿ]/.test(text)) return 'ml-IN';
  if (/[઀-૿]/.test(text)) return 'gu-IN';
  if (/[ঀ-৿]/.test(text)) return 'bn-IN';
  if (/[਀-੿]/.test(text)) return 'pa-IN';
  if (/[଀-୿]/.test(text)) return 'or-IN';
  if (/[؀-ۿ]/.test(text)) return 'ur-IN';
  if (/^[a-zA-Z0-9\s.,!?'"()-]+$/.test(text.trim())) return 'en-IN';

  try {
    const res = await authFetch('/ai/detect-lang', {
      method: 'POST',
      json: { text },
    });
    if (!res.ok) throw new Error('detect failed');
    const data = await res.json();
    const code = (data.language_code || data.languageCode || '').toString();
    if (code) return code as LangCode;
  } catch {}
  return 'en-IN';
}

export async function aiTranslate(text: string, source: LangCode, target: LangCode): Promise<string> {
  if (!text.trim() || source === target) return text;
  // Generous timeout: a cold Render dyno can take ~50s to wake before the
  // translate call even starts, and the default 30s would abort first.
  const res = await authFetch('/ai/translate', {
    method: 'POST',
    json: { text, source_lang: source, target_lang: target },
    timeoutMs: 60000,
  });
  if (!res.ok) throw new Error('translate failed');
  const data = await res.json();
  return data.translated_text || data.output || text;
}

export async function aiExtract(text: string, schemaHint: string): Promise<any> {
  const res = await authFetch('/ai/extract', {
    method: 'POST',
    json: { text, schema: schemaHint },
    timeoutMs: 90000,
  });
  if (!res.ok) throw new Error('extract failed');
  return res.json();
}

export async function aiChat(prompt: string, system?: string): Promise<string> {
  // LLM generation plus a possible cold start routinely exceeds the default
  // 30s fetch timeout — with it, the first question after the backend slept
  // always died with an AbortError bubble.
  const res = await authFetch('/ai/chat', {
    method: 'POST',
    json: { prompt, system },
    timeoutMs: 90000,
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { const j = await res.json(); detail = j.detail || JSON.stringify(j); } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  return data.reply || '';
}

export function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')       // **bold** -> bold
    .replace(/\*(.*?)\*/g, '$1')           // *italic* -> italic
    .replace(/__(.*?)__/g, '$1')           // __bold__ -> bold
    .replace(/_(.*?)_/g, '$1')             // _italic_ -> italic
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')    // `code` -> code
    .replace(/^[*\-#]\s+/gm, '')           // leading bullets
    .replace(/Sentence \d+:\s*/gi, '')     // "Sentence 1: " prefix
    .replace(/[*_#~`\\/|]/g, ' ')          // remove remaining markdown symbols
    .replace(/\s+/g, ' ')                  // collapse multi spaces
    .trim();
}

/** Returns a playable audio URL (web: object URL; native: data URI). */
export async function aiTTS(text: string, targetLang: LangCode = 'en-IN'): Promise<string> {
  const cleanText = cleanTextForSpeech(text);
  if (!cleanText) throw new Error('No text for TTS');
  const res = await authFetch('/ai/tts', {
    method: 'POST',
    json: { text: cleanText, target_lang: targetLang },
    timeoutMs: 60000,
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

// Cross-platform audio playback. On web we use the HTML5 Audio element; on
// native we use expo-av's Audio.Sound. `_currentAudio` is whichever is active.
let _currentAudio: any = null;
let _currentIsNative = false;
let _muted = false;
let _paused = false;
let _pauseResolvers: (() => void)[] = [];
// The URL currently being played. On web these are blob: object URLs that must
// be revoked after use or they leak memory for the life of the page.
let _currentUrl: string | null = null;

function revokeCurrentUrl() {
  const url = _currentUrl;
  _currentUrl = null;
  if (url && Platform.OS === 'web' && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch {}
  }
}

export function setMuted(v: boolean) {
  _muted = v;
  if (v) stopAudio();
}

export function stopAudio() {
  try {
    if (_currentAudio) {
      if (_currentIsNative) {
        _currentAudio.stopAsync?.().catch(() => {});
        _currentAudio.unloadAsync?.().catch(() => {});
      } else {
        _currentAudio.pause();
        _currentAudio.currentTime = 0;
      }
      _currentAudio = null;
    }
  } catch {}
  revokeCurrentUrl();
  _paused = false;
  const r = _pauseResolvers; _pauseResolvers = [];
  r.forEach((fn) => fn());
}

export function pauseAudio() {
  _paused = true;
  try {
    if (_currentIsNative) _currentAudio?.pauseAsync?.().catch(() => {});
    else _currentAudio?.pause();
  } catch {}
}

export function resumeAudio() {
  _paused = false;
  try {
    if (_currentIsNative) _currentAudio?.playAsync?.().catch(() => {});
    else _currentAudio?.play()?.catch?.(() => {});
  } catch {}
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

/** Plays a TTS audio URL. Works on web (HTML5 Audio) and native (expo-av). */
export async function playAudio(url: string): Promise<void> {
  if (_muted) return;
  stopAudio();
  _currentUrl = url;

  if (Platform.OS === 'web') {
    const Ctor: any = (globalThis as any).Audio;
    if (!Ctor) { revokeCurrentUrl(); return; }
    return new Promise((resolve, reject) => {
      if (_muted) { revokeCurrentUrl(); return resolve(); }
      const a = new Ctor(url);
      _currentAudio = a;
      _currentIsNative = false;
      a.onended = () => { if (_currentAudio === a) _currentAudio = null; revokeCurrentUrl(); resolve(); };
      a.onerror = (e: any) => { if (_currentAudio === a) _currentAudio = null; revokeCurrentUrl(); reject(e); };
      a.play().then(() => {}).catch((e: any) => { if (_currentAudio === a) _currentAudio = null; revokeCurrentUrl(); reject(e); });
    });
  }

  // Native: expo-av
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  } catch {}
  const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
  if (_muted) { try { await sound.unloadAsync(); } catch {} revokeCurrentUrl(); return; }
  _currentAudio = sound;
  _currentIsNative = true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (_currentAudio === sound) _currentAudio = null;
      revokeCurrentUrl();
      resolve();
    };
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (!status?.isLoaded) return;
      if (status.didJustFinish) {
        try { sound.unloadAsync(); } catch {}
        finish();
      }
    });
    // Safety net: if the finished event never fires (corrupt/empty clip),
    // don't leave the forever — release the sound after a generous cap.
    setTimeout(() => {
      try { sound.unloadAsync(); } catch {}
      finish();
    }, 90000);
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

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ');
  // Split on sentence-ending punctuation, keeping the punctuation attached to the
  // preceding sentence. A capture group is used instead of a lookbehind
  // (?<=...) because lookbehinds are unsupported on older JS engines (Hermes/JSC).
  const parts = normalized.split(/([.!?।॥。！？]+\s*)/);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = (parts[i] || '') + (parts[i + 1] || '');
    const trimmed = chunk.trim();
    if (trimmed) sentences.push(trimmed);
  }
  return sentences;
}

function splitForTTS(text: string, maxLen: number): string[] {
  const sentences = splitSentences(text);
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
 * Native STT: record mic audio via expo-av, then upload to /ai/stt when stopped.
 * Returns a controller with the same shape as webSTTControlled.
 */
// Module-level guard: expo-av allows only ONE Recording instance globally.
let _activeRecording: any = null;
async function cleanupStaleRecording() {
  if (!_activeRecording) return;
  try { await _activeRecording.stopAndUnloadAsync(); } catch {}
  _activeRecording = null;
}

function nativeSTTControlled(lang: LangCode = 'en-IN'): { stop: () => void; result: Promise<string> } {
  let recording: any = null;
  let stopped = false;
  let startedAt = 0;
  let resolveFn!: (v: string) => void;
  let rejectFn!: (e: any) => void;
  const result = new Promise<string>((res, rej) => { resolveFn = res; rejectFn = rej; });

  (async () => {
    try {
      await cleanupStaleRecording();
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error('Microphone permission denied');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const rec = new Audio.Recording();
      // Use HIGH_QUALITY preset (m4a / AAC). Sarvam saarika:v2 accepts m4a/mp4.
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      startedAt = Date.now();
      recording = rec;
      _activeRecording = rec;
    } catch (e) {
      _activeRecording = null;
      if (!stopped) { stopped = true; rejectFn(e); }
    }
  })();

  const doStop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      if (!recording) { resolveFn(''); return; }
      // Guard against accidental tap-tap → recording too short = silent file.
      const elapsed = startedAt ? Date.now() - startedAt : 0;
      if (elapsed < 600) {
        await new Promise((r) => setTimeout(r, 600 - elapsed));
      }
      try { await recording.stopAndUnloadAsync(); } catch {}
      if (_activeRecording === recording) _activeRecording = null;
      const uri: string | null = recording.getURI?.() ?? null;
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {}
      if (!uri) { rejectFn(new Error('Recording produced no audio file')); return; }

      // Sarvam handles m4a, but renaming to .mp4 avoids any extension-based rejection.
      const origName = uri.split('/').pop() || 'speech.m4a';
      const safeName = origName.endsWith('.m4a') ? origName.replace(/\.m4a$/, '.mp4') : origName;
      const ext = (safeName.split('.').pop() || 'mp4').toLowerCase();
      const mime = ext === 'mp4' || ext === 'm4a' ? 'audio/mp4' : ext === 'webm' ? 'audio/webm' : 'audio/wav';

      const form = new FormData();
      // @ts-ignore RN FormData file shape
      form.append('file', { uri, name: safeName, type: mime });
      form.append('lang', lang === 'auto' ? 'unknown' : lang);

      const sttUrl = `${BASE_URL}/ai/stt`;
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(sttUrl, { method: 'POST', body: form, headers });
      const text = await res.text();
      if (!res.ok) {
        rejectFn(new Error(`STT failed (${res.status}): ${text.slice(0, 200)}`));
        return;
      }
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { transcript: text }; }
      const transcript = data.transcript || data.text || data.output || '';
      if (!transcript || !transcript.trim()) {
        rejectFn(new Error(`No speech detected. Backend returned: ${text.slice(0, 200) || '(empty)'}`));
        return;
      }
      resolveFn(transcript);
    } catch (e) {
      rejectFn(e);
    }
  };

  return { stop: () => { doStop(); }, result };
}

/**
 * Caller-controlled STT: starts the mic and returns a controller. The caller
 * decides when to stop (e.g. when the user taps the mic again). Continuous
 * mode so pauses don't end it. Captures the running transcript until stop().
 */
export function webSTTControlled(
  lang: LangCode = 'en-IN',
  opts: { silenceMs?: number } = {},
): { stop: () => void; result: Promise<string> } {
  const silenceMs = opts.silenceMs ?? 0; // 0 = no silence auto-stop
  let settled = false;
  let bestTranscript = '';
  let silenceTimer: any = null;
  let recog: any;
  let resolveFn!: (v: string) => void;
  let rejectFn!: (e: any) => void;
  const result = new Promise<string>((res, rej) => { resolveFn = res; rejectFn = rej; });

  if (Platform.OS !== 'web') {
    // Native: record audio then upload to backend /ai/stt on stop.
    const ctrl = nativeSTTControlled(lang);
    ctrl.result.then(resolveFn).catch(rejectFn);
    return { stop: ctrl.stop, result };
  }
  const SR: any = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
  if (!SR) {
    rejectFn(new Error('Speech recognition not supported in this browser'));
    return { stop: () => {}, result };
  }

  recog = new SR();
  recog.lang = lang === 'auto' ? 'en-IN' : lang;
  recog.interimResults = true;
  recog.continuous = true;
  recog.maxAlternatives = 1;

  const armSilenceTimer = () => {
    if (!silenceMs) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => { try { recog.stop(); } catch {} }, silenceMs);
  };

  recog.onresult = (e: any) => {
    try {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript || '';
      if (txt) bestTranscript = txt;
      armSilenceTimer();  // any new speech resets the silence countdown
    } catch {}
  };
  recog.onspeechstart = () => armSilenceTimer();
  recog.onerror = (e: any) => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (settled) return;
    const err = e?.error;
    // 'no-speech' = nothing was heard, 'aborted' = we stopped it ourselves.
    // Neither is a real failure — resolve with whatever was captured.
    if (err === 'no-speech' || err === 'aborted') {
      settled = true;
      resolveFn(bestTranscript);
      return;
    }
    settled = true;
    rejectFn(err || new Error('stt error'));
  };
  recog.onend = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (!settled) { settled = true; resolveFn(bestTranscript); }
  };

  try {
    recog.start();
    armSilenceTimer();
  } catch (e) {
    if (!settled) { settled = true; rejectFn(e); }
  }

  return {
    stop: () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      try { recog.stop(); } catch {}
    },
    result,
  };
}

/**
 * Browser STT via Web Speech API. Hard-stops after `maxMs` so the mic never
 * stays on indefinitely (default 8s — 4s was too short to say a full message).
 * Resolves with the transcript captured up to that point (or '' if nothing).
 */
export function webSTT(lang: LangCode = 'en-IN', maxMs: number = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Platform.OS !== 'web') {
      const ctrl = nativeSTTControlled(lang);
      const timer = setTimeout(() => ctrl.stop(), maxMs);
      ctrl.result
        .then((t) => { clearTimeout(timer); resolve(t); })
        .catch((e) => { clearTimeout(timer); reject(e); });
      return;
    }
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
      const err = e?.error;
      // 'no-speech' = nothing heard, 'aborted' = we stopped it. Resolve with
      // whatever was captured instead of surfacing an error to the user.
      if (err === 'no-speech' || err === 'aborted') { finish(bestTranscript); return; }
      settled = true;
      clearTimeout(timer);
      reject(err || new Error('stt error'));
    };
    recog.onend = () => { if (!settled) finish(bestTranscript); };

    const timer = setTimeout(() => finish(bestTranscript), maxMs);

    try { recog.start(); } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
