import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, expectJson } from '@/lib/api';
import { BookingStatus, isActiveStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { formatBookingDateTime, isBookingDateTimePast } from '@/lib/format';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { BookingResponse, WorkerBrief } from '@/lib/types';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

type Tab = 'present' | 'past';

type Booking = {
  id: string;
  user_id: number;
  worker: WorkerBrief;
  status: BookingStatus;
  amount: number;
  date: string;
};

function statusColor(s: BookingStatus, isPast: boolean) {
  if (s === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (s === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  if (isPast) {
    // In the Past tab the slot has already gone, so describe the OUTCOME rather
    // than a still-open state: a request nobody accepted is "Not accepted", and
    // an accepted job that was never finished is "Not completed". "Pending" and
    // "Upcoming" only make sense for future bookings in the Present tab.
    if (s === 'pending') return { bg: '#f3f4f6', fg: '#6b7280', label: '✗ Not accepted' };
    return { bg: '#ffedd5', fg: '#9a3412', label: '⏱ Not completed' };
  }
  if (s === 'pending') return { bg: '#fef3c7', fg: '#92400e', label: '⏳ Pending' };
  return { bg: '#dbeafe', fg: '#1e40af', label: '⏳ Upcoming' };
}



export default function BookingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('present');
  const [loading, setLoading] = useState(true);

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
    try {
      await expectJson(
        await authFetch(`/bookings/${b.id}`, {
          method: 'PUT',
          json: { estimated_price: amt },
        }),
        'Could not save the agreed price',
      );
      setPresent((rs) => rs.map((x) => (x.id === b.id ? { ...x, amount: amt } : x)));
      setPriceFor(null);
      setPriceAmount('');
      Alert.alert('Saved', `Agreed price set to ₹${amt}.`);
    } catch (e: any) {
      Alert.alert('Price not saved', e?.message || 'Could not save the agreed price. Please try again.');
    }
  }

  useEffect(() => {
    (async () => {
      let uid = 0;
      try {
        const authRaw = await storage.get('workmithra:auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          if (auth.id) uid = Number(auth.id);
        }
      } catch {}
      try {
        // The backend embeds worker details on each booking, so one request is enough.
        const bookingsList: BookingResponse[] = await expectJson(
          await authFetch('/bookings'),
          'Could not load your bookings',
        );

        const realPresent: Booking[] = [];
        const realPast: Booking[] = [];

        bookingsList.forEach((b) => {
          if (b.user_id === uid || b.worker_id === uid) {
             const w: WorkerBrief = b.worker || { id: b.worker_id || 0 };
             const status = normalizeBookingStatus(b.status);
             const bookingItem: Booking = {
               id: String(b.id),
               user_id: b.user_id,
               worker: w,
               status,
               amount: b.estimated_price || b.final_price || 0,
               date: formatBookingDateTime(b.booking_date, b.booking_time) || 'Date not set',
             };
             // Present = an upcoming slot that hasn't happened yet.
             // Past = the scheduled time has passed OR it reached a terminal
             // state. We keep the real status label (pending/upcoming/rejected/
             // completed) so a never-accepted booking still shows as Pending.
             const isPast = isBookingDateTimePast(b.booking_date, b.booking_time) || !isActiveStatus(status);
             if (isPast) {
               realPast.push(bookingItem);
             } else {
               realPresent.push(bookingItem);
             }
          }
        });

        setPresent(realPresent);
        setPast(realPast);
      } catch (e: any) {
        console.warn('Failed to fetch bookings', e);
        Alert.alert('Bookings', e?.message || 'Could not load your bookings. Pull down or reopen to retry.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const data = tab === 'present' ? present : past;

  const renderCard = (b: Booking) => {
    const sc = statusColor(b.status, tab === 'past');
    return (
      <TouchableOpacity
        key={b.id}
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/worker_info', params: { id: String(b.worker.id) } })}
      >
        <View style={styles.leftCol}>
          <Avatar uri={b.worker.profile_image} name={b.worker.full_name} size={70} style={styles.avatar} />
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
            <Text style={[styles.amount, b.amount <= 0 && tab === 'present' && { color: '#FF9800', fontSize: 11 }]}>
              {b.status === 'rejected' ? '—' : b.amount > 0 ? `₹${b.amount}` : tab === 'past' ? '—' : 'Quote pending'}
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
  frame: { flex: 1, width: '100%', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
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
