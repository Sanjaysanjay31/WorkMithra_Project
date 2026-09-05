import {
  aiDetectLang,
  aiTranslate,
  getOtherLanguage,
  LangCode,
  LANGS,
  saveMyLanguage,
  speak as speakTTS,
  webSTT,
} from '@/lib/ai';
import { authFetch, expectJson, getAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { platformShadow } from '@/lib/shadow';
import { ensureSocket, onMessageReceived } from '@/lib/socket';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Side = 'client' | 'worker';

interface Bubble {
  id: string;
  side: Side;
  original: string;
  srcLang: LangCode;
  translations: Partial<Record<LangCode, string>>;
  failed?: boolean;
}

interface ServerChatMessage {
  id: string | number;
  sender_id: string | number;
  /** Role of the sender ('user' | 'worker'). The backend includes it because
   * users and workers live in overlapping id spaces — sender_id alone cannot
   * identify who sent a message whenever the two ids happen to match. */
  sender_role?: 'user' | 'worker';
  message: string;
}

const createSystemBubble = (myRole: 'user' | 'worker' = 'user'): Bubble => ({
  id: 'sys',
  // Render on the far side (left) regardless of who is viewing. The text is
  // an explicit app notice — never phrased as the counterpart speaking,
  // which would be a fabricated message in a real conversation.
  side: myRole === 'worker' ? 'client' : 'worker',
  original: 'Auto-translation is on — messages are translated for each of you as needed.',
  srcLang: 'en-IN',
  translations: {},
});

const mapServerMessageToBubble = (
  message: ServerChatMessage,
  currentUserId: string,
  myRole: 'user' | 'worker' = 'user',
): Bubble => {
  const mySide: Side = myRole === 'worker' ? 'worker' : 'client';
  // Attribute the message to a SIDE via sender_role. Users and workers have
  // overlapping ids, so keying off sender_id alone misattributes every message
  // whenever the client's and worker's ids are equal (e.g. user #5 ↔ worker #5).
  // Fall back to the id comparison only when the role is absent.
  let side: Side;
  if (message.sender_role === 'worker' || message.sender_role === 'user') {
    side = message.sender_role === 'worker' ? 'worker' : 'client';
  } else {
    const mine = String(message.sender_id) === currentUserId;
    side = mine ? mySide : mySide === 'client' ? 'worker' : 'client';
  }
  return {
    id: String(message.id),
    side,
    original: message.message ?? '',
    // Unknown until detection runs — 'en-IN' is the safe no-translate default.
    srcLang: 'en-IN',
    translations: {},
  };
};

export default function ChatScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { workerId, workerName } = useLocalSearchParams<{ workerId?: string; workerName?: string }>();

  const [clientLang, setClientLang] = useState<LangCode>('en-IN');
  // Neutral default until the counterpart's profile tells us their language —
  // never assume a specific language (the old 'te-IN' guess was just wrong
  // for most conversations).
  const [workerLang, setWorkerLang] = useState<LangCode>('en-IN');
  const [input, setInput] = useState<string>('');
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [listening, setListening] = useState<boolean>(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [myRole, setMyRole] = useState<'user' | 'worker'>('user');

  // Which bubble side "I" am — derived from the session role, never hardcoded.
  const me: Side = myRole === 'worker' ? 'worker' : 'client';
  const otherSide: Side = me === 'client' ? 'worker' : 'client';

  const listRef = useRef<FlatList<Bubble> | null>(null);
  // Ref-based send guard: `busy` state alone can't block a double-tap because
  // the second press reads the stale value before the re-render lands.
  const sendingRef = useRef(false);
  const tempIdSeq = useRef(0);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  // Detect a bubble's language in the background and patch it in. Failures are
  // silent — the bubble keeps the safe 'en-IN' default.
  const detectBubbleLang = useCallback((bubbleId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void aiDetectLang(trimmed)
      .then((lang) => {
        setMsgs((prev) =>
          prev.map((item) => (item.id === bubbleId && item.srcLang !== lang ? { ...item, srcLang: lang } : item)),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Keep the latest message visible when the keyboard opens. The layout
    // itself is handled by KeyboardAvoidingView — manual height tracking here
    // used to double-shift the composer on Android.
    const keyboardShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => scrollToBottom(),
    );
    return () => {
      keyboardShow.remove();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConversation() {
      let uid = '';
      let role: 'user' | 'worker' = 'user';
      try {
        const auth = await getAuth();
        if (auth?.id) uid = String(auth.id);
        if (auth?.role === 'worker') role = 'worker';
      } catch (error) {
        console.warn('Failed to parse auth data', error);
      }

      setCurrentUserId(uid);
      setMyRole(role);
      const sysMsg = createSystemBubble(role);

      if (!uid || !workerId) {
        setMsgs([sysMsg]);
        return;
      }

      // The other participant's language comes from their profile, so the
      // picker shows what they actually speak instead of a guess. Until it
      // arrives the picker keeps the default — translation just targets
      // whatever is selected, which is still better than guessing.
      const otherRole: 'user' | 'worker' = role === 'worker' ? 'user' : 'worker';
      getOtherLanguage(workerId, otherRole, 'en-IN')
        .then((lang) => { if (role === 'worker') setClientLang(lang); else setWorkerLang(lang); });

      // My own saved language comes from my profile too, so a returning user
      // keeps their pick instead of resetting to the default each session.
      getOtherLanguage(uid, role, 'en-IN')
        .then((lang) => { if (role === 'worker') setWorkerLang(lang); else setClientLang(lang); });

      try {
        const history = await expectJson<ServerChatMessage[]>(
          await authFetch(`/chat/conversation/${uid}/${workerId}`, {
            signal: controller.signal,
          }),
          'Could not load chat history',
        );

        if (!Array.isArray(history)) {
          setMsgs([sysMsg]);
          return;
        }

        const loadedMsgs = history.map((message: ServerChatMessage) => mapServerMessageToBubble(message, uid, role));
        setMsgs([sysMsg, ...loadedMsgs]);
        scrollToBottom();
        // Detect each message's real language in the background so
        // translations target the right source (history is not all English).
        loadedMsgs.forEach((bubble) => detectBubbleLang(bubble.id, bubble.original));
      } catch (error: any) {
        if (controller.signal.aborted) return;
        console.warn('Failed to load chat history', error);
        setMsgs([sysMsg]);
      }
    }

    void loadConversation();
    return () => controller.abort();
  }, [workerId, workerName, scrollToBottom, detectBubbleLang]);

  // Realtime: new messages arrive over Socket.IO; a slow 30s reconcile fetch
  // covers anything missed while the socket was disconnected.
  useEffect(() => {
    if (!currentUserId || !workerId) return;

    let cancelled = false;
    let offMessage: (() => void) | null = null;

    // ensureSocket() is async — the listener must be registered only after the
    // socket exists, otherwise onMessageReceived no-ops and realtime is lost.
    void (async () => {
      await ensureSocket();
      if (cancelled) return;
      offMessage = onMessageReceived((data) => {
        // Only messages from the other participant; my own come back via the
        // REST response. Match on sender_role rather than sender_id — users and
        // workers have overlapping ids, so an id comparison misattributes (and
        // can duplicate my own echo) whenever the two ids are equal.
        const fromOther = data?.sender_role
          ? data.sender_role !== myRole
          : String(data.sender_id) === String(workerId);
        if (!fromOther) return;
        const bubbleId = String(data.id);
        const text = data.message ?? '';
        setMsgs((prev) => {
          if (prev.some((bubble) => bubble.id === bubbleId)) return prev;
          scrollToBottom();
          return [
            ...prev,
            {
              id: bubbleId,
              side: otherSide,
              original: text,
              srcLang: 'en-IN' as LangCode,
              translations: {},
            },
          ];
        });
        detectBubbleLang(bubbleId, text);
      });
    })();

    const controller = new AbortController();
    async function reconcile() {
      try {
        const history = await expectJson<ServerChatMessage[]>(
          await authFetch(`/chat/conversation/${currentUserId}/${workerId}`, {
            signal: controller.signal,
          }),
          'Could not refresh chat',
        );
        if (!Array.isArray(history)) return;

        setMsgs((prev) => {
          const existingIds = new Set(prev.map((bubble) => bubble.id));
          const newMessages = history
            .filter((message: ServerChatMessage) => !existingIds.has(String(message.id)))
            .map((message: ServerChatMessage) => mapServerMessageToBubble(message, currentUserId, myRole));

          if (newMessages.length === 0) return prev;
          scrollToBottom();
          newMessages.forEach((bubble) => detectBubbleLang(bubble.id, bubble.original));
          return [...prev, ...newMessages];
        });
      } catch (error: any) {
        if (controller.signal.aborted) return;
        console.warn('Chat reconcile failed', error);
      }
    }

    const intervalId = setInterval(reconcile, 30000);
    return () => {
      cancelled = true;
      offMessage?.();
      controller.abort();
      clearInterval(intervalId);
    };
  }, [currentUserId, workerId, scrollToBottom, myRole, otherSide, detectBubbleLang]);

  const langForSide = useCallback((side: Side): LangCode => (side === 'client' ? clientLang : workerLang), [clientLang, workerLang]);

  const viewText = useCallback(
    (bubble: Bubble, viewer: Side): { text: string; lang: LangCode } => {
      const viewerLang = langForSide(viewer);
      if (bubble.srcLang === viewerLang) return { text: bubble.original, lang: bubble.srcLang };
      const translated = bubble.translations[viewerLang];
      return { text: translated ?? bubble.original, lang: translated ? viewerLang : bubble.srcLang };
    },
    [langForSide],
  );

  const ensureTranslation = useCallback(
    async (bubble: Bubble, target: LangCode): Promise<string> => {
      if (bubble.srcLang === target) return bubble.original;
      const cached = bubble.translations[target];
      if (cached) return cached;

      const translation = await aiTranslate(bubble.original, bubble.srcLang, target);
      setMsgs((prev) =>
        prev.map((item) =>
          item.id === bubble.id
            ? { ...item, translations: { ...item.translations, [target]: translation } }
            : item,
        ),
      );
      return translation;
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Block double-taps / rapid Enter presses: the busy state alone is stale
      // inside this closure, so a ref carries the real in-flight flag.
      if (sendingRef.current) return;
      sendingRef.current = true;

      setInput('');
      setBusy(true);

      const targetLang = me === 'client' ? workerLang : clientLang;
      let srcLang: LangCode = 'en-IN';

      try {
        srcLang = await aiDetectLang(trimmed);
      } catch (error) {
        console.warn('Language detection failed', error);
      }

      tempIdSeq.current += 1;
      const tempId = `tmp-${Date.now()}-${tempIdSeq.current}`;
      const bubble: Bubble = { id: tempId, side: me, original: trimmed, srcLang, translations: {} };

      if (srcLang !== targetLang) {
        try {
          bubble.translations[targetLang] = await aiTranslate(trimmed, srcLang, targetLang);
        } catch (error) {
          console.warn('Translation failed', error);
        }
      }

      setMsgs((prev) => {
        const next = [...prev, bubble];
        scrollToBottom();
        return next;
      });

      if (currentUserId && workerId) {
        try {
          const saved = await expectJson<{ id?: number }>(
            await authFetch('/chat/', {
              method: 'POST',
              json: { receiver_id: Number(workerId), message: trimmed },
            }),
            'Message could not be sent',
          );
          if (saved?.id) {
            setMsgs((prev) => prev.map((item) => (item.id === tempId ? { ...item, id: String(saved.id) } : item)));
          }
        } catch (error: any) {
          console.warn('Failed to save chat message', error);
          setMsgs((prev) => prev.map((item) => (item.id === tempId ? { ...item, failed: true } : item)));
          Alert.alert('Message not sent', error?.message || 'Could not send the message. Check your connection and try again.');
        }
      }

      sendingRef.current = false;
      setBusy(false);
    },
    [clientLang, currentUserId, workerId, scrollToBottom, workerLang, me],
  );

  const onMic = useCallback(async (): Promise<void> => {
    setListening(true);
    try {
      const sttLang = me === 'client' ? clientLang : workerLang;
      const text = await webSTT(sttLang);
      if (text && text.trim()) {
        await send(text);
      } else {
        Alert.alert('Voice', 'No speech detected. Speak clearly and try again.');
      }
    } catch (error: any) {
      Alert.alert('Voice error', error?.message || 'Could not capture voice');
    } finally {
      setListening(false);
    }
  }, [clientLang, send, workerLang, me]);

  const onSpeak = useCallback(
    async (bubble: Bubble): Promise<void> => {
      if (speakingId) return;
      setSpeakingId(bubble.id);
      try {
        const viewerLang = langForSide(me);
        const text = await ensureTranslation(bubble, viewerLang);
        await speakTTS(text, viewerLang);
      } catch (error) {
        console.warn('TTS failed', error);
      } finally {
        setSpeakingId(null);
      }
    },
    [ensureTranslation, speakingId, langForSide, me],
  );

  const renderBubble = useCallback(
    ({ item }: { item: Bubble }) => {
      const mine = item.side === me;
      const view = viewText(item, me);
      const showSubtitle = view.text !== item.original;

      return (
        <View style={[styles.row, mine ? styles.rowR : styles.rowL]}>
          {!mine && (
            <View style={styles.avatar}>
              <Ionicons name="person" size={14} color="#fff" />
            </View>
          )}
          <View style={[styles.bubble, mine ? styles.bMine : styles.bThem]}>
            <Text style={[styles.original, mine ? styles.textMine : styles.textThem]}>{view.text}</Text>
            {item.failed && (
              <Text style={styles.failedTag}>⚠ Not sent</Text>
            )}
            {showSubtitle && (
              <Text style={[styles.subtitle, mine ? styles.subMine : styles.subThem]} numberOfLines={2}>
                ({item.srcLang.split('-')[0].toUpperCase()}) {item.original}
              </Text>
            )}
            <TouchableOpacity
              testID={`speak-${item.id}`}
              onPress={() => onSpeak(item)}
              style={styles.speakBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {speakingId === item.id ? (
                <ActivityIndicator size="small" color={mine ? '#075e54' : '#6F42C1'} />
              ) : (
                <Ionicons name="volume-high" size={16} color={mine ? '#075e54' : '#6F42C1'} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [onSpeak, speakingId, viewText, me],
  );

  const LangPicker = useCallback(
    ({ value, onChange, label }: { value: LangCode; onChange: (lang: LangCode) => void; label: string }) => (
      <View style={styles.langBox}>
        <Text style={styles.langLabel}>{label}</Text>
        <View style={styles.langRow}>
          {LANGS.map((l) => (
            <TouchableOpacity key={l.code} style={[styles.langChip, value === l.code && styles.langChipActive]} onPress={() => onChange(l.code)}>
              <Text style={[styles.langText, value === l.code && styles.langTextActive]}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    ),
    [],
  );

  const myLang = me === 'client' ? clientLang : workerLang;
  const otherLang = me === 'client' ? workerLang : clientLang;
  const setMyLang = me === 'client' ? setClientLang : setWorkerLang;
  const setOtherLang = me === 'client' ? setWorkerLang : setClientLang;
  // Persist my pick to my profile so the next chat (and the other side's
  // translation) starts from it; local state updates immediately regardless.
  const handleMyLangChange = (lang: LangCode) => {
    setMyLang(lang);
    saveMyLanguage(currentUserId, myRole, lang);
  };
  // "You speak" / "<otherLabel> speaks" — the other side's label depends on who
// I am, so a worker sees "Client speaks" and a client sees "Worker speaks".
const otherLabel = myRole === 'worker' ? 'Client' : 'Worker';

  return (
    // Plain View: the root layout already applies the safe-area insets.
    // RN's deprecated SafeAreaView would double them on iOS.
    <View style={styles.safeArea}>
      {/* Same pattern as ai-assistant (whose input fits): the window pans under
          the keyboard, so KAV 'padding' lifts the composer exactly above it. */}
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior="padding"
        enabled
      >
        <View style={styles.screen}>
          <Stack.Screen options={{ headerShown: false }} />

          <View style={styles.frame}>
            <View style={styles.topBar}>
              <TouchableOpacity onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>

              <View style={styles.headerCenter}>
                <View style={styles.headerAvatar}>
                  <Ionicons name="person" size={16} color="#fff" />
                </View>

                <View>
                  <Text style={styles.headerTitle}>{workerName || 'Chat'}</Text>
                  <Text style={styles.headerSubtitle}>{t('chat.onlineAutoTranslate')}</Text>
                </View>
              </View>

              <View style={{ width: 22 }} />
            </View>

            <View style={styles.langSection}>
              <LangPicker label={t('chat.youSpeak')} value={myLang} onChange={handleMyLangChange} />
              <LangPicker label={t('chat.otherSpeaks', { name: workerName || otherLabel })} value={otherLang} onChange={setOtherLang} />
            </View>

            <FlatList
              testID="chat-list"
              ref={listRef}
              data={msgs}
              keyExtractor={(bubble) => bubble.id}
              renderItem={renderBubble}
              style={styles.list}
              contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            />

            {busy && <ActivityIndicator color="#6F42C1" style={{ marginVertical: 4 }} />}

            {/* Composer stays in normal flow — KeyboardAvoidingView's padding
                lifts the whole column above the keyboard on both platforms. */}
            <View style={styles.inputRow}>
              <TouchableOpacity
                testID="mic-button"
                accessibilityLabel={listening ? 'Stop voice input' : 'Start voice input'}
                style={[styles.micBtn, listening && { backgroundColor: '#FF6B6B' }]}
                onPress={onMic}
              >
                <Ionicons name={listening ? 'mic' : 'mic-outline'} size={18} color="#fff" />
              </TouchableOpacity>

              <TextInput
                testID="message-input"
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder={t('chat.typePlaceholder', { lang: myLang.split('-')[0].toUpperCase() })}
                placeholderTextColor="#999"
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={() => send(input)}
              />

              <TouchableOpacity accessibilityLabel="Send message" testID="send-button" style={styles.sendBtn} onPress={() => send(input)}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ece5dd' },
  keyboardView: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#ece5dd' },
  frame: { flex: 1, width: '100%', backgroundColor: '#ece5dd', position: 'relative' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#6F42C1' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 14, fontWeight: '800', color: '#fff' },
  headerSubtitle: { fontSize: 10, color: '#e9d5ff' },
  langSection: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, backgroundColor: '#f7f3ff', borderBottomWidth: 1, borderBottomColor: '#e9ddff' },
  langBox: { marginTop: 4 },
  langLabel: { fontSize: 10, fontWeight: '700', color: '#666', marginBottom: 4 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  langChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#fff' },
  langChipActive: { backgroundColor: '#6F42C1' },
  langText: { fontSize: 10, fontWeight: '600', color: '#333' },
  langTextActive: { color: '#fff' },
  list: { flex: 1, marginTop: 8 },
  row: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 6, alignItems: 'flex-end' },
  rowR: { justifyContent: 'flex-end' },
  rowL: { justifyContent: 'flex-start' },
  avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#6F42C1', justifyContent: 'center', alignItems: 'center', marginRight: 6 },
  bubble: { maxWidth: '78%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, paddingRight: 30, position: 'relative', ...platformShadow('0px 1px 3px rgba(0,0,0,0.08)', '#000', 0, 1, 0.08, 1.5, 1) },
  bMine: { backgroundColor: '#dcf8c6', borderBottomRightRadius: 2 },
  bThem: { backgroundColor: '#ede7f6', borderBottomLeftRadius: 2 },
  original: { fontSize: 13, lineHeight: 18 },
  textMine: { color: '#0b3d1a' },
  textThem: { color: '#222' },
  subtitle: { fontSize: 10, marginTop: 4, fontStyle: 'italic' },
  failedTag: { fontSize: 10, marginTop: 4, fontWeight: '700', color: '#dc2626' },
  subMine: { color: '#3a6e44' },
  subThem: { color: '#888' },
  speakBtn: { position: 'absolute', right: 6, bottom: 6, padding: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: '#fff' },
  micBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#6F42C1', justifyContent: 'center', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 13, color: '#333' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
});