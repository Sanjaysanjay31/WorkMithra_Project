import { aiChat, aiExtract, aiTranslate, cleanTextForSpeech, LangCode, pauseAudio, resumeAudio, setMuted, speakLong, stopAudio, webSTT } from '@/lib/ai';
import { authFetch, getAuth } from '@/lib/api';
import { appendHistory, clearHistory, loadHistory } from '@/lib/assistant-history';
import { assistantBus } from '@/lib/assistant-bus';
import { getScreenContext, Step, WORKER_STEPS } from '@/lib/assistant-context';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    FlatList,
    KeyboardAvoidingView,
    PanResponder,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import FrameModal from './frame-modal';
import LanguagePicker from './language-picker';

type Msg = { who: 'ai' | 'me'; text: string };

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

export function AIAssistant() {
  const pathname = usePathname() || '';
  const ctx = useMemo(() => getScreenContext(pathname), [pathname]);

  const [visible, setVisible] = useState(false);
  const [lang, setLang] = useState<LangCode>('en-IN');

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
  // Ref-based mic guard: the `listening` state is stale inside the async
  // handler, so a ref is needed to actually block a double-tap.
  const listeningRef = useRef(false);

  // Translated suggestion labels for the current language
  const [translatedSuggestions, setTranslatedSuggestions] = useState<string[]>(ctx.suggestions);
  const [guideMeLabel, setGuideMeLabel] = useState<string>('Guide me');

  // Restore conversation — server-backed when logged in, local cache otherwise.
  useEffect(() => {
    (async () => {
      const arr = await loadHistory();
      if (arr.length) setMsgs(arr);
    })();
  }, []);

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

  function stopMedia() {
    if (greetTimerRef.current) {
      clearTimeout(greetTimerRef.current);
      greetTimerRef.current = null;
    }
    setMuted(true);   // suppress any in-flight TTS playback
    stopAudio();
    setListening(false);
    setSpeaking(false);
    setPaused(false);
  }

  // Hide the assistant WITHOUT erasing the conversation — used for the Android
  // back button / backdrop dismiss. Reopening resumes where the user left off.
  function dismissModal() {
    stopMedia();
    setVisible(false);
  }

  // Explicit quit (red cross): hide AND erase the conversation.
  function quitModal() {
    stopMedia();
    setVisible(false);
    setMsgs([]);
    setCollected({});
    setOnboardActive(false);
    setStepIdx(0);
    clearHistory().catch(() => {});
  }

  function openModal() {
    setMuted(false);
    setVisible(true);
  }

  // Allow any screen to programmatically open the assistant via the event bus.
  useEffect(() => {
    const off = assistantBus.subscribe(() => openModal());
    return () => { off(); };
  }, []);

  // FAB is always visible — it's draggable so users can move it out of the way
  // if it ever covers a button on a particular screen.
  const hideFab = false;

  // --- Draggable FAB ---
  const FAB_SIZE = 52;
  // Best guess until the container measures itself via onLayout. On web,
  // Dimensions reports the whole browser window, so cap it to the phone frame.
  const frameSizeRef = useRef({
    w: Math.min(Dimensions.get('window').width, 390),
    h: Math.min(Dimensions.get('window').height, 803),
  });
  const fabPos = useRef(
    new Animated.ValueXY({
      x: frameSizeRef.current.w - FAB_SIZE - 14,
      y: frameSizeRef.current.h - FAB_SIZE - 86,
    }),
  ).current;
  const movedRef = useRef(false);

  // Keep the FAB inside the actual frame — the measured size is the source of
  // truth on every platform (phones of any size, web frame, rotation). Also
  // re-clamps positions restored from storage that no longer fit.
  const onContainerLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    if (!width || !height) return;
    frameSizeRef.current = { w: width, h: height };
    const x = Math.max(0, Math.min((fabPos.x as any)._value, width - FAB_SIZE));
    const y = Math.max(0, Math.min((fabPos.y as any)._value, height - FAB_SIZE));
    fabPos.setValue({ x, y });
  };

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
        x = Math.max(0, Math.min(x, frameSizeRef.current.w - FAB_SIZE));
        y = Math.max(0, Math.min(y, frameSizeRef.current.h - FAB_SIZE));
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
          if (typeof p?.x === 'number' && typeof p?.y === 'number') {
            // Clamp to the current frame — a position saved on a bigger screen
            // would park the FAB off-screen here.
            const x = Math.max(0, Math.min(p.x, frameSizeRef.current.w - FAB_SIZE));
            const y = Math.max(0, Math.min(p.y, frameSizeRef.current.h - FAB_SIZE));
            fabPos.setValue({ x, y });
          }
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function greet() {
    setOnboardActive(false);
    let text = `Hello! I am your WorkMithra assistant on ${ctx.name}. How can I help you?`;
    if (lang === 'te-IN') {
      text = `నమస్కారం! నేను మీ వర్క్‌మిత్ర సహాయకుడిని. మీకు ఎలా సహాయపడగలను?`;
    } else if (lang !== 'en-IN') {
      text = await safeTranslate(text, 'en-IN', lang);
    }
    text = cleanTextForSpeech(text);
    appendMsgPersist({ who: 'ai', text });
    if (greetTimerRef.current) { clearTimeout(greetTimerRef.current); greetTimerRef.current = null; }
    if (Platform.OS === 'web') {
      greetTimerRef.current = setTimeout(() => {
        greetTimerRef.current = null;
        startSpeaking(text);
      }, 1500);
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
    // Keep the state updater pure (it can run twice under StrictMode) — the
    // scroll side effect lives outside it.
    setMsgs((prev) => [...prev, m]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    // Persist per-message (local mirror + server sync when logged in).
    appendHistory(m).catch(() => {});
  }

  async function safeTranslate(text: string, src: LangCode, tgt: LangCode): Promise<string> {
    if (src === tgt) return text;
    try { return await aiTranslate(text, src, tgt); } catch { return text; }
  }

  async function handleAsk(rawText: string) {
    const value = rawText.trim();
    if (!value) return;
    // One in-flight request at a time. Suggestion chips call this directly,
    // so without this guard a few quick taps would fire parallel paid LLM
    // calls and interleave their replies out of order.
    if (busy) return;
    appendMsgPersist({ who: 'me', text: value });
    setInput('');
    setBusy(true);
    try {
      const targetLangName = LANG_NAME[lang] || 'English';

      const system =
        `You are WorkMithra's friendly voice assistant. Answer the user's question directly in 1 short, simple sentence (maximum 20 words). ` +
        `Screen context: "${ctx.name}". ` +
        `CRITICAL RULES FOR VOICE: ` +
        `1. DO NOT use any markdown (NO asterisks **, NO bold, NO italics, NO bullet points, NO numbered lists). ` +
        `2. DO NOT include meta prefixes like 'Sentence 1:', 'Note:', or 'Answer:'. ` +
        `3. DO NOT repeat the user's question or restate their words. Give the answer directly. ` +
        `4. Speak directly and naturally in ${targetLangName} only.`;

      let reply = await aiChat(value, system);

      // If a non-English language was selected and LLM returned English, translate once.
      if (lang !== 'en-IN') {
        const re = SCRIPT_RE[lang];
        if (re && !re.test(reply)) {
          try {
            reply = await safeTranslate(reply, 'en-IN', lang);
          } catch {}
        }
        reply = sanitizeForLang(reply, lang);
      }

      reply = cleanTextForSpeech(reply);

      appendMsgPersist({ who: 'ai', text: reply });
      if (Platform.OS === 'web') startSpeaking(reply);
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
    if (listeningRef.current) return; // already recording — ignore double-taps
    // Cut off whatever the assistant is saying so it can listen.
    if (greetTimerRef.current) { clearTimeout(greetTimerRef.current); greetTimerRef.current = null; }
    stopAudio();      // stop audio without flipping mute on
    setSpeaking(false);
    setPaused(false);
    setMuted(false);  // ensure mute is OFF before mic/answer

    listeningRef.current = true;
    setListening(true);
    try {
      const text = await webSTT(lang);
      if (text && text.trim()) {
        if (onboardActive) submitOnboard(text);
        else handleAsk(text);
      } else {
        appendMsgPersist({ who: 'ai', text: '🎤 I did not catch that. Please try again.' });
      }
    } catch (e: any) {
      console.error('STT error:', e);
      appendMsgPersist({ who: 'ai', text: `🎤 Mic error: ${e?.message || e}` });
    } finally {
      listeningRef.current = false;
      setListening(false);
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
    if (Platform.OS === 'web') speakLong(cleanTextForSpeech(text), lang).catch(() => {});
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
    return { timings: text };
  }

  async function finishOnboard(data: Record<string, any>) {
    appendMsgPersist({ who: 'ai', text: 'Saving your details…' });

    // Always keep a local mirror so the profile form prefills even offline.
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
    } catch {}

    // If a session exists, also persist to the backend so the details survive
    // reinstalls/device changes — not just this browser's storage.
    let synced = false;
    try {
      const auth = await getAuth();
      if (auth?.token && auth.id) {
        const isWorker = auth.role === 'worker';
        if (isWorker) {
          const res = await authFetch(`/workers/${auth.id}`, {
            method: 'PUT',
            json: {
              full_name: data.full_name || undefined,
              phone: data.phone || undefined,
              skill: data.skill || undefined,
              hourly_rate: typeof data.hourly_rate === 'number' ? data.hourly_rate : undefined,
              experience_years: typeof data.experience_years === 'number' ? data.experience_years : undefined,
              location: data.location || undefined,
            },
          });
          synced = res.ok;
        } else {
          const res = await authFetch('/profiles/me', {
            method: 'PUT',
            json: {
              full_name: data.full_name || undefined,
              phone: data.phone || undefined,
              address: data.location || undefined,
            },
          });
          synced = res.ok;
        }
      }
    } catch (e) {
      console.warn('Onboarding: backend sync failed (kept locally)', e);
    }

    appendMsgPersist({
      who: 'ai',
      text: synced
        ? '✓ Done! Your profile is saved.'
        : '✓ Saved on this device. Log in to sync it across devices.',
    });
    setOnboardActive(false);
  }

  function handleSend() {
    if (onboardActive) submitOnboard(input);
    else handleAsk(input);
  }

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {!hideFab && (
        <Animated.View
          style={[styles.fabDraggable, { transform: fabPos.getTranslateTransform() }]}
          {...fabPan.panHandlers}
        >
          <TouchableOpacity
            style={styles.fabInner}
            activeOpacity={0.8}
            onPress={openModal}
            accessibilityLabel="Open AI assistant"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="sparkles" size={22} color="white" />
          </TouchableOpacity>
        </Animated.View>
      )}

      <FrameModal animationType="slide" visible={visible} onRequestClose={dismissModal}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior="padding" style={styles.kav}>
            <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>WorkMithra Assistant</Text>
                <Text style={styles.screenTag}>📍 {ctx.name}</Text>
              </View>
              <TouchableOpacity onPress={onSpeakLast} style={{ marginRight: 8 }}>
                {speaking ? <ActivityIndicator color="#6f42c1" /> : <Ionicons name="volume-high" size={22} color="#6f42c1" />}
              </TouchableOpacity>
              <TouchableOpacity onPress={quitModal}>
                <Ionicons name="close-circle" size={26} color="#6f42c1" />
              </TouchableOpacity>
            </View>

            <LanguagePicker lang={lang} onSelect={setLang} />

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
          </KeyboardAvoidingView>
        </View>
      </FrameModal>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', height: '85%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '800', color: '#6f42c1' },
  screenTag: { fontSize: 10, color: '#666', marginTop: 1 },
  chat: { flex: 1, backgroundColor: '#fafafa', borderRadius: 10 },
  bubble: { maxWidth: '85%', borderRadius: 12, padding: 10, marginVertical: 4 },
  aiBubble: { backgroundColor: '#f0e6ff', alignSelf: 'flex-start' },
  meBubble: { backgroundColor: '#6F42C1', alignSelf: 'flex-end' },
  bubbleText: { fontSize: 13, color: '#333', lineHeight: 18 },
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