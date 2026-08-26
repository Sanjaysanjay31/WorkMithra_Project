import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import FrameModal from '@/components/frame-modal';
import { authFetch, expectJson } from '@/lib/api';
import { BookingStatus, isActiveStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { formatBookingDateTime, isBookingDateTimePast } from '@/lib/format';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { ensureSocket, onBookingStatusChanged } from '@/lib/socket';
import { BookingResponse, WorkerBrief } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    Alert,
    KeyboardAvoidingView,
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
  /** Display amount: the agreed price once locked, else the current proposal. */
  amount: number;
  estimated_price: number;
  final_price: number;
  price_proposed_by: 'user' | 'worker' | null;
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

/** Map an API booking onto the card model (shared by load and live updates). */
function toBookingItem(b: BookingResponse, uid: number): Booking | null {
  // This is the client's bookings screen — match on user_id only.
  // Users and workers have overlapping numeric id spaces, so also
  // matching worker_id would pull in a stranger's booking whenever a
  // worker happens to share this user's number.
  if (b.user_id !== uid) return null;
  const estimated = Number(b.estimated_price ?? 0);
  const final = Number(b.final_price ?? 0);
  return {
    id: String(b.id),
    user_id: b.user_id,
    worker: b.worker || { id: b.worker_id || 0 },
    status: normalizeBookingStatus(b.status),
    estimated_price: estimated,
    final_price: final,
    price_proposed_by: b.price_proposed_by ?? null,
    amount: final || estimated,
    date: formatBookingDateTime(b.booking_date, b.booking_time) || 'Date not set',
  };
}

export default function BookingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('present');
  const [loading, setLoading] = useState(true);

  const [present, setPresent] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [priceFor, setPriceFor] = useState<Booking | null>(null);
  const [priceAmount, setPriceAmount] = useState('');
  // Session id kept in a ref so the realtime handler below can scope
  // incoming bookings without re-subscribing.
  const uidRef = useRef(0);
  // Bumped by pull-to-refresh to re-run the load effect.
  const [reloadTick, setReloadTick] = useState(0);
  // Ref-based double-submit guard: state updates lag a re-render, so rapid
  // taps could fire duplicate POST/PUTs before `busy` ever renders.
  const actionRef = useRef(false);

  /** Merge a server response into whichever tab holds the booking. */
  function applyUpdate(b: BookingResponse) {
    const item = toBookingItem(b, Number(b.user_id))!;
    setPresent((rs) => rs.map((x) => (x.id === item.id ? item : x)));
    setPast((rs) => rs.map((x) => (x.id === item.id ? item : x)));
  }

  async function acceptPrice(b: Booking) {
    if (actionRef.current) return;
    actionRef.current = true;
    try {
      const updated: BookingResponse = await expectJson(
        await authFetch(`/bookings/${b.id}/accept-price`, { method: 'POST' }),
        'Could not accept the price',
      );
      applyUpdate(updated);
      Alert.alert('Price agreed ✓', `Both sides agreed on ₹${Number(updated.final_price)}.`);
    } catch (e: any) {
      Alert.alert('Could not accept', e?.message || 'Please try again.');
    } finally {
      actionRef.current = false;
    }
  }

  async function proposePrice() {
    if (!priceFor || actionRef.current) return;
    const amt = Number(priceAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Price', 'Please enter a valid amount in ₹');
      return;
    }
    const b = priceFor;
    actionRef.current = true;
    try {
      const updated: BookingResponse = await expectJson(
        await authFetch(`/bookings/${b.id}/propose-price`, {
          method: 'POST',
          json: { amount: amt },
        }),
        'Could not send the offer',
      );
      applyUpdate(updated);
      setPriceFor(null);
      setPriceAmount('');
      Alert.alert(
        'Offer sent',
        `₹${amt} sent to ${b.worker.full_name || 'the worker'} — you'll be notified when they respond.`,
      );
    } catch (e: any) {
      Alert.alert('Offer not sent', e?.message || 'Could not send the offer. Please try again.');
    } finally {
      actionRef.current = false;
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
      uidRef.current = uid;
      try {
        // The backend embeds worker details on each booking, so one request is enough.
        // limit=100 — the default 20 silently truncates long histories.
        const bookingsList: BookingResponse[] = await expectJson(
          await authFetch('/bookings?limit=100'),
          'Could not load your bookings',
        );

        const realPresent: Booking[] = [];
        const realPast: Booking[] = [];

        bookingsList.forEach((b) => {
          const bookingItem = toBookingItem(b, uid);
          if (!bookingItem) return;
          // Present = an upcoming slot that hasn't happened yet.
          // Past = the scheduled time has passed OR it reached a terminal
          // state. We keep the real status label (pending/upcoming/rejected/
          // completed) so a never-accepted booking still shows as Pending.
          const isPast = isBookingDateTimePast(b.booking_date, b.booking_time) || !isActiveStatus(bookingItem.status);
          if (isPast) {
            realPast.push(bookingItem);
          } else {
            realPresent.push(bookingItem);
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
  }, [reloadTick]);

  // Realtime: when the worker accepts/completes/rejects or the price moves,
  // the server pushes 'booking_status_changed'. Refetch that one booking
  // (participant-scoped) and merge it, so the list updates live instead of
  // sitting stale until the screen is reopened.
  useEffect(() => {
    let cancelled = false;
    let offStatus: (() => void) | undefined;
    (async () => {
      // ensureSocket() is async — register listeners only once it exists.
      await ensureSocket();
      if (cancelled) return;
      offStatus = onBookingStatusChanged((data) => {
        void (async () => {
          try {
            const updated: BookingResponse = await expectJson(
              await authFetch(`/bookings/${data.booking_id}`),
              'Could not refresh the booking',
            );
            const item = toBookingItem(updated, uidRef.current);
            if (!item) return;
            const active = isActiveStatus(item.status);
            // Present holds active bookings; terminal ones move to Past.
            setPresent((rs) =>
              !rs.some((x) => x.id === item.id)
                ? rs
                : active
                  ? rs.map((x) => (x.id === item.id ? item : x))
                  : rs.filter((x) => x.id !== item.id),
            );
            setPast((rs) => {
              if (!rs.some((x) => x.id === item.id)) return active ? [...rs, item] : rs;
              return active
                ? rs.filter((x) => x.id !== item.id)
                : rs.map((x) => (x.id === item.id ? item : x));
            });
          } catch {}
        })();
      });
    })();
    return () => {
      cancelled = true;
      offStatus?.();
    };
  }, []);

  const data = tab === 'present' ? present : past;

  /** Title of the offer modal depends on where the negotiation stands. */
  const priceModalTitle = !priceFor
    ? ''
    : priceFor.estimated_price > 0 && priceFor.price_proposed_by === 'worker'
      ? 'Counter-offer'
      : priceFor.estimated_price > 0
        ? 'Change your offer'
        : 'Propose your price';

  /** The price-negotiation panel under each active booking card. */
  function renderPricePanel(b: Booking) {
    // Agreed & locked — nothing more to do here.
    if (b.final_price > 0) {
      return (
        <View style={styles.agreedRow}>
          <Ionicons name="checkmark-circle" size={14} color="#10b981" />
          <Text style={styles.agreedText}>Agreed · ₹{b.final_price}</Text>
        </View>
      );
    }
    // The worker quoted — accept it or counter.
    if (b.estimated_price > 0 && b.price_proposed_by === 'worker') {
      return (
        <View style={styles.quoteCard}>
          <View style={styles.quoteHead}>
            <Ionicons name="pricetag" size={13} color="#6F42C1" />
            <Text style={styles.quoteText} numberOfLines={1}>
              {b.worker.full_name || 'Worker'} quoted ₹{b.estimated_price}
            </Text>
          </View>
          <View style={styles.quoteActions}>
            <TouchableOpacity
              style={styles.acceptQuoteBtn}
              onPress={(e) => { e.stopPropagation?.(); acceptPrice(b); }}
            >
              <Ionicons name="checkmark" size={13} color="#fff" />
              <Text style={styles.acceptQuoteText}>Accept ₹{b.estimated_price}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={(e) => { e.stopPropagation?.(); setPriceAmount(''); setPriceFor(b); }}
            >
              <Text style={styles.counterText}>Counter</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    // Our own offer is on the table — waiting for the worker.
    if (b.estimated_price > 0) {
      return (
        <TouchableOpacity
          style={styles.waitingRow}
          onPress={(e) => { e.stopPropagation?.(); setPriceAmount(String(b.estimated_price)); setPriceFor(b); }}
        >
          <Ionicons name="time" size={13} color="#f59e0b" />
          <Text style={styles.waitingText} numberOfLines={1}>
            You offered ₹{b.estimated_price} · waiting for reply
          </Text>
        </TouchableOpacity>
      );
    }
    // No price yet — open with a budget.
    return (
      <TouchableOpacity
        style={styles.priceBtn}
        onPress={(e) => { e.stopPropagation?.(); setPriceAmount(''); setPriceFor(b); }}
      >
        <Ionicons name="pricetag-outline" size={13} color="#6F42C1" />
        <Text style={styles.priceBtnText}>Propose your price</Text>
      </TouchableOpacity>
    );
  }

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
          {tab === 'present' && b.status !== 'rejected' && renderPricePanel(b)}
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
          <ScrollView
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={() => setReloadTick((t) => t + 1)} tintColor="#6F42C1" />
            }
          >
            {data.length === 0 ? (
              <Text style={styles.placeholder}>No bookings here yet</Text>
            ) : (
              data.map(renderCard)
            )}
          </ScrollView>
        )}
      </View>
      <FrameModal visible={!!priceFor} animationType="fade" onRequestClose={() => setPriceFor(null)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior="padding" style={styles.priceKav}>
            <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{priceModalTitle}</Text>
            {priceFor && (
              <Text style={styles.modalSub}>With {priceFor.worker.full_name || 'worker'} · {priceFor.date}</Text>
            )}
            {priceFor && priceFor.estimated_price > 0 && (
              <Text style={styles.modalHint}>
                Currently on the table: ₹{priceFor.estimated_price}
                {priceFor.price_proposed_by === 'worker' ? ' (worker’s quote)' : ' (your offer)'}
              </Text>
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
              <TouchableOpacity style={[styles.modalBtn, styles.modalSave]} onPress={proposePrice}>
                <Text style={styles.modalSaveText}>Send Offer</Text>
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </FrameModal>

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

  // --- price negotiation panel ---
  agreedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  agreedText: { color: '#10b981', fontWeight: '800', fontSize: 12 },
  quoteCard: { marginTop: 8, backgroundColor: '#f5f0fb', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#e6dbf5' },
  quoteHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quoteText: { fontSize: 12, fontWeight: '700', color: '#4c1d95', flex: 1 },
  quoteActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  acceptQuoteBtn: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: '#10b981' },
  acceptQuoteText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  counterBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#6F42C1', backgroundColor: '#fff' },
  counterText: { color: '#6F42C1', fontWeight: '800', fontSize: 11 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, backgroundColor: '#fffbeb', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: '#fde68a' },
  waitingText: { color: '#b45309', fontWeight: '700', fontSize: 11, flex: 1 },
  priceBtn: { marginTop: 8, flexDirection: 'row', paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#6F42C1', backgroundColor: '#f5f0fb', alignItems: 'center', justifyContent: 'center', gap: 4 },
  priceBtnText: { color: '#6F42C1', fontWeight: '800', fontSize: 11 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  priceKav: { width: '100%', maxWidth: 320, justifyContent: 'center' },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#333', textAlign: 'center' },
  modalSub: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 4 },
  modalHint: { fontSize: 11, color: '#6F42C1', textAlign: 'center', marginTop: 6, fontWeight: '600' },
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
