import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { aiDetectLang, aiTranslate, LangCode, LANGS, speak as speakTTS, webSTT } from '@/lib/ai';
import { platformShadow } from '@/lib/shadow';

type Side = 'client' | 'worker';

type Bubble = {
  id: string;
  side: Side;          // who sent it
  original: string;    // text in sender's detected language
  srcLang: LangCode;
  // translated payloads keyed by target lang
  translations: Partial<Record<LangCode, string>>;
};

export default function ChatScreen() {
  const router = useRouter();
  const { workerName } = useLocalSearchParams<{ workerId?: string; workerName?: string }>();

  // On this screen the logged-in user is always the client; the worker is on the other side.
  const me: Side = 'client';
  const [clientLang, setClientLang] = useState<LangCode>('en-IN');
  const [workerLang, setWorkerLang] = useState<LangCode>('te-IN');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Bubble>>(null);

  useEffect(() => {
    setMsgs([{
      id: 'sys',
      side: 'worker',
      original: workerName ? `Hello, this is ${workerName}. How can I help you?` : 'Hello! How can I help you?',
      srcLang: 'en-IN',
      translations: {},
    }]);
  }, []);

  function langForSide(s: Side): LangCode {
    return s === 'client' ? clientLang : workerLang;
  }

  /** Returns the text to display for `viewer` reading bubble `b`. */
  function viewText(b: Bubble, viewer: Side): { text: string; lang: LangCode } {
    const viewerLang = langForSide(viewer);
    if (b.srcLang === viewerLang) return { text: b.original, lang: b.srcLang };
    const t = b.translations[viewerLang];
    if (t) return { text: t, lang: viewerLang };
    return { text: b.original, lang: b.srcLang };
  }

  async function ensureTranslation(b: Bubble, target: LangCode): Promise<string> {
    if (b.srcLang === target) return b.original;
    if (b.translations[target]) return b.translations[target]!;
    const t = await aiTranslate(b.original, b.srcLang, target);
    b.translations[target] = t;
    setMsgs((m) => m.map((x) => (x.id === b.id ? { ...x, translations: { ...x.translations, [target]: t } } : x)));
    return t;
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value) return;
    setInput('');
    setBusy(true);
    try {
      const srcLang = await aiDetectLang(value);
      const otherLang = me === 'client' ? workerLang : clientLang;
      const id = String(Date.now());
      const b: Bubble = { id, side: me, original: value, srcLang, translations: {} };
      // pre-translate to the other side's language
      try {
        const t = await aiTranslate(value, srcLang, otherLang);
        b.translations[otherLang] = t;
      } catch {}
      setMsgs((m) => {
        const next = [...m, b];
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  async function onMic() {
    if (Platform.OS !== 'web') return;
    try {
      setListening(true);
      const sttHint = me === 'client' ? clientLang : workerLang;
      const text = await webSTT(sttHint);
      setListening(false);
      if (text) send(text);
    } catch {
      setListening(false);
    }
  }

  async function onSpeak(b: Bubble) {
    if (Platform.OS !== 'web') return;
    try {
      setSpeakingId(b.id);
      const viewerLang = langForSide(me);
      const text = await ensureTranslation(b, viewerLang);
      await speakTTS(text, viewerLang);
    } catch (e) {
      console.warn('TTS failed', e);
    } finally {
      setSpeakingId(null);
    }
  }

  const renderBubble = ({ item }: { item: Bubble }) => {
    const mine = item.side === me;
    const v = viewText(item, me);
    const showSubtitle = v.text !== item.original;
    return (
      <View style={[styles.row, mine ? styles.rowR : styles.rowL]}>
        {!mine && <View style={styles.avatar}><Ionicons name="person" size={14} color="#fff" /></View>}
        <View style={[styles.bubble, mine ? styles.bMine : styles.bThem]}>
          <Text style={[styles.original, mine ? styles.textMine : styles.textThem]}>{v.text}</Text>
          {showSubtitle && (
            <Text style={[styles.subtitle, mine ? styles.subMine : styles.subThem]} numberOfLines={2}>
              ({item.srcLang.split('-')[0].toUpperCase()}) {item.original}
            </Text>
          )}
          <TouchableOpacity onPress={() => onSpeak(item)} style={styles.speakBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {speakingId === item.id ? (
              <ActivityIndicator size="small" color={mine ? '#075e54' : '#6F42C1'} />
            ) : (
              <Ionicons name="volume-high" size={16} color={mine ? '#075e54' : '#6F42C1'} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const LangPicker = ({ value, onChange, label }: { value: LangCode; onChange: (l: LangCode) => void; label: string }) => (
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
  );

  const myLang = me === 'client' ? clientLang : workerLang;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.headerAvatar}><Ionicons name="person" size={16} color="#fff" /></View>
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
          ref={listRef}
          data={msgs}
          keyExtractor={(b) => b.id}
          style={styles.list}
          contentContainerStyle={{ padding: 8 }}
          renderItem={renderBubble}
        />

        {busy && <ActivityIndicator color="#6F42C1" style={{ marginVertical: 4 }} />}

        <View style={styles.inputRow}>
          <TouchableOpacity style={[styles.micBtn, listening && { backgroundColor: '#FF6B6B' }]} onPress={onMic}>
            <Ionicons name={listening ? 'mic' : 'mic-outline'} size={18} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={`Type in ${myLang.split('-')[0].toUpperCase()} or any language...`}
            placeholderTextColor="#999"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={() => send(input)}>
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ece5dd' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#ece5dd' },
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
  // Sender (me): WhatsApp-green
  bMine: { backgroundColor: '#dcf8c6', borderBottomRightRadius: 2 },
  // Receiver (worker): soft lavender to contrast with the sender's green
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
