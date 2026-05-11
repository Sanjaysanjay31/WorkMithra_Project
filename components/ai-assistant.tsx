import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    FlatList,
    Modal,
    PanResponder,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { aiChat, aiDetectLang, aiExtract, aiTranslate, ALL_LANGS, LANGS, LangCode, pauseAudio, resumeAudio, setMuted, speakLong, stopAudio, webSTT } from '@/lib/ai';
import { assistantBus } from '@/lib/assistant-bus';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';

type Msg = { who: 'ai' | 'me'; text: string };

const SESSION_KEY = 'workmithra:assistant_session';

const LANG_NAME: Record<string, string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'te-IN': 'Telugu',
  'ta-IN': 'Tamil',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'gu-IN': 'Gujarati',
  'bn-IN': 'Bengali',
  'pa-IN': 'Punjabi',
  'or-IN': 'Odia',
  'as-IN': 'Assamese',
  'ur-IN': 'Urdu',
};

type ScreenContext = {
  name: string;
  purpose: string;          // told to LLM
  suggestions: string[];    // quick chips
  onboardSteps?: Step[];    // trigger guided onboarding
};

type Step =
  | { id: 'name'; q: string; key: 'full_name' }
  | { id: 'phone'; q: string; key: 'phone' }
  | { id: 'role'; q: string; key: 'role' }
  | { id: 'skill'; q: string; key: 'skill' }
  | { id: 'experience'; q: string; key: 'experience_years' }
  | { id: 'wage'; q: string; key: 'hourly_rate' }
  | { id: 'location'; q: string; key: 'location' }
  | { id: 'timings'; q: string; key: 'timings' };

const REGISTRATION_STEPS: Step[] = [
  { id: 'name', q: 'What is your name?', key: 'full_name' },
  { id: 'phone', q: 'What is your mobile number?', key: 'phone' },
  { id: 'role', q: 'How would you like to use WorkMithra — User, Worker, or Both?', key: 'role' },
];

const WORKER_STEPS: Step[] = [
  { id: 'skill', q: 'What work do you do?', key: 'skill' },
  { id: 'experience', q: 'How many years of experience do you have?', key: 'experience_years' },
  { id: 'wage', q: 'How much do you charge per hour in rupees?', key: 'hourly_rate' },
  { id: 'location', q: 'Which areas do you work in?', key: 'location' },
  { id: 'timings', q: 'What are your available timings?', key: 'timings' },
];

function getScreenContext(pathname: string): ScreenContext {
  const p = (pathname || '').toLowerCase();
  if (p.includes('login')) {
    return {
      name: 'Login',
      purpose: 'The user is on the Login screen. They need to enter their registered phone number or email and password to sign in. There is a forgot-password link and a Register link if they are new.',
      suggestions: ['How do I login?', 'I forgot my password', 'I am new — register me'],
    };
  }
  if (p.includes('register')) {
    return {
      name: 'Register',
      purpose: 'The user is on the Register screen. Required: full name, phone, email (with OTP verification), password and confirm password. They must click Get OTP, then Verify OTP, before Create Account is enabled.',
      suggestions: ['Help me fill the form', 'I did not get the OTP', 'What does Verify OTP mean?'],
      onboardSteps: REGISTRATION_STEPS,
    };
  }
  if (p.includes('switch_role')) {
    return {
      name: 'Choose Role',
      purpose: 'The user must pick how they want to use WorkMithra: as a User who hires workers, or as a Worker who offers services. They can switch later anytime.',
      suggestions: ['What is the difference?', 'I want to hire someone', 'I want to find work'],
    };
  }
  if (p.includes('homepage')) {
    return {
      name: 'Home (Find Workers)',
      purpose: 'The user is on the home page where they can search for workers by domain (e.g. plumber, electrician). They can use voice search via the mic icon, apply filters (wage range, distance, experience, rating) via the filter button, and tap More on any worker card to see details.',
      suggestions: ['Find plumber near me', 'How to filter by price?', 'Show top rated workers', 'How do I book?'],
    };
  }
  if (p.includes('worker_info')) {
    return {
      name: 'Worker Details',
      purpose: 'The user is viewing a specific worker. Tabs: Profile (name, age, domain, wage, experience, phone), Reviews, Chat (opens the AI translation chat to talk to the worker in any language), Booking (book the worker now).',
      suggestions: ['How do I book this worker?', 'How does AI chat work?', 'Show reviews'],
    };
  }
  if (p.includes('chat')) {
    return {
      name: 'AI Translation Chat',
      purpose: 'A live chat between the client and the worker. The user types or speaks in any language; the AI auto-detects the language and translates to the other person. Each message has a speaker icon to listen to it.',
      suggestions: ['How do I send voice?', 'Change my language', 'Read this message aloud'],
    };
  }
  if (p.includes('bookings')) {
    return {
      name: 'My Bookings',
      purpose: 'The user can see Present and Completed bookings here.',
      suggestions: ['Where is my booking?', 'How to cancel?', 'Show completed work'],
    };
  }
  if (p.includes('profile')) {
    return {
      name: 'My Profile',
      purpose: 'The user can view and edit their profile: name, phone, alternative phone, location, pincode. Click Edit to change, Save Changes to save.',
      suggestions: ['Help me fill profile', 'How do I save changes?'],
    };
  }
  if (p.includes('worker_dashboard')) {
    return {
      name: 'Worker Dashboard',
      purpose: 'A worker sees their own image and two tabs: Details (their own info) and Past Work (places, ratings, reviews of past jobs).',
      suggestions: ['How do I add past work?', 'Edit my details'],
    };
  }
  if (p.includes('worker_bookings')) {
    return {
      name: 'Booking Requests',
      purpose: 'Workers see incoming booking requests: Pending vs Accepted. They can Accept or Decline pending ones.',
      suggestions: ['How do I accept?', 'Should I accept this?'],
    };
  }
  if (p.includes('worker_profile')) {
    return {
      name: 'Worker Profile (My Info)',
      purpose: 'Workers can create or edit their full profile: name, age, domain/skill, wage per hour, experience years, phone, alt phone, location, pincode.',
      suggestions: ['Help me create profile', 'What domain should I pick?'],
      onboardSteps: WORKER_STEPS,
    };
  }
  return {
    name: 'WorkMithra',
    purpose: 'A hyperlocal service marketplace connecting users with workers (plumbers, electricians, painters, etc.). Multilingual, voice-first, designed for everyone including illiterate users.',
    suggestions: ['How do I register?', 'How do I find a worker?', 'How does voice chat work?'],
  };
}

export function AIAssistant() {
  const pathname = usePathname() || '';
  const ctx = useMemo(() => getScreenContext(pathname), [pathname]);

  const [visible, setVisible] = useState(false);
  const [lang, setLang] = useState<LangCode>('en-IN');
  const [pinned, setPinned] = useState<LangCode[]>(LANGS.map((l) => l.code));
  const [showLangSearch, setShowLangSearch] = useState(false);
  const [langQuery, setLangQuery] = useState('');

  // Load pinned list from storage on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.get('workmithra:pinned_langs');
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) setPinned(arr);
        }
      } catch {}
    })();
  }, []);

  function togglePin(code: LangCode) {
    setPinned((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      storage.set('workmithra:pinned_langs', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  const filteredLangs = ALL_LANGS.filter((l) => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return true;
    return l.english.toLowerCase().includes(q) || l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
  });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Onboarding overlay state
  const [onboardActive, setOnboardActive] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [collected, setCollected] = useState<Record<string, any>>({});

  const listRef = useRef<FlatList<Msg>>(null);
  const greetTimerRef = useRef<any>(null);

  // Translated suggestion labels for the current language
  const [translatedSuggestions, setTranslatedSuggestions] = useState<string[]>(ctx.suggestions);
  const [guideMeLabel, setGuideMeLabel] = useState<string>('Guide me');

  // Restore conversation from local storage (school-project simple — no DB).
  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.get(SESSION_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as Msg[];
          if (Array.isArray(arr) && arr.length) setMsgs(arr);
        }
      } catch {}
    })();
  }, []);

  // Persist every change to storage so navigation keeps the chat.
  useEffect(() => {
    storage.set(SESSION_KEY, JSON.stringify(msgs)).catch(() => {});
  }, [msgs]);

  const SCRIPT_RE: Record<string, RegExp> = {
    'hi-IN': /[ऀ-ॿ]/, 'te-IN': /[ఀ-౿]/, 'ta-IN': /[஀-௿]/,
    'kn-IN': /[ಀ-೿]/, 'ml-IN': /[ഀ-ൿ]/, 'mr-IN': /[ऀ-ॿ]/,
    'gu-IN': /[઀-૿]/, 'bn-IN': /[ঀ-৿]/, 'pa-IN': /[਀-੿]/,
    'or-IN': /[଀-୿]/, 'as-IN': /[ঀ-৿]/, 'ur-IN': /[؀-ۿ]/,
  };

  /**
   * Persists an AI/user message. For AI messages, if a non-English language is
   * selected and the text doesn't already contain that script, translate first
   * so the user never sees English.
   */
  function appendMsgPersist(m: Msg) {
    if (m.who !== 'ai' || lang === 'en-IN') {
      appendMsg(m);
      return;
    }
    const re = SCRIPT_RE[lang];
    if (re && re.test(m.text)) {
      appendMsg(m);  // already in the right script
      return;
    }
    // Translate async then append (placeholder kept minimal)
    (async () => {
      try {
        const translated = await safeTranslate(m.text, 'en-IN', lang);
        appendMsg({ ...m, text: translated });
      } catch {
        appendMsg(m);  // best effort
      }
    })();
  }

  // When the modal opens: if no prior chat, greet; if there is, just continue.
  useEffect(() => {
    if (!visible) return;
    translateChips();
    if (msgs.length === 0) {
      greet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // When the screen changes while modal open, append a small marker so the bot
  // knows context shifted but DON'T wipe history.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (!visible) return;
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    (async () => {
      const en = `— Now on ${ctx.name} —`;
      const text = lang === 'en-IN' ? en : await safeTranslate(en, 'en-IN', lang);
      appendMsgPersist({ who: 'ai', text });
    })();
    translateChips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // When language changes: stop audio, re-translate suggestions; do NOT reset msgs.
  useEffect(() => {
    if (!visible) return;
    stopAudio();
    translateChips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Recompute translated suggestions whenever screen changes
  useEffect(() => {
    if (visible) translateChips();
    else setTranslatedSuggestions(ctx.suggestions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function translateChips() {
    if (lang === 'en-IN') {
      setTranslatedSuggestions(ctx.suggestions);
      setGuideMeLabel('Guide me');
      return;
    }
    try {
      const translated = await Promise.all(ctx.suggestions.map((s) => safeTranslate(s, 'en-IN', lang)));
      setTranslatedSuggestions(translated);
      const g = await safeTranslate('Guide me', 'en-IN', lang);
      setGuideMeLabel(g);
    } catch {
      setTranslatedSuggestions(ctx.suggestions);
      setGuideMeLabel('Guide me');
    }
  }

  function closeModal() {
    if (greetTimerRef.current) {
      clearTimeout(greetTimerRef.current);
      greetTimerRef.current = null;
    }
    setMuted(true);   // suppress any in-flight TTS playback
    stopAudio();
    setListening(false);
    setSpeaking(false);
    setPaused(false);
    setVisible(false);
    // Erase the conversation only on explicit quit (red cross).
    setMsgs([]);
    setCollected({});
    setOnboardActive(false);
    setStepIdx(0);
    storage.remove(SESSION_KEY).catch(() => {});
  }

  function openModal() {
    setMuted(false);
    setVisible(true);
  }

  // Allow any screen to programmatically open the assistant via the event bus.
  useEffect(() => {
    const off = assistantBus.subscribe(() => openModal());
    return () => { off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FAB is always visible — it's draggable so users can move it out of the way
  // if it ever covers a button on a particular screen.
  const hideFab = false;

  // --- Draggable FAB ---
  const FAB_SIZE = 52;
  const frameW = Math.min(Dimensions.get('window').width, 360);
  const frameH = Math.min(Dimensions.get('window').height, 803);
  const fabPos = useRef(new Animated.ValueXY({ x: frameW - FAB_SIZE - 14, y: frameH - FAB_SIZE - 86 })).current;
  const movedRef = useRef(false);

  const fabPan = useRef(
    PanResponder.create({
      // Don't claim on touch-start so the TouchableOpacity gets the tap.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // Use the CAPTURE phase so we intercept the move from TouchableOpacity
      // (which otherwise refuses to give up the responder once it has it).
      onMoveShouldSetPanResponder: (_, g) => Math.hypot(g.dx, g.dy) > 4,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        movedRef.current = true;
        const x = (fabPos.x as any)._value || 0;
        const y = (fabPos.y as any)._value || 0;
        fabPos.setOffset({ x, y });
        fabPos.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: fabPos.x, dy: fabPos.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        fabPos.flattenOffset();
        let x = (fabPos.x as any)._value;
        let y = (fabPos.y as any)._value;
        x = Math.max(0, Math.min(x, frameW - FAB_SIZE));
        y = Math.max(0, Math.min(y, frameH - FAB_SIZE));
        fabPos.setValue({ x, y });
        storage.set('workmithra:assistant_pos', JSON.stringify({ x, y })).catch(() => {});
        // movedRef stays true briefly; reset after a tick so any pending tap is cancelled.
        setTimeout(() => { movedRef.current = false; }, 0);
      },
    }),
  ).current;

  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.get('workmithra:assistant_pos');
        if (raw) {
          const p = JSON.parse(raw);
          if (typeof p?.x === 'number' && typeof p?.y === 'number') fabPos.setValue(p);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function greet() {
    setOnboardActive(false);
    const greetEn = `You are on the ${ctx.name} screen. ${ctx.purpose} How can I help you here?`;
    const text = lang === 'en-IN' ? greetEn : await safeTranslate(greetEn, 'en-IN', lang);
    appendMsgPersist({ who: 'ai', text });
    // Speak the greeting after a 3-second pause so the user has time to read.
    if (greetTimerRef.current) { clearTimeout(greetTimerRef.current); greetTimerRef.current = null; }
    if (Platform.OS === 'web') {
      greetTimerRef.current = setTimeout(() => {
        greetTimerRef.current = null;
        startSpeaking(text);
      }, 3000);
    }
  }

  const [paused, setPaused] = useState(false);

  async function startSpeaking(text: string) {
    setMuted(false);
    setPaused(false);
    setSpeaking(true);
    try {
      await speakLong(text, lang);
    } catch (e: any) {
      console.error('TTS error:', e);
      appendMsgPersist({ who: 'ai', text: `🔊 Speaker error: ${e?.message || e}` });
    } finally {
      setSpeaking(false);
      setPaused(false);
    }
  }

  function stopSpeaking() {
    setMuted(true);
    stopAudio();
    setSpeaking(false);
    setPaused(false);
  }

  function pauseSpeaking() { pauseAudio(); setPaused(true); }
  function resumeSpeaking() { resumeAudio(); setPaused(false); }

  function appendMsg(m: Msg) {
    setMsgs((prev) => {
      const next = [...prev, m];
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      return next;
    });
  }

  async function safeTranslate(text: string, src: LangCode, tgt: LangCode): Promise<string> {
    if (src === tgt) return text;
    try { return await aiTranslate(text, src, tgt); } catch { return text; }
  }

  async function handleAsk(rawText: string) {
    const value = rawText.trim();
    if (!value) return;
    appendMsgPersist({ who: 'me', text: value });
    setInput('');
    setBusy(true);
    try {
      const targetLangName = LANG_NAME[lang] || 'English';

      // 1. Get the user's question into English for the LLM (most reliable).
      let userEn = value;
      try {
        const inputLang = await aiDetectLang(value);
        if (inputLang !== 'en-IN') userEn = await safeTranslate(value, inputLang, 'en-IN');
      } catch {}

      // 2. Ask the LLM in English (clearer reasoning), get a concise English answer.
      const system =
        `You are WorkMithra's helpful assistant. Answer the user's question concisely in 2-4 short, simple sentences. ` +
        `Screen context (use only if relevant): "${ctx.name}" — ${ctx.purpose}. ` +
        `Reply in plain English. Do not add any preface or notes. Just the answer.`;
      const replyEn = await aiChat(userEn, system);

      // 3. Translate the answer to the SELECTED language. ALWAYS. No detection skip.
      let replyLocal = replyEn;
      if (lang !== 'en-IN') {
        try {
          replyLocal = await aiTranslate(replyEn, 'en-IN', lang);
        } catch {
          replyLocal = replyEn;  // last resort
        }
      }

      // 4. Strip any leftover ASCII English clutter (common when models leak prefixes like "Answer:")
      replyLocal = sanitizeForLang(replyLocal, lang);

      appendMsgPersist({ who: 'ai', text: replyLocal });
      if (Platform.OS === 'web') startSpeaking(replyLocal);
    } catch (e: any) {
      const errMsg = e?.message || String(e) || 'unknown error';
      appendMsgPersist({ who: 'ai', text: `⚠️ AI error: ${errMsg}` });
      console.error('AI assistant error:', e);
    } finally {
      setBusy(false);
    }
  }

  /** Removes leftover English fragments when a non-English language is selected. */
  function sanitizeForLang(text: string, l: LangCode): string {
    if (l === 'en-IN') return text;
    // Map of language → unicode block regex (any script char of that language)
    const scriptRe: Record<string, RegExp> = {
      'hi-IN': /[ऀ-ॿ]/,
      'te-IN': /[ఀ-౿]/,
      'ta-IN': /[஀-௿]/,
      'kn-IN': /[ಀ-೿]/,
      'ml-IN': /[ഀ-ൿ]/,
      'mr-IN': /[ऀ-ॿ]/,
      'gu-IN': /[઀-૿]/,
      'bn-IN': /[ঀ-৿]/,
      'pa-IN': /[਀-੿]/,
      'or-IN': /[଀-୿]/,
      'as-IN': /[ঀ-৿]/,
      'ur-IN': /[؀-ۿ]/,
    };
    const re = scriptRe[l];
    if (!re || !re.test(text)) return text;  // nothing in target script — keep as is
    // Split into sentence-ish parts and keep only those that contain target-script characters.
    const parts = text.split(/(?<=[.!?।॥])\s+/);
    const kept = parts.filter((p) => re.test(p));
    const result = (kept.length ? kept.join(' ') : text).trim();
    return result;
  }

  async function onMic() {
    if (Platform.OS !== 'web') {
      appendMsgPersist({ who: 'ai', text: 'Voice input works in the browser for now.' });
      return;
    }
    // Cut off whatever the assistant is saying so it can listen.
    if (greetTimerRef.current) { clearTimeout(greetTimerRef.current); greetTimerRef.current = null; }
    stopAudio();      // stop audio without flipping mute on
    setSpeaking(false);
    setPaused(false);
    setMuted(false);  // ensure mute is OFF before mic/answer

    try {
      setListening(true);
      const text = await webSTT(lang);
      setListening(false);
      if (text && text.trim()) {
        if (onboardActive) submitOnboard(text);
        else handleAsk(text);
      } else {
        appendMsgPersist({ who: 'ai', text: '🎤 I did not catch that. Please try again.' });
      }
    } catch (e: any) {
      setListening(false);
      console.error('STT error:', e);
      appendMsgPersist({ who: 'ai', text: `🎤 Mic error: ${e?.message || e}. Allow microphone access in your browser.` });
    }
  }

  async function onSpeakLast() {
    setMuted(false);
    const last = [...msgs].reverse().find((m) => m.who === 'ai');
    if (!last) {
      appendMsgPersist({ who: 'ai', text: '🔊 Nothing to speak yet.' });
      return;
    }
    startSpeaking(last.text);
  }

  // ---- Onboarding flow (kept simple) ----
  function startOnboarding() {
    if (!ctx.onboardSteps) return;
    const initial = ctx.onboardSteps;
    setSteps(initial);
    setStepIdx(0);
    setCollected({});
    setOnboardActive(true);
    askOnboardStep(initial[0]);
  }

  async function askOnboardStep(step: Step) {
    const text = lang === 'en-IN' ? step.q : await safeTranslate(step.q, 'en-IN', lang);
    appendMsgPersist({ who: 'ai', text });
    if (Platform.OS === 'web') speakTTS(text, lang).catch(() => {});
  }

  async function submitOnboard(text: string) {
    const value = text.trim();
    if (!value) return;
    appendMsgPersist({ who: 'me', text: value });
    setInput('');
    setBusy(true);
    try {
      const step = steps[stepIdx];
      const parsed = await parseAnswer(step, value);
      const updated = { ...collected, ...parsed };
      setCollected(updated);

      let nextSteps = steps;
      if (step.id === 'role') {
        const role = (parsed.role || '').toLowerCase();
        if (role === 'worker' || role === 'both') nextSteps = [...steps, ...WORKER_STEPS];
        setSteps(nextSteps);
      }

      const nextIdx = stepIdx + 1;
      if (nextIdx < nextSteps.length) {
        setStepIdx(nextIdx);
        await askOnboardStep(nextSteps[nextIdx]);
      } else {
        await finishOnboard(updated);
      }
    } finally {
      setBusy(false);
    }
  }

  async function parseAnswer(step: Step, text: string): Promise<Record<string, any>> {
    if (step.id === 'name') return { full_name: text };
    if (step.id === 'phone') return { phone: text.replace(/[^\d+]/g, '') };
    if (step.id === 'role') {
      const t = text.toLowerCase();
      if (t.includes('both')) return { role: 'both' };
      if (t.includes('work') || t.includes('worker')) return { role: 'worker' };
      return { role: 'user' };
    }
    if (step.id === 'experience') {
      const n = parseInt(text.replace(/[^\d]/g, ''), 10);
      return { experience_years: isNaN(n) ? text : n };
    }
    if (step.id === 'wage') {
      try { return await aiExtract(text, '{ "hourly_rate": number }'); }
      catch { const n = parseFloat(text.replace(/[^\d.]/g, '')); return { hourly_rate: isNaN(n) ? text : n }; }
    }
    if (step.id === 'skill') {
      try { return await aiExtract(text, '{ "skill": string }'); }
      catch { return { skill: text }; }
    }
    if (step.id === 'location') return { location: text };
    if (step.id === 'timings') return { timings: text };
    return { [step.key]: text };
  }

  async function finishOnboard(data: Record<string, any>) {
    appendMsgPersist({ who: 'ai', text: 'Saving your details…' });
    try {
      await storage.set('workmithra:profile', JSON.stringify({
        full_name: data.full_name || '',
        phone: data.phone || '',
        alternate_phone: '',
        location: data.location || '',
        pincode: '',
      }));
      if (data.role === 'worker' || data.role === 'both') {
        await storage.set('workmithra:worker_profile', JSON.stringify({
          full_name: data.full_name || '',
          phone: data.phone || '',
          skill: data.skill || '',
          hourly_rate: data.hourly_rate ?? '',
          experience_years: data.experience_years ?? '',
          location: data.location || '',
          timings: data.timings || '',
        }));
      }
      appendMsgPersist({ who: 'ai', text: '✓ Done! Your profile is saved.' });
    } catch {
      appendMsgPersist({ who: 'ai', text: 'Saved locally on this device.' });
    } finally {
      setOnboardActive(false);
    }
  }

  function handleSend() {
    if (onboardActive) submitOnboard(input);
    else handleAsk(input);
  }

  return (
    <View style={styles.container}>
      {!hideFab && (
        <Animated.View
          style={[styles.fabDraggable, { transform: fabPos.getTranslateTransform() }]}
          {...fabPan.panHandlers}
        >
          <TouchableOpacity
            style={styles.fabInner}
            activeOpacity={0.8}
            onPress={openModal}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="sparkles" size={22} color="white" />
          </TouchableOpacity>
        </Animated.View>
      )}

      <Modal animationType="slide" transparent visible={visible} onRequestClose={closeModal}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>WorkMithra Assistant</Text>
                <Text style={styles.screenTag}>📍 {ctx.name}</Text>
              </View>
              <TouchableOpacity onPress={onSpeakLast} style={{ marginRight: 8 }}>
                {speaking ? <ActivityIndicator color="#6f42c1" /> : <Ionicons name="volume-high" size={22} color="#6f42c1" />}
              </TouchableOpacity>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close-circle" size={26} color="#6f42c1" />
              </TouchableOpacity>
            </View>

            <View style={styles.langRow}>
              {ALL_LANGS.filter((l) => pinned.includes(l.code)).map((l) => (
                <TouchableOpacity key={l.code} style={[styles.langChip, lang === l.code && styles.langChipActive]} onPress={() => setLang(l.code)}>
                  <Text style={[styles.langText, lang === l.code && styles.langTextActive]}>{l.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.langChip, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#6F42C1' }]} onPress={() => setShowLangSearch((v) => !v)}>
                <Ionicons name={showLangSearch ? 'close' : 'add'} size={11} color="#6F42C1" />
                <Text style={[styles.langText, { color: '#6F42C1' }]}> More</Text>
              </TouchableOpacity>
            </View>

            {showLangSearch && (
              <View style={styles.langSearchBox}>
                <View style={styles.langSearchInputWrap}>
                  <Ionicons name="search" size={14} color="#999" />
                  <TextInput
                    style={styles.langSearchInput}
                    placeholder="Search language (e.g. Bengali, Marathi)"
                    placeholderTextColor="#999"
                    value={langQuery}
                    onChangeText={setLangQuery}
                  />
                </View>
                <View style={styles.langGrid}>
                  {filteredLangs.map((l) => {
                    const isPinned = pinned.includes(l.code);
                    const isActive = lang === l.code;
                    return (
                      <View key={l.code} style={styles.langGridItem}>
                        <TouchableOpacity
                          style={[styles.langChip, isActive && styles.langChipActive]}
                          onPress={() => setLang(l.code)}
                        >
                          <Text style={[styles.langText, isActive && styles.langTextActive]}>
                            {l.label} <Text style={{ opacity: 0.6, fontSize: 10 }}>({l.english})</Text>
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => togglePin(l.code)} style={styles.pinBtn}>
                          <Ionicons name={isPinned ? 'pin' : 'pin-outline'} size={14} color={isPinned ? '#10b981' : '#999'} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  {filteredLangs.length === 0 && <Text style={styles.langEmpty}>No language matches "{langQuery}"</Text>}
                </View>
              </View>
            )}

            <FlatList
              ref={listRef}
              data={msgs}
              keyExtractor={(_, i) => String(i)}
              style={styles.chat}
              contentContainerStyle={{ padding: 10 }}
              renderItem={({ item }) => (
                <View style={[styles.bubble, item.who === 'ai' ? styles.aiBubble : styles.meBubble]}>
                  <Text style={[styles.bubbleText, item.who === 'me' && { color: '#fff' }]}>{item.text}</Text>
                </View>
              )}
            />

            {busy && <ActivityIndicator color="#6F42C1" style={{ marginVertical: 4 }} />}

            {speaking && (
              <View style={styles.controlsRow}>
                {paused ? (
                  <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: '#10b981' }]} onPress={resumeSpeaking} activeOpacity={0.8}>
                    <Ionicons name="play" size={16} color="#fff" />
                    <Text style={styles.ctrlText}>Resume</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: '#f59e0b' }]} onPress={pauseSpeaking} activeOpacity={0.8}>
                    <Ionicons name="pause" size={16} color="#fff" />
                    <Text style={styles.ctrlText}>Pause</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: '#FF6B6B' }]} onPress={stopSpeaking} activeOpacity={0.8}>
                  <Ionicons name="stop" size={16} color="#fff" />
                  <Text style={styles.ctrlText}>Stop</Text>
                </TouchableOpacity>
              </View>
            )}

            {!onboardActive && (
              <View style={styles.suggestRow}>
                {ctx.onboardSteps && (
                  <TouchableOpacity style={[styles.suggestChip, { backgroundColor: '#10b981' }]} onPress={startOnboarding}>
                    <Ionicons name="play" size={11} color="#fff" />
                    <Text style={[styles.suggestText, { color: '#fff' }]}> {guideMeLabel}</Text>
                  </TouchableOpacity>
                )}
                {translatedSuggestions.map((s, i) => (
                  <TouchableOpacity key={i} style={styles.suggestChip} onPress={() => handleAsk(s)}>
                    <Text style={styles.suggestText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.inputRow}>
              <TouchableOpacity style={[styles.micBtn, listening && { backgroundColor: '#FF6B6B' }]} onPress={onMic}>
                <Ionicons name={listening ? 'mic' : 'mic-outline'} size={18} color="#fff" />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder={onboardActive ? 'Type your answer...' : 'Ask anything about this page...'}
                placeholderTextColor="#999"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // pointerEvents in style (not prop) is the new API for react-native-web
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, pointerEvents: 'box-none' as any },
  fab: {
    backgroundColor: '#6f42c1', width: 46, height: 46, borderRadius: 23,
    justifyContent: 'center', alignItems: 'center',
    ...platformShadow('0px 2px 8px rgba(0,0,0,0.25)', '#000', 0, 2, 0.25, 3.84, 5),
  },
  fabDraggable: { position: 'absolute', top: 0, left: 0, zIndex: 1000 },
  fabInner: {
    backgroundColor: '#6f42c1', width: 52, height: 52, borderRadius: 26,
    justifyContent: 'center', alignItems: 'center',
    ...platformShadow('0px 4px 12px rgba(111,66,193,0.35)', '#6f42c1', 0, 4, 0.35, 6, 6),
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 360, alignSelf: 'center', height: '85%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '800', color: '#6f42c1' },
  screenTag: { fontSize: 10, color: '#666', marginTop: 1 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  langChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#f0f0f0' },
  langChipActive: { backgroundColor: '#6F42C1' },
  langText: { fontSize: 11, fontWeight: '600', color: '#333' },
  langTextActive: { color: '#fff' },
  chat: { flex: 1, backgroundColor: '#fafafa', borderRadius: 10 },
  bubble: { maxWidth: '85%', borderRadius: 12, padding: 10, marginVertical: 4 },
  aiBubble: { backgroundColor: '#f0e6ff', alignSelf: 'flex-start' },
  meBubble: { backgroundColor: '#6F42C1', alignSelf: 'flex-end' },
  bubbleText: { fontSize: 13, color: '#333', lineHeight: 18 },
  langSearchBox: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 8, marginBottom: 8 },
  langSearchInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  langSearchInput: { flex: 1, fontSize: 12, color: '#333', paddingVertical: 4 },
  langGrid: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  langGridItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingRight: 4 },
  pinBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  langEmpty: { fontSize: 11, color: '#999', padding: 8 },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  ctrlBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  ctrlText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  suggestChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f0e6ff', borderWidth: 1, borderColor: '#e0d0f5' },
  suggestText: { fontSize: 11, color: '#6F42C1', fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  micBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#6F42C1', justifyContent: 'center', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 19, paddingHorizontal: 14, paddingVertical: 9, fontSize: 13, color: '#333' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
});