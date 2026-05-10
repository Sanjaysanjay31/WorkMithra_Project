import BottomNav from '@/components/bottom-nav';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [domains] = useState<string[]>(['Plumber', 'Electrician', 'Carpenter', 'Painter']);
  const [workers, setWorkers] = useState<any[]>([]);
  const [filteredWorkers, setFilteredWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchWorkers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [searchQuery, selectedDomain, workers]);

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

  function applyFilters() {
    let filtered = workers;
    if (searchQuery) {
      filtered = filtered.filter((w: any) =>
        w.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (selectedDomain) {
      filtered = filtered.filter((w: any) =>
        w.skill?.toLowerCase().includes(selectedDomain.toLowerCase())
      );
    }
    setFilteredWorkers(filtered);
  }

  function onPressWorker(w: any) {
    router.push({ pathname: '/worker_info', params: { id: String(w.id) } });
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
        <Text style={styles.workerRating}>⭐ {(item.rating ?? 0).toFixed(1)} • {item.completed_jobs || 0} jobs</Text>
      </View>
      <TouchableOpacity style={styles.moreBtn} onPress={() => onPressWorker(item)}>
        <Text style={styles.moreBtnText}>More</Text>
      </TouchableOpacity>
    </View>
  );

  const renderDomainChip = (domain: string) => (
    <TouchableOpacity
      key={domain}
      style={[styles.chip, selectedDomain === domain && styles.chipActive]}
      onPress={() => setSelectedDomain(selectedDomain === domain ? null : domain)}
    >
      <Text style={[styles.chipText, selectedDomain === domain && styles.chipTextActive]}>
        {domain}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search workers..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity style={styles.aiBtn} onPress={() => router.push('/ai-assistant')}>
            <Ionicons name="sparkles" size={18} color="white" />
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Domain</Text>
          <FlatList
            data={domains}
            horizontal
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => renderDomainChip(item)}
            keyExtractor={(i) => i}
            scrollEnabled={false}
            style={styles.chipList}
          />
          <TouchableOpacity style={styles.applyBtn}>
            <Text style={styles.applyText}>Apply</Text>
          </TouchableOpacity>
        </View>

        {/* Logo */}
        <View style={styles.logoSection}>
          <Text style={styles.logo}>WorkMithra</Text>
        </View>

        {/* Workers Title */}
        <Text style={styles.workersTitle}>Available Workers</Text>

        {/* Workers List */}
        {loading ? (
          <ActivityIndicator size="large" color="#6F42C1" style={{ marginTop: 20 }} />
        ) : filteredWorkers.length === 0 ? (
          <Text style={styles.noResults}>No workers found</Text>
        ) : (
          <FlatList
            data={filteredWorkers}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderWorker}
            scrollEnabled={true}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
      <BottomNav currentRoute="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: 360, height: 803, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', paddingHorizontal: 12, borderRadius: 12, height: 42 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#333' },
  aiBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
  filterSection: { marginBottom: 16 },
  filterLabel: { fontSize: 12, fontWeight: '700', color: '#333', marginBottom: 8 },
  chipList: { marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f0f0f0', marginRight: 8 },
  chipActive: { backgroundColor: '#6F42C1' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#333' },
  chipTextActive: { color: '#fff' },
  applyBtn: { alignSelf: 'flex-end', backgroundColor: '#ffd166', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  applyText: { fontSize: 11, fontWeight: '700', color: '#000' },
  logoSection: { alignItems: 'center', paddingVertical: 18 },
  logo: { fontSize: 22, fontWeight: '800', color: '#e8d5f2' },
  workersTitle: { fontSize: 15, fontWeight: '800', color: '#333', marginBottom: 12 },
  noResults: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 24 },
  list: { paddingBottom: 100 },
  workerCard: { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 11, paddingHorizontal: 11, marginBottom: 11, borderRadius: 11, borderWidth: 1, borderColor: '#e9ecef', alignItems: 'center' },
  workerAvatar: { width: 55, height: 55, borderRadius: 27, marginRight: 11, backgroundColor: '#e9ecef' },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 13, fontWeight: '800', color: '#333' },
  workerDomain: { fontSize: 11, color: '#666', marginTop: 2 },
  workerRating: { fontSize: 10, color: '#999', marginTop: 3 },
  moreBtn: { backgroundColor: '#6F42C1', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 7 },
  moreBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
