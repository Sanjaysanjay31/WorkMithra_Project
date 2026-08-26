import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import FrameModal from '@/components/frame-modal';
import { authFetch, expectJson } from '@/lib/api';
import { isActiveStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { formatBookingDateTime, isBookingDateTimePast } from '@/lib/format';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { ensureSocket, onBookingRequest, onBookingStatusChanged } from '@/lib/socket';
import { BookingResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Tab = 'pending' | 'accepted';

type Request = {
  id: string;
  client_id: string;
  client: string;
  avatar?: string;
  job: string;
  date: string;
  /** Display amount: agreed price once locked, else the current proposal. */
  price: number;
  estimated_price: number;
  final_price: number;
  price_proposed_by: 'user' | 'worker' | null;
  status: 'pending' | 'accepted';
};

/** Shape server bookings into inbox rows (active, non-past requests only). */
function mapRequests(data: BookingResponse[]): Request[] {
  // Client name/avatar come embedded on each booking — no extra requests.
  return data
    .map((b) => {
      const info = b.user;
      const status = normalizeBookingStatus(b.status);
      const estimated = Number(b.estimated_price ?? 0);
      const final = Number(b.final_price ?? 0);
      return {
        booking: b,
        canonical: status,
        item: {
          id: String(b.id),
          client_id: String(b.user_id),
          client: info?.full_name || `User ${b.user_id}`,
          avatar: info?.profile_image || undefined,
          job: b.problem_description || 'General Service',
          date: formatBookingDateTime(b.booking_date, b.booking_time) || 'Date not set',
          estimated_price: estimated,
          final_price: final,
          price_proposed_by: b.price_proposed_by ?? null,
          price: final || estimated,
          // This inbox shows active requests only: pending, or accepted (upcoming).
          status: (status === 'upcoming' ? 'accepted' : 'pending') as 'pending' | 'accepted',
        },
      };
    })
    // The inbox holds actionable requests only: an active status AND a
    // scheduled slot that hasn't passed yet. Once the time is gone a
    // request can no longer be accepted/declined, so it drops out of the
    // inbox (completed work still shows on the dashboard history).
    .filter(
      (row) =>
        isActiveStatus(row.canonical) &&
        !isBookingDateTimePast(row.booking.booking_date, row.booking.booking_time),
    )
    .map((row) => row.item);
}

export default function WorkerBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pending');
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoteFor, setQuoteFor] = useState<Request | null>(null);
  const [quoteAmount, setQuoteAmount] = useState('');
  // Ref-based double-submit guard — state lags a re-render, so rapid taps
  // could fire duplicate PUTs before any `busy` flag renders.
  const actionRef = useRef(false);
  // Restored session id; '' until storage resolves (or when logged out).
  const [uid, setUid] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const authRaw = await storage.get('workmithra:auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          if (auth.id) setUid(String(auth.id));
        }
      } catch {}
    })();
  }, []);

  /** Fetch the inbox. silent=true refreshes without the spinner/alerts —
   * used by realtime updates so the UI never flashes mid-scroll. */
  const loadRequests = useCallback(async (workerId: string, silent = false) => {
    if (!workerId) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      // The worker's token scopes this list to their own bookings.
      // limit=100 — the default 20 silently truncates a busy inbox.
      const data: BookingResponse[] = await expectJson(
        await authFetch('/bookings?limit=100'),
        'Could not load booking requests',
      );
      setRequests(mapRequests(data));
    } catch (e: any) {
      console.warn('Failed to fetch requests', e);
      if (!silent) {
        Alert.alert('Booking requests', e?.message || 'Could not load booking requests. Reopen to retry.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests(uid);
  }, [loadRequests, uid]);

  // Realtime: a new request pushed by the server refreshes the inbox, and
  // status/price changes merge into the visible cards — the list no longer
  // goes stale while the screen sits open.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    let offRequest: (() => void) | undefined;
    let offStatus: (() => void) | undefined;
    (async () => {
      // ensureSocket() is async — listeners can only be registered after
      // the socket exists, otherwise they silently no-op.
      await ensureSocket();
      if (cancelled) return;
      offRequest = onBookingRequest(() => {
        void loadRequests(uid, true);
      });
      offStatus = onBookingStatusChanged((data) => {
        setRequests((rs) => {
          const row = rs.find((r) => r.id === String(data.booking_id));
          if (!row) return rs;
          // A terminal status means the request is no longer actionable.
          if (data.status && !isActiveStatus(normalizeBookingStatus(data.status))) {
            return rs.filter((r) => r.id !== String(data.booking_id));
          }
          const estimated = Number(data.estimated_price ?? row.estimated_price);
          const final = Number(data.final_price ?? row.final_price);
          return rs.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  estimated_price: estimated,
                  final_price: final,
                  price_proposed_by: data.price_proposed_by ?? r.price_proposed_by,
                  price: final || estimated,
                }
              : r,
          );
        });
      });
    })();
    return () => {
      cancelled = true;
      offRequest?.();
      offStatus?.();
    };
  }, [loadRequests, uid]);

  const filtered = requests.filter((r) => r.status === tab);

  /** Merge a server response into the inbox list. */
  function applyUpdate(b: BookingResponse) {
    const estimated = Number(b.estimated_price ?? 0);
    const final = Number(b.final_price ?? 0);
    setRequests((rs) =>
      rs.map((x) =>
        x.id === String(b.id)
          ? { ...x, estimated_price: estimated, final_price: final, price_proposed_by: b.price_proposed_by ?? null, price: final || estimated }
          : x,
      ),
    );
  }

  async function updateStatus(id: string, action: 'accepted' | 'declined') {
    if (actionRef.current) return;
    const r = requests.find((x) => x.id === id);
    if (!r) return;
    actionRef.current = true;

    const backendStatus = action === 'accepted' ? 'upcoming' : 'rejected';
    try {
      await expectJson(
        await authFetch(`/bookings/${id}`, {
          method: 'PUT',
          json: { status: backendStatus },
        }),
        action === 'accepted' ? 'Could not accept the booking' : 'Could not decline the booking',
      );
    } catch (e: any) {
      Alert.alert('Update failed', e?.message || 'Could not update the booking. Please try again.');
      return;
    } finally {
      actionRef.current = false;
    }

    // Update the UI only after the server confirmed the change. A declined
    // booking is no longer active, so it leaves the inbox entirely.
    if (action === 'accepted') {
      setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, status: 'accepted' } : x)));
    } else {
      setRequests((rs) => rs.filter((x) => x.id !== id));
    }

    // No client-side notification POST here: the backend persists and pushes
    // the accepted/declined notification itself, so it also reaches a client
    // who was offline at this moment (and can't be double-sent if this app
    // is killed right after the tap).
  }

  async function acceptPrice(r: Request) {
    if (actionRef.current) return;
    actionRef.current = true;
    try {
      const updated: BookingResponse = await expectJson(
        await authFetch(`/bookings/${r.id}/accept-price`, { method: 'POST' }),
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

  async function submitQuote() {
    if (!quoteFor || actionRef.current) return;
    const amt = Number(quoteAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Quote', 'Please enter a valid amount in ₹');
      return;
    }
    const r = quoteFor;
    actionRef.current = true;
    try {
      const updated: BookingResponse = await expectJson(
        await authFetch(`/bookings/${r.id}/propose-price`, {
          method: 'POST',
          json: { amount: amt },
        }),
        'Could not send the quote',
      );
      // The server notifies the client about the quote — no client-side
      // notification here, that would duplicate the message.
      applyUpdate(updated);
    } catch (e: any) {
      Alert.alert('Quote not sent', e?.message || 'Could not send the quote. Please try again.');
      return;
    } finally {
      actionRef.current = false;
    }

    setQuoteFor(null);
    setQuoteAmount('');
    Alert.alert('Quote sent', `₹${amt} sent to ${r.client}.`);
  }

  function openClient(r: Request) {
    router.push({ pathname: '/user_profile', params: { clientId: r.client_id, clientName: r.client } });
  }

  /** Title of the quote modal depends on where the negotiation stands. */
  const quoteModalTitle = !quoteFor
    ? ''
    : quoteFor.estimated_price > 0 && quoteFor.price_proposed_by === 'user'
      ? 'Counter-offer'
      : quoteFor.estimated_price > 0
        ? 'Update your quote'
        : 'Send price quote';

  /** The price-negotiation panel on each request card. */
  function renderPricePanel(r: Request) {
    // Agreed & locked — nothing more to do here.
    if (r.final_price > 0) {
      return (
        <View style={styles.agreedRow}>
          <Ionicons name="checkmark-circle" size={13} color="#10b981" />
          <Text style={styles.agreedTag}>Agreed · ₹{r.final_price}</Text>
        </View>
      );
    }
    // The client put a number on the table — accept it or counter.
    if (r.estimated_price > 0 && r.price_proposed_by === 'user') {
      return (
        <View style={styles.quoteCard}>
          <View style={styles.quoteHead}>
            <Ionicons name="pricetag" size={13} color="#6F42C1" />
            <Text style={styles.quoteText} numberOfLines={1}>{r.client} proposed ₹{r.estimated_price}</Text>
          </View>
          <View style={styles.quoteActions}>
            <TouchableOpacity
              style={styles.acceptQuoteBtn}
              onPress={(e) => { e.stopPropagation?.(); acceptPrice(r); }}
            >
              <Ionicons name="checkmark" size={13} color="#fff" />
              <Text style={styles.acceptQuoteText}>Accept ₹{r.estimated_price}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={(e) => { e.stopPropagation?.(); setQuoteAmount(''); setQuoteFor(r); }}
            >
              <Text style={styles.counterText}>Counter</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    // Our own quote is on the table — waiting for the client.
    if (r.estimated_price > 0) {
      return (
        <TouchableOpacity
          style={styles.waitingRow}
          onPress={(e) => { e.stopPropagation?.(); setQuoteAmount(String(r.estimated_price)); setQuoteFor(r); }}
        >
          <Ionicons name="time" size={13} color="#f59e0b" />
          <Text style={styles.waitingText} numberOfLines={1}>
            You quoted ₹{r.estimated_price} · waiting for client
          </Text>
        </TouchableOpacity>
      );
    }
    // No price yet — open with a quote.
    return (
      <TouchableOpacity
        style={styles.quoteBtn}
        onPress={(e) => { e.stopPropagation?.(); setQuoteAmount(r.price > 0 ? String(r.price) : ''); setQuoteFor(r); }}
      >
        <Ionicons name="pricetag-outline" size={13} color="#6F42C1" />
        <Text style={styles.quoteBtnText}>Send Quote</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>Booking Requests</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'pending' && styles.tabBtnActive]} onPress={() => setTab('pending')}>
            <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>Pending</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'accepted' && styles.tabBtnActive]} onPress={() => setTab('accepted')}>
            <Text style={[styles.tabText, tab === 'accepted' && styles.tabTextActive]}>Accepted</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color="#6F42C1" style={{ marginTop: 30 }} />
          ) : filtered.length === 0 ? (
            <Text style={styles.empty}>No {tab} requests</Text>
          ) : (
            filtered.map((r) => (
              <TouchableOpacity key={r.id} style={styles.card} activeOpacity={0.85} onPress={() => openClient(r)}>
                <View style={styles.leftCol}>
                  <Avatar uri={r.avatar} name={r.client} size={60} style={styles.avatar} />
                </View>
                <View style={styles.rightCol}>
                  <View style={styles.headerRow}>
                    <Text style={styles.client} numberOfLines={1}>{r.client}</Text>
                    <Ionicons name="chevron-forward" size={16} color="#999" />
                  </View>
                  <Text style={styles.job} numberOfLines={1}>{r.job}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.dateRow}>
                      <Ionicons name="calendar-outline" size={11} color="#888" />
                      <Text style={styles.date}>{r.date}</Text>
                    </View>
                    <Text style={styles.price}>{r.price > 0 ? `₹${r.price}` : 'Quote pending'}</Text>
                  </View>

                  {renderPricePanel(r)}

                  {r.status === 'pending' ? (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.acceptBtn, r.price <= 0 && { opacity: 0.5 }]}
                        disabled={r.price <= 0}
                        onPress={(e) => { e.stopPropagation?.(); updateStatus(r.id, 'accepted'); }}
                      >
                        <Ionicons name="checkmark" size={13} color="#fff" />
                        <Text style={styles.acceptText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.declineBtn]}
                        onPress={(e) => { e.stopPropagation?.(); updateStatus(r.id, 'declined'); }}
                      >
                        <Ionicons name="close" size={13} color="#666" />
                        <Text style={styles.declineText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.acceptedRow}>
                      <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                      <Text style={styles.acceptedTag}>Accepted</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
      <FrameModal visible={!!quoteFor} animationType="fade" onRequestClose={() => setQuoteFor(null)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior="padding" style={styles.quoteKav}>
            <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{quoteModalTitle}</Text>
            {quoteFor && (
              <Text style={styles.modalSub}>To {quoteFor.client} · {quoteFor.job}</Text>
            )}
            {quoteFor && quoteFor.estimated_price > 0 && (
              <Text style={styles.modalHint}>
                Currently on the table: ₹{quoteFor.estimated_price}
                {quoteFor.price_proposed_by === 'user' ? ' (client’s proposal)' : ' (your quote)'}
              </Text>
            )}
            <View style={styles.amountRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={styles.amountInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
                value={quoteAmount}
                onChangeText={setQuoteAmount}
                autoFocus
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setQuoteFor(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSend]} onPress={submitQuote}>
                <Text style={styles.modalSendText}>Send Offer</Text>
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </FrameModal>

      <BottomNav currentRoute="requests" role="worker" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 14 },
  title: { fontSize: 19, fontWeight: '800', color: '#333', marginBottom: 12, textAlign: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 14 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },

  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#eee', ...platformShadow('0px 1px 4px rgba(0,0,0,0.06)', '#000', 0, 1, 0.06, 2, 1) },
  leftCol: { width: 64, alignItems: 'center', justifyContent: 'flex-start' },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#e9ecef' },
  rightCol: { flex: 1, paddingLeft: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  client: { fontSize: 14, fontWeight: '800', color: '#222', flex: 1 },
  job: { fontSize: 12, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  date: { fontSize: 11, color: '#888' },
  price: { fontSize: 13, fontWeight: '800', color: '#10b981' },

  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 8, gap: 4 },
  acceptBtn: { backgroundColor: '#10b981' },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  declineBtn: { backgroundColor: '#f0f0f0' },
  declineText: { color: '#666', fontWeight: '700', fontSize: 11 },
  acceptedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  acceptedTag: { color: '#10b981', fontWeight: '800', fontSize: 12 },
  empty: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 24 },

  // --- price negotiation panel ---
  agreedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  agreedTag: { color: '#10b981', fontWeight: '800', fontSize: 12 },
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
  quoteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, marginTop: 8, borderWidth: 1, borderColor: '#6F42C1', backgroundColor: '#f5f0fb' },
  quoteBtnText: { color: '#6F42C1', fontWeight: '800', fontSize: 11 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  quoteKav: { width: '100%', maxWidth: 320, justifyContent: 'center' },
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
  modalSend: { backgroundColor: '#6F42C1' },
  modalSendText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
