import { aiDetectLang, aiTranslate, LangCode, LANGS, speak as speakTTS, webSTT } from '@/lib/ai';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
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
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

type Side = 'client' | 'worker';

interface Bubble {
  id: string;
  side: Side;
  original: string;
  srcLang: LangCode;
  translations: Partial<Record<LangCode, string>>;
}

interface ServerChatMessage {
  id: string | number;
  sender_id: string | number;
  message: string;
}

const createSystemBubble = (workerName?: string): Bubble => ({
  id: 'sys',
  side: 'worker',
  original: workerName ? `Hello, this is ${workerName}. How can I help you?` : 'Hello! How can I help you?',
  srcLang: 'en-IN',
  translations: {},
});

const mapServerMessageToBubble = (message: ServerChatMessage, currentUserId: string): Bubble => ({
  id: String(message.id),
  side: String(message.sender_id) === currentUserId ? 'client' : 'worker',
  original: message.message ?? '',
  srcLang: 'en-IN',
  translations: {},
});

export default function ChatScreen() {
  const router = useRouter();
  const { workerId, workerName } = useLocalSearchParams<{ workerId?: string; workerName?: string }>();

  const me: Side = 'client';
  const [clientLang, setClientLang] = useState<LangCode>('en-IN');
  const [workerLang, setWorkerLang] = useState<LangCode>('te-IN');
  const [input, setInput] = useState<string>('');
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [listening, setListening] = useState<boolean>(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const listRef = useRef<FlatList<Bubble> | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  useEffect(() => {
    const keyboardShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates?.height || 0);
      scrollToBottom();
    });
    const keyboardHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConversation() {
      let uid = '';
      try {
        const authRaw = await storage.get('workmithra:auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          if (auth?.id) uid = String(auth.id);
        }
      } catch (error) {
        console.warn('Failed to parse auth data', error);
      }

      setCurrentUserId(uid);
      const sysMsg = createSystemBubble(workerName);

      if (!uid || !workerId) {
        setMsgs([sysMsg]);
        return;
      }

      try {
        const response = await fetch(`${BASE_URL}/chat/conversation/${uid}/${workerId}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          setMsgs([sysMsg]);
          return;
        }

        const history = await response.json();
        if (!Array.isArray(history)) {
          setMsgs([sysMsg]);
          return;
        }

        const loadedMsgs = history.map((message: ServerChatMessage) => mapServerMessageToBubble(message, uid));
        setMsgs([sysMsg, ...loadedMsgs]);
        scrollToBottom();
      } catch (error: any) {
        if (controller.signal.aborted) return;
        console.warn('Failed to load chat history', error);
        setMsgs([sysMsg]);
      }
    }

    void loadConversation();
    return () => controller.abort();
  }, [workerId, workerName, scrollToBottom]);

  useEffect(() => {
    if (!currentUserId || !workerId) return;
    const controller = new AbortController();

    async function pollConversation() {
      try {
        const response = await fetch(`${BASE_URL}/chat/conversation/${currentUserId}/${workerId}`, {
          signal: controller.signal,
        });

        if (!response.ok) return;

        const history = await response.json();
        if (!Array.isArray(history)) return;

        setMsgs((prev) => {
          const existingIds = new Set(prev.map((bubble) => bubble.id));
          const newMessages = history
            .filter((message: ServerChatMessage) => !existingIds.has(String(message.id)))
            .map((message: ServerChatMessage) => mapServerMessageToBubble(message, currentUserId));

          if (newMessages.length === 0) return prev;
          scrollToBottom();
          return [...prev, ...newMessages];
        });
      } catch (error: any) {
        if (controller.signal.aborted) return;
        console.warn('Chat polling failed', error);
      }
    }

    const intervalId = setInterval(pollConversation, 3000);
    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [currentUserId, workerId, scrollToBottom]);

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

      setInput('');
      setBusy(true);

      const targetLang = me === 'client' ? workerLang : clientLang;
      let srcLang: LangCode = 'en-IN';

      try {
        srcLang = await aiDetectLang(trimmed);
      } catch (error) {
        console.warn('Language detection failed', error);
      }

      const tempId = String(Date.now());
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
          const response = await fetch(`${BASE_URL}/chat/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender_id: Number(currentUserId), receiver_id: Number(workerId), message: trimmed }),
          });

          if (response.ok) {
            const saved = await response.json();
            if (saved?.id) {
              setMsgs((prev) => prev.map((item) => (item.id === tempId ? { ...item, id: String(saved.id) } : item)));
            }
          } else {
            console.warn('Failed to save chat message', response.status);
          }
        } catch (error) {
          console.warn('Failed to save chat message', error);
        }
      }

      setBusy(false);
    },
    [clientLang, currentUserId, workerId, scrollToBottom, workerLang],
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
  }, [clientLang, send, workerLang]);

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
    [ensureTranslation, speakingId],
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
  const composerBottomOffset = keyboardVisible && Platform.OS === 'android' ? Math.max(keyboardHeight - 24, 0) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'position'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
                  <Text style={styles.headerSubtitle}>online · auto-translate</Text>
                </View>
              </View>

              <View style={{ width: 22 }} />
            </View>

            <View style={styles.langSection}>
              <LangPicker label="You speak" value={clientLang} onChange={setClientLang} />
              <LangPicker label={`${workerName || 'Worker'} speaks`} value={workerLang} onChange={setWorkerLang} />
            </View>

            <FlatList
              testID="chat-list"
              ref={listRef}
              data={msgs}
              keyExtractor={(bubble) => bubble.id}
              renderItem={renderBubble}
              style={styles.list}
              contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: keyboardVisible ? keyboardHeight + 140 : 120 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            />

            {busy && <ActivityIndicator color="#6F42C1" style={{ marginVertical: 4 }} />}

            {/* Keep the composer above the keyboard on both platforms. */}
            <View
              style={[
                styles.inputRow,
                Platform.OS === 'android' && keyboardVisible
                  ? { position: 'absolute', left: 0, right: 0, bottom: composerBottomOffset, zIndex: 20, borderTopWidth: 1, borderTopColor: '#ece5dd' }
                  : null,
              ]}
            >
              <TouchableOpacity
                testID="mic-button"
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
                placeholder={`Type in ${myLang.split('-')[0].toUpperCase()} or any language...`}
                placeholderTextColor="#999"
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={() => send(input)}
              />

              <TouchableOpacity testID="send-button" style={styles.sendBtn} onPress={() => send(input)}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  subMine: { color: '#3a6e44' },
  subThem: { color: '#888' },
  speakBtn: { position: 'absolute', right: 6, bottom: 6, padding: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: '#fff' },
  micBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#6F42C1', justifyContent: 'center', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 13, color: '#333' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
});