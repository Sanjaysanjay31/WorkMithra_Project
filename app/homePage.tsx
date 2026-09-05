import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import FrameModal from '@/components/frame-modal';
import { aiExtract, webSTTControlled } from '@/lib/ai';
import { authFetch, expectJson, getAuthId } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { unreadCount } from '@/lib/notifications';
import { ensureSocket, onNotificationCreated } from '@/lib/socket';
import { WorkerResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SortKey = 'wage_asc' | 'wage_desc' | 'experience' | 'rating' | 'location' | 'jobs';
type AvailNow = 'now' | 'today' | null;

export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [loading, setLoading] = useState(false);
  // A failed search must NOT look like "no results" — this drives a distinct
  // error banner with a retry button.
  const [loadError, setLoadError] = useState('');
  const [listening, setListening] = useState(false);
  const [unread, setUnread] = useState(0);

  const [userId, setUserId] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const authId = await getAuthId();
        if (authId) setUserId(authId);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    // One initial fetch for the badge; after that the backend pushes
    // 'notification_created' (with the fresh unread count) over the socket,
    // so no polling interval is needed.
    unreadCount('user', userId).then((n) => { if (alive) setUnread(n); }).catch(() => {});
    let off: () => void = () => {};
    (async () => {
      // ensureSocket() is async — the listener must be registered only after
      // the socket exists, otherwise onNotificationCreated no-ops.
      await ensureSocket();
      if (!alive) return;
      off = onNotificationCreated((data) => {
        if (data.audience !== 'user' || String(data.recipient_id) !== userId) return;
        setUnread((u) => (typeof data.unread_count === 'number' ? data.unread_count : u + 1));
      });
    })();
    return () => { alive = false; off(); };
  }, [userId]);

  // Filter state
  const [filterVisible, setFilterVisible] = useState(false);
  const [minWage, setMinWage] = useState('');
  const [maxWage, setMaxWage] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [minExperience, setMinExperience] = useState('');
  const [minRating, setMinRating] = useState('');
  const [minJobs, setMinJobs] = useState('');
  const [availability, setAvailability] = useState<AvailNow>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey[]>([]);

  useEffect(() => {
    // Debounce so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(() => {
      fetchWorkers();
    }, searchQuery ? 350 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, minWage, maxWage, maxDistance, minExperience, minRating, minJobs, verifiedOnly, availability, sortBy]);

  // Focus-driven refresh: the bottom nav PUSHES screens and back pops them,
  // so this screen stays mounted while workers flip their availability — a
  // returning client would otherwise book from a stale list. The first focus
  // is skipped because the filter effect above already loads on mount.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      fetchWorkers();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Aborts the previous in-flight search so a slow stale response can't land
  // after (and clobber) a newer one.
  const fetchController = useRef<AbortController | null>(null);
  // Cached device location, fetched lazily only when a distance filter is
  // set. Entries expire after 5 minutes — a user who moves and re-searches
  // should not keep getting distances for their old position forever.
  const LOCATION_TTL_MS = 5 * 60 * 1000;
  const cachedLoc = useRef<{ lat: number; lng: number; fetchedAt: number } | null>(null);

  async function getDeviceLocation(): Promise<{ lat: number; lng: number } | null> {
    if (cachedLoc.current && Date.now() - cachedLoc.current.fetchedAt < LOCATION_TTL_MS) {
      return cachedLoc.current;
    }
    try {
      let fresh: { lat: number; lng: number } | null = null;
      if (Platform.OS === 'web') {
        if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
        fresh = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 5000 },
          );
        });
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        fresh = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      if (fresh) cachedLoc.current = { ...fresh, fetchedAt: Date.now() };
      return fresh;
    } catch {
      return null;
    }
  }

  async function fetchWorkers() {
    // Cancel any previous request before starting a new one.
    fetchController.current?.abort();
    const controller = new AbortController();
    fetchController.current = controller;

    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('q', searchQuery);
      if (minWage && !isNaN(Number(minWage))) params.append('min_wage', minWage);
      if (maxWage && !isNaN(Number(maxWage))) params.append('max_wage', maxWage);
      if (minExperience && !isNaN(Number(minExperience))) params.append('min_experience', minExperience);
      if (minRating && !isNaN(Number(minRating))) params.append('min_rating', minRating);
      if (minJobs && !isNaN(Number(minJobs))) params.append('min_jobs', minJobs);
      if (verifiedOnly) params.append('verified_only', 'true');
      if (availability) params.append('availability', availability);
      if (sortBy.length > 0) params.append('sort_by', sortBy.join(','));

      // Distance filter needs the device location; fetch it lazily and only
      // when the user actually set a radius.
      if (maxDistance && !isNaN(Number(maxDistance)) && Number(maxDistance) > 0) {
        const loc = await getDeviceLocation();
        if (controller.signal.aborted) return;
        if (loc) {
          params.append('lat', String(loc.lat));
          params.append('lng', String(loc.lng));
          params.append('radius', maxDistance);
        }
      }

      const data = await expectJson<WorkerResponse[]>(
        await authFetch(`/workers/smart-match?${params.toString()}`, { signal: controller.signal }),
        'Could not load workers',
      );
      if (controller.signal.aborted) return;
      setWorkers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      console.warn('Failed to fetch workers', e);
      // Distinguish a backend/network failure from genuinely zero results —
      // an empty list and a dead server must not render the same UI.
      setLoadError('Could not load workers. Check your connection and try again.');
    } finally {
      // Only clear loading if this is still the active request.
      if (fetchController.current === controller) setLoading(false);
    }
  }

  const filteredWorkers = workers;

  function onPressWorker(w: WorkerResponse) {
    router.push({ pathname: '/worker_info', params: { id: String(w.id) } });
  }

  function cleanQuery(s: string): string {
    return s
      .toLowerCase()
      .replace(/[.,!?;:'"]+$/g, '')   // trailing punctuation
      .replace(/^(i need|i want|find me|find|show me|show|get me|please|can you|could you)\s+(a |an |some )?/gi, '')
      .replace(/\s+to\s+(fix|repair|help with|work on)\s+/gi, ' ')
      .trim();
  }

  /** Run AI intent extraction in the background to map free-form text to a domain. */
  //
  // Debounced + capped: the LLM call is paid and slow, so we only fire it once
  // per query after a quiet window, and never more than a few times per
  // session. A failed or empty result leaves the cleaned text in place.
  const aiExtractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiExtractCount = useRef(0);
  const MAX_AI_EXTRACT_CALLS = 6;

  async function refineQueryWithAI(text: string) {
    if (aiExtractCount.current >= MAX_AI_EXTRACT_CALLS) return;
    aiExtractCount.current += 1;
    try {
      const result = await aiExtract(
        text,
        '{ "domain": one of: Plumber, Electrician, Carpenter, Painter, AC Repair, Mechanic, Cleaner, Cook, Gardener, Tailor, or null if not relevant }',
      );
      const d = (result?.domain || '').toString().trim();
      if (d && d.toLowerCase() !== 'null') setSearchQuery(d);
    } catch {
      // network/API error — leave the cleaned text in place
    }
  }

  /** Schedule a debounced AI refinement. Safe to call from every keystroke. */
  function scheduleAiRefine(text: string) {
    if (aiExtractTimer.current) clearTimeout(aiExtractTimer.current);
    aiExtractTimer.current = setTimeout(() => {
      aiExtractTimer.current = null;
      void refineQueryWithAI(text);
    }, 600);
  }

  const sttRef = useRef<{ stop: () => void; result: Promise<string> } | null>(null);

  // Stop any in-progress voice capture and abort pending searches if the
  // screen unmounts, so the mic doesn't stay open in the background.
  useEffect(() => {
    return () => {
      try { sttRef.current?.stop(); } catch {}
      fetchController.current?.abort();
      if (aiExtractTimer.current) clearTimeout(aiExtractTimer.current);
    };
  }, []);

  async function startVoiceSearch() {
    // Toggle: if already listening, stop and process.
    if (sttRef.current) {
      sttRef.current.stop();
      return;
    }
    try {
      const ctrl = webSTTControlled('auto', { silenceMs: 4000 });
      sttRef.current = ctrl;
      setListening(true);
      // Native: hard cap at 15s so the mic doesn't stay open forever.
      const autoStop = Platform.OS !== 'web' ? setTimeout(() => { try { ctrl.stop(); } catch {} }, 15000) : null;
      const raw = await ctrl.result;
      if (autoStop) clearTimeout(autoStop);
      sttRef.current = null;
      setListening(false);
      if (!raw || !raw.trim()) {
        Alert.alert('Voice search', 'No speech detected. Speak clearly into the mic, then tap again to stop.');
        return;
      }
      const cleaned = cleanQuery(raw);
      setSearchQuery(cleaned);
      scheduleAiRefine(raw);
    } catch (e: any) {
      sttRef.current = null;
      setListening(false);
      Alert.alert('Voice search', e?.message || 'Could not capture voice');
    }
  }

  function clearFilters() {
    setMinWage('');
    setMaxWage('');
    setMaxDistance('');
    setMinExperience('');
    setMinRating('');
    setMinJobs('');
    setAvailability(null);
    setVerifiedOnly(false);
    setSortBy([]);
  }

  const renderWorker = ({ item }: { item: WorkerResponse }) => (
    <View style={styles.workerCard}>
      <Avatar uri={item.profile_image} name={item.full_name} size={60} style={styles.workerAvatar} />
      <View style={styles.workerInfo}>
        <Text style={styles.workerName}>{item.full_name}</Text>
        <Text style={styles.workerDomain}>{item.skill || 'General Worker'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.workerRating}>⭐ {(item.rating ?? 0).toFixed(1)}</Text>
          <Text style={styles.workerWage}>₹{item.hourly_rate ?? '—'}/hr</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.moreBtn} onPress={() => onPressWorker(item)}>
        <Text style={styles.moreBtnText}>More</Text>
      </TouchableOpacity>
    </View>
  );

  const SortChip = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sortBy.includes(k);
    return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={() => setSortBy(active ? sortBy.filter((s) => s !== k) : [...sortBy, k])}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {active ? `${sortBy.indexOf(k) + 1}. ` : ''}{label}
      </Text>
    </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <View style={styles.topBar}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => {
                const raw = searchQuery;
                if (!raw.trim()) return;
                setSearchQuery(cleanQuery(raw));
                scheduleAiRefine(raw);
              }}
              returnKeyType="search"
            />
            <TouchableOpacity onPress={startVoiceSearch} style={styles.micBtn} accessibilityLabel="Search by voice">
              <Ionicons
                name={listening ? 'mic' : 'mic-outline'}
                size={18}
                color={listening ? '#FF6B6B' : '#6F42C1'}
              />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setFilterVisible(true)} activeOpacity={0.85} accessibilityLabel="Open filters">
            <Ionicons name="options" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Open notifications"
            style={styles.bellBtn}
            onPress={() => router.push('/notifications')}
            activeOpacity={0.85}
          >
            <Ionicons name="notifications-outline" size={18} color="#fff" />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.logoSection}>
          <Text style={styles.logo}>WorkMithra</Text>
        </View>

        <Text style={styles.workersTitle}>Available Workers</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#6F42C1" style={{ marginTop: 20 }} />
        ) : loadError ? (
          <View style={{ alignItems: 'center', marginTop: 20 }}>
            <Text style={[styles.noResults, { color: '#b91c1c' }]}>{loadError}</Text>
            <TouchableOpacity
              accessibilityLabel="Retry loading workers"
              onPress={() => {
                setLoadError('');
                void fetchWorkers();
              }}
              style={{ marginTop: 10, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#6F42C1' }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filteredWorkers.length === 0 ? (
          <Text style={styles.noResults}>No workers found</Text>
        ) : (
          <FlatList
            data={filteredWorkers}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderWorker}
            contentContainerStyle={styles.list}
          />
        )}
      </View>

      <FrameModal visible={filterVisible} animationType="slide" onRequestClose={() => setFilterVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: 16 + insets.bottom, height: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Availability</Text>
              <View style={styles.chipsWrap}>
                <TouchableOpacity style={[styles.chip, availability === 'now' && styles.chipActive]} onPress={() => setAvailability(availability === 'now' ? null : 'now')}>
                  <Text style={[styles.chipText, availability === 'now' && styles.chipTextActive]}>Available now</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.chip, availability === 'today' && styles.chipActive]} onPress={() => setAvailability(availability === 'today' ? null : 'today')}>
                  <Text style={[styles.chipText, availability === 'today' && styles.chipTextActive]}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.chip, verifiedOnly && styles.chipActive]} onPress={() => setVerifiedOnly((v) => !v)}>
                  <Text style={[styles.chipText, verifiedOnly && styles.chipTextActive]}>✓ Verified only</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Wage range (₹/hour)</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1, marginRight: 8 }]}
                  placeholder="Min"
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                  value={minWage}
                  onChangeText={setMinWage}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Max"
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                  value={maxWage}
                  onChangeText={setMaxWage}
                />
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.fieldLabel}>Distance (km)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 5"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    value={maxDistance}
                    onChangeText={setMaxDistance}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Min experience (yrs)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 2"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    value={minExperience}
                    onChangeText={setMinExperience}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.fieldLabel}>Min rating</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 4.0"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    value={minRating}
                    onChangeText={setMinRating}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Min completed jobs</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 10"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    value={minJobs}
                    onChangeText={setMinJobs}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Sort by</Text>
              <View style={styles.chipsWrap}>
                <SortChip k="rating" label="⭐ Rating" />
                <SortChip k="location" label="📍 Nearest" />
                <SortChip k="wage_asc" label="₹ Low → High" />
                <SortChip k="wage_desc" label="₹ High → Low" />
                <SortChip k="experience" label="🧰 Experience" />
                <SortChip k="jobs" label="🔥 Most active" />
              </View>
            </ScrollView>

            <View style={[styles.row, { marginTop: 12 }]}>
              <TouchableOpacity style={[styles.modalBtn, styles.clearBtn]} onPress={clearFilters}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.applyModalBtn]} onPress={() => setFilterVisible(false)}>
                <Text style={styles.applyModalBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </FrameModal>

      <BottomNav currentRoute="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', alignSelf: 'stretch', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', paddingHorizontal: 12, borderRadius: 12, height: 42 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 13, color: '#333' },
  micBtn: { paddingHorizontal: 6, paddingVertical: 4, marginLeft: 4 },
  filterBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#6F42C1', justifyContent: 'center', alignItems: 'center' },
  bellBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FF6B6B', justifyContent: 'center', alignItems: 'center' },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#FF6B6B', paddingHorizontal: 3, justifyContent: 'center', alignItems: 'center' },
  bellBadgeText: { fontSize: 9, fontWeight: '800', color: '#FF6B6B' },
  logoSection: { alignItems: 'center', paddingVertical: 12 },
  logo: { fontSize: 24, fontWeight: '900', color: '#6F42C1', letterSpacing: 0.5 },
  workersTitle: { fontSize: 15, fontWeight: '800', color: '#333', marginBottom: 12 },
  noResults: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 24 },
  list: { paddingBottom: 100 },
  workerCard: { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 11, paddingHorizontal: 11, marginBottom: 11, borderRadius: 11, borderWidth: 1, borderColor: '#e9ecef', alignItems: 'center' },
  workerAvatar: { width: 55, height: 55, borderRadius: 27, marginRight: 11, backgroundColor: '#e9ecef' },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 13, fontWeight: '800', color: '#333' },
  workerDomain: { fontSize: 11, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 10 },
  workerRating: { fontSize: 11, color: '#FFB800', fontWeight: '700' },
  workerWage: { fontSize: 11, color: '#10b981', fontWeight: '700' },
  moreBtn: { backgroundColor: '#6F42C1', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 7 },
  moreBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', alignItems: 'center' },
  modalCard: { width: '100%', alignSelf: 'stretch', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#333', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#333' },
  row: { flexDirection: 'row' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f0f0f0' },
  chipActive: { backgroundColor: '#6F42C1' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#333' },
  chipTextActive: { color: '#fff' },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  clearBtn: { backgroundColor: '#f0f0f0', marginRight: 8 },
  clearBtnText: { color: '#333', fontWeight: '700' },
  applyModalBtn: { backgroundColor: '#6F42C1' },
  applyModalBtnText: { color: '#fff', fontWeight: '800' },
});
