import BottomNav from '@/components/bottom-nav';
import Avatar from '@/components/avatar';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

type Tab = 'present' | 'past';
type Status = 'upcoming' | 'success' | 'rejected';

type Worker = {
  id: number;
  full_name?: string;
  skill?: string;
  hourly_rate?: number;
  rating?: number;
  profile_image?: string;
};

type Booking = {
  id: string;
  user_id: number;
  worker: Worker;
  status: Status;
  amount: number;
  date: string;
};

function statusColor(s: Status) {
  if (s === 'success') return { bg: '#dcfce7', fg: '#166534', label: '✓ Success' };
  if (s === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  return { bg: '#dbeafe', fg: '#1e40af', label: '⏳ Upcoming' };
}



export default function BookingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('present');
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(0);

  const [present, setPresent] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [priceFor, setPriceFor] = useState<Booking | null>(null);
  const [priceAmount, setPriceAmount] = useState('');

  async function savePrice() {
    if (!priceFor) return;
    const amt = Number(priceAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Price', 'Please enter a valid amount in ₹');
      return;
    }
    const b = priceFor;
    setPresent((rs) => rs.map((x) => (x.id === b.id ? { ...x, amount: amt } : x)));
    try {
      await fetch(`${BASE_URL}/bookings/${b.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: b.user_id, estimated_price: amt })
      });
    } catch {}
    setPriceFor(null);
    setPriceAmount('');
    Alert.alert('Saved', `Agreed price set to ₹${amt}.`);
  }

  useEffect(() => {
    (async () => {
      let uid = 0;
      try {
        const authRaw = await storage.get('workmithra:auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          if (auth.id) uid = Number(auth.id);
          setCurrentUserId(uid);
        }
      } catch {}
      try {
        const workersRes = await fetch(`${BASE_URL}/workers`);
        const workersList: Worker[] = workersRes.ok ? await workersRes.json() : [];
        setWorkers(workersList);

        const bookingsRes = await fetch(`${BASE_URL}/bookings`);
        const bookingsList = bookingsRes.ok ? await bookingsRes.json() : [];

        const realPresent: Booking[] = [];
        const realPast: Booking[] = [];

        bookingsList.forEach((b: any) => {
          if (b.user_id === uid || b.worker_id === uid) {
             const w = workersList.find(wk => wk.id === b.worker_id) || { id: b.worker_id || 0 };
             const bookingItem: Booking = {
               id: String(b.id),
               user_id: b.user_id,
               worker: w as Worker,
               status: b.status,
               amount: b.estimated_price || b.final_price || 0,
               date: b.booking_date ? `${b.booking_date} · ${b.booking_time || ''}` : 'Unknown date',
             };
             if (b.status === 'upcoming' || b.status === 'pending') {
               realPresent.push(bookingItem);
             } else {
               realPast.push(bookingItem);
             }
          }
        });

        setPresent(realPresent);
        setPast(realPast);
      } catch (e) {
        console.warn('Failed to fetch bookings', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const data = tab === 'present' ? present : past;

  const renderCard = (b: Booking) => {
    const sc = statusColor(b.status);
    return (
      <TouchableOpacity
        key={b.id}
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/worker_info', params: { id: String(b.worker.id) } })}
      >
        <View style={styles.leftCol}>
          <Avatar uri={b.worker.profile_image} name={b.worker.full_name} size={70} style={styles.avatar as any} />
        </View>
        <View style={styles.rightCol}>
          <Text style={styles.name} numberOfLines={1}>{b.worker.full_name || 'Worker'}</Text>
          <Text style={styles.role}>{b.worker.skill || 'General'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.rating}>⭐ {(b.worker.rating ?? 0).toFixed(1)}</Text>
            <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusText, { color: sc.fg }]}>{sc.label}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.date}>{b.date}</Text>
            <Text style={[styles.amount, b.amount <= 0 && { color: '#FF9800', fontSize: 11 }]}>
              {b.status === 'rejected' ? '—' : (b.amount > 0 ? `₹${b.amount}` : 'Quote pending')}
            </Text>
          </View>
          {tab === 'present' && b.status !== 'rejected' && (
            <TouchableOpacity
              style={styles.priceBtn}
              onPress={(e) => { (e as any).stopPropagation?.(); setPriceAmount(b.amount > 0 ? String(b.amount) : ''); setPriceFor(b); }}
            >
              <Text style={styles.priceBtnText}>{b.amount > 0 ? 'Update agreed price' : 'Enter agreed price'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Bookings', headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>My Bookings</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'present' && styles.tabBtnActive]} onPress={() => setTab('present')}>
            <Text style={[styles.tabText, tab === 'present' && styles.tabTextActive]}>Present Bookings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'past' && styles.tabBtnActive]} onPress={() => setTab('past')}>
            <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>Past Bookings</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#6F42C1" style={{ marginTop: 30 }} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            {data.length === 0 ? (
              <Text style={styles.placeholder}>No bookings here yet</Text>
            ) : (
              data.map(renderCard)
            )}
          </ScrollView>
        )}
      </View>
      <Modal visible={!!priceFor} transparent animationType="fade" onRequestClose={() => setPriceFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set agreed price</Text>
            {priceFor && (
              <Text style={styles.modalSub}>With {priceFor.worker.full_name || 'worker'} · {priceFor.date}</Text>
            )}
            <View style={styles.amountRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={styles.amountInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
                value={priceAmount}
                onChangeText={setPriceAmount}
                autoFocus
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setPriceFor(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSave]} onPress={savePrice}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNav currentRoute="bookings" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 16, textAlign: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },
  placeholder: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 30 },

  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    ...platformShadow('0px 1px 4px rgba(0,0,0,0.06)', '#000', 0, 1, 0.06, 2, 1),
  },
  leftCol: { width: '30%', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#e9ecef' },
  rightCol: { flex: 1, paddingLeft: 10, justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '800', color: '#222' },
  role: { fontSize: 12, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  rating: { fontSize: 12, color: '#FFB800', fontWeight: '700' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 10, fontWeight: '800' },
  date: { fontSize: 11, color: '#888' },
  amount: { fontSize: 13, fontWeight: '800', color: '#10b981' },

  priceBtn: { marginTop: 8, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#6F42C1', backgroundColor: '#f5f0fb', alignItems: 'center' },
  priceBtnText: { color: '#6F42C1', fontWeight: '800', fontSize: 11 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#333', textAlign: 'center' },
  modalSub: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 10, paddingHorizontal: 12, marginTop: 14, borderWidth: 1, borderColor: '#eee' },
  rupee: { fontSize: 22, fontWeight: '800', color: '#10b981', marginRight: 6 },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '800', color: '#333', paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  modalCancel: { backgroundColor: '#f0f0f0' },
  modalCancelText: { color: '#666', fontWeight: '700', fontSize: 13 },
  modalSave: { backgroundColor: '#6F42C1' },
  modalSaveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
