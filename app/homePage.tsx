import BottomNav from '@/components/bottom-nav';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

type SortKey = 'wage_asc' | 'wage_desc' | 'experience' | 'rating' | 'location';

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);

  // Filter state
  const [filterVisible, setFilterVisible] = useState(false);
  const [minWage, setMinWage] = useState('');
  const [maxWage, setMaxWage] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [minExperience, setMinExperience] = useState('');
  const [minRating, setMinRating] = useState('');
  const [sortBy, setSortBy] = useState<SortKey | null>(null);

  useEffect(() => {
    fetchWorkers();
  }, []);

  async function fetchWorkers() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/workers`);
      const data = await res.json();
      setWorkers(data || []);
    } catch (e) {
      console.warn('Failed to fetch workers', e);
    } finally {
      setLoading(false);
    }
  }

  const filteredWorkers = useMemo(() => {
    let list = [...workers];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((w: any) => (w.skill || '').toLowerCase().includes(q));
    }
    const minW = parseFloat(minWage);
    const maxW = parseFloat(maxWage);
    if (!isNaN(minW)) list = list.filter((w: any) => Number(w.hourly_rate ?? 0) >= minW);
    if (!isNaN(maxW)) list = list.filter((w: any) => Number(w.hourly_rate ?? 0) <= maxW);
    const minExp = parseFloat(minExperience);
    if (!isNaN(minExp)) list = list.filter((w: any) => Number(w.experience_years ?? 0) >= minExp);
    const minR = parseFloat(minRating);
    if (!isNaN(minR)) list = list.filter((w: any) => Number(w.rating ?? 0) >= minR);
    const maxD = parseFloat(maxDistance);
    if (!isNaN(maxD)) list = list.filter((w: any) => (w.distance_km == null) || Number(w.distance_km) <= maxD);

    switch (sortBy) {
      case 'wage_asc':
        list.sort((a, b) => Number(a.hourly_rate ?? 0) - Number(b.hourly_rate ?? 0));
        break;
      case 'wage_desc':
        list.sort((a, b) => Number(b.hourly_rate ?? 0) - Number(a.hourly_rate ?? 0));
        break;
      case 'experience':
        list.sort((a, b) => Number(b.experience_years ?? 0) - Number(a.experience_years ?? 0));
        break;
      case 'rating':
        list.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
        break;
      case 'location':
        list.sort((a, b) => Number(a.distance_km ?? 9999) - Number(b.distance_km ?? 9999));
        break;
    }
    return list;
  }, [workers, searchQuery, minWage, maxWage, maxDistance, minExperience, minRating, sortBy]);

  function onPressWorker(w: any) {
    router.push({ pathname: '/worker_info', params: { id: String(w.id) } });
  }

  function startVoiceSearch() {
    if (Platform.OS !== 'web') {
      Alert.alert('Voice search', 'Voice input works in the web browser. Native voice support coming soon.');
      return;
    }
    const SR: any = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SR) {
      Alert.alert('Voice search', 'Your browser does not support voice input.');
      return;
    }
    const recog = new SR();
    recog.lang = 'en-IN';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    setListening(true);
    recog.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript || '';
      setSearchQuery(transcript);
    };
    recog.onerror = () => setListening(false);
    recog.onend = () => setListening(false);
    try { recog.start(); } catch { setListening(false); }
  }

  function clearFilters() {
    setMinWage('');
    setMaxWage('');
    setMaxDistance('');
    setMinExperience('');
    setMinRating('');
    setSortBy(null);
  }

  const renderWorker = ({ item }: { item: any }) => (
    <View style={styles.workerCard}>
      <Image
        source={{ uri: item.profile_image || 'https://placehold.co/60x60' }}
        style={styles.workerAvatar}
      />
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

  const SortChip = ({ k, label }: { k: SortKey; label: string }) => (
    <TouchableOpacity
      style={[styles.chip, sortBy === k && styles.chipActive]}
      onPress={() => setSortBy(sortBy === k ? null : k)}
    >
      <Text style={[styles.chipText, sortBy === k && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <View style={styles.topBar}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by domain (Plumber, Electrician...)"
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <TouchableOpacity onPress={startVoiceSearch} style={styles.micBtn}>
              <Ionicons
                name={listening ? 'mic' : 'mic-outline'}
                size={18}
                color={listening ? '#FF6B6B' : '#6F42C1'}
              />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setFilterVisible(true)}>
            <Ionicons name="options" size={18} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.aiBtn} onPress={() => router.push('/ai-assistant')}>
            <Ionicons name="sparkles" size={18} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.logoSection}>
          <Text style={styles.logo}>WorkMithra</Text>
        </View>

        <Text style={styles.workersTitle}>Available Workers</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#6F42C1" style={{ marginTop: 20 }} />
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

      <Modal visible={filterVisible} animationType="slide" transparent onRequestClose={() => setFilterVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
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

            <Text style={styles.fieldLabel}>Nearby distance (km)</Text>
            <TextInput
              style={styles.input}
              placeholder="Max distance"
              placeholderTextColor="#999"
              keyboardType="numeric"
              value={maxDistance}
              onChangeText={setMaxDistance}
            />

            <Text style={styles.fieldLabel}>Minimum experience (years)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2"
              placeholderTextColor="#999"
              keyboardType="numeric"
              value={minExperience}
              onChangeText={setMinExperience}
            />

            <Text style={styles.fieldLabel}>Minimum rating</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 4.0"
              placeholderTextColor="#999"
              keyboardType="numeric"
              value={minRating}
              onChangeText={setMinRating}
            />

            <Text style={styles.fieldLabel}>Sort by</Text>
            <View style={styles.chipsWrap}>
              <SortChip k="wage_asc" label="Wage ↑" />
              <SortChip k="wage_desc" label="Wage ↓" />
              <SortChip k="location" label="Nearest" />
              <SortChip k="experience" label="Experience" />
              <SortChip k="rating" label="Rating" />
            </View>

            <View style={[styles.row, { marginTop: 16 }]}>
              <TouchableOpacity style={[styles.modalBtn, styles.clearBtn]} onPress={clearFilters}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.applyModalBtn]} onPress={() => setFilterVisible(false)}>
                <Text style={styles.applyModalBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNav currentRoute="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', paddingHorizontal: 12, borderRadius: 12, height: 42 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 13, color: '#333' },
  micBtn: { paddingHorizontal: 6, paddingVertical: 4, marginLeft: 4 },
  filterBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#6F42C1', justifyContent: 'center', alignItems: 'center' },
  aiBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
  logoSection: { alignItems: 'center', paddingVertical: 12 },
  logo: { fontSize: 22, fontWeight: '800', color: '#e8d5f2' },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30 },
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
