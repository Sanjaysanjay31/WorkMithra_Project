import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import FrameModal from '@/components/frame-modal';
import { authFetch, expectJson } from '@/lib/api';
import { BookingStatus, isActiveStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { formatBookingDateTime, isBookingDateTimePast } from '@/lib/format';
import { platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { ensureSocket, onBookingRequest, onBookingStatusChanged } from '@/lib/socket';
import { BookingResponse, ReviewResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Same Present/Past split as the client's bookings screen: Present holds
// actionable requests, Past is the history with completed/not-completed
// outcomes.
type Tab = 'present' | 'past';

type Request = {
  id: string;
  client_id: string;
  client: string;
  avatar?: string;
  job: string;
  date: string;
  booking_date?: string | null;
  booking_time?: string | null;
  /** Display amount: agreed price once locked, else the current proposal. */
  price: number;
  estimated_price: number;
  final_price: number;
  price_proposed_by: 'user' | 'worker' | null;
  /** Canonical lifecycle status from the server. */
  canonical: BookingStatus;
  /** UI action state for present requests: pending or accepted (upcoming). */
  status: 'pending' | 'accepted';
};

/** Shape server bookings into request rows (the full list — Present/Past
 * splitting happens at render time, so live status changes move cards between
 * tabs automatically). */
function mapRequests(data: BookingResponse[]): Request[] {
  // Client name/avatar come embedded on each booking — no extra requests.
  return data.map((b) => {
    const info = b.user;
    const status = normalizeBookingStatus(b.status);
    const estimated = Number(b.estimated_price ?? 0);
    const final = Number(b.final_price ?? 0);
    return {
      id: String(b.id),
      client_id: String(b.user_id),
      client: info?.full_name || `User ${b.user_id}`,
      avatar: info?.profile_image || undefined,
      job: b.problem_description || 'General Service',
      date: formatBookingDateTime(b.booking_date, b.booking_time) || 'Date not set',
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      estimated_price: estimated,
      final_price: final,
      price_proposed_by: b.price_proposed_by ?? null,
      price: final || estimated,
      canonical: status,
      status: (status === 'upcoming' ? 'accepted' : 'pending') as 'pending' | 'accepted',
    };
  });
}

/** Same Present/Past rule as the client's bookings: a request is past once
 * its slot has gone by OR it reached a terminal state. */
function isPastRequest(r: Request): boolean {
  return !isActiveStatus(r.canonical) || isBookingDateTimePast(r.booking_date, r.booking_time);
}

/** Status pill colors/labels — mirrors the client's bookings screen, phrased
 * from the worker's side. The Past tab describes OUTCOMES ("Not completed",
 * "Not accepted") rather than still-open states. */
function statusColor(r: Request, isPast: boolean) {
  if (r.canonical === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (r.canonical === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  if (isPast) {
    if (r.canonical === 'pending') return { bg: '#f3f4f6', fg: '#6b7280', label: '✗ Not accepted' };
    return { bg: '#ffedd5', fg: '#9a3412', label: '⏱ Not completed' };
  }
  if (r.canonical === 'pending') return { bg: '#fef3c7', fg: '#92400e', label: '⏳ Pending' };
  return { bg: '#dbeafe', fg: '#1e40af', label: '✓ Accepted' };
}

export default function WorkerBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('present');
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load is NOT an empty inbox — render it distinctly with a retry.
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quoteFor, setQuoteFor] = useState<Request | null>(null);
  const [quoteAmount, setQuoteAmount] = useState('');
  // Ref-based double-submit guard — state lags a re-render, so rapid taps
  // could fire duplicate PUTs before any `busy` flag renders.
  const actionRef = useRef(false);
  // Restored session id; '' until storage resolves (or when logged out).
  const [uid, setUid] = useState('');
  // Booking ids this worker has ALREADY reviewed — the Past tab swaps the
  // "Review client" button for "View my rating" on those jobs.
  const [reviewedBookings, setReviewedBookings] = useState<Set<string>>(new Set());

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
        await authFetch('/bookings/?limit=100'),
        'Could not load booking requests',
      );
      setRequests(mapRequests(data));
      setLoadError(false);

      // Reviews THIS worker wrote — a completed job that already has one
      // shows "View my rating" instead of "Review client". Failure here only
      // costs the button label, so it must not fail the inbox load.
      try {
        const myReviews: ReviewResponse[] = await expectJson(
          await authFetch('/reviews/?mine=true'),
          'Could not load your reviews',
        );
        setReviewedBookings(
          new Set(myReviews.map((r) => (r.booking_id != null ? String(r.booking_id) : '')).filter(Boolean)),
        );
      } catch {}
    } catch (e: any) {
      console.warn('Failed to fetch requests', e);
      // Only a loud failure sets the error state; silent (realtime) refreshes
      // must not flip a good inbox into an error screen on a blip.
      if (!silent) setLoadError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Focus-driven refresh: the bottom nav PUSHES screens and back pops them,
  // so this inbox stays mounted while the client's status changes land — and
  // a worker returning here after completing a job elsewhere sees fresh data.
  // First load shows the spinner; re-focus refreshes silently.
  const hasLoadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const silent = hasLoadedRef.current;
      hasLoadedRef.current = true;
      void loadRequests(uid, silent);
    }, [loadRequests, uid]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests(uid, true);
    setRefreshing(false);
  }, [loadRequests, uid]);

  // Realtime: a new request pushed by the server refreshes the list, and
  // status/price changes refetch+merge the single booking — completed or
  // rejected cards move from Present to Past automatically because the split
  // is derived from each row's canonical status.
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
        void (async () => {
          try {
            const updated: BookingResponse = await expectJson(
              await authFetch(`/bookings/${data.booking_id}`),
              'Could not refresh the booking',
            );
            mergeBooking(updated);
          } catch {}
        })();
      });
    })();
    return () => {
      cancelled = true;
      offRequest?.();
      offStatus?.();
    };
  }, [loadRequests, uid]);

  const present = requests.filter((r) => !isPastRequest(r));
  const past = requests
    .filter(isPastRequest)
    // Newest first in the history tab.
    .sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
  const filtered = tab === 'present' ? present : past;

  /** Merge a full server booking into the list (adds it if new). */
  function mergeBooking(b: BookingResponse) {
    const row = mapRequests([b])[0];
    if (!row) return;
    setRequests((rs) =>
      rs.some((x) => x.id === row.id)
        ? rs.map((x) => (x.id === row.id ? row : x))
        : [...rs, row],
    );
  }

  /** Merge a price-negotiation response into the list. */
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

  async function updateStatus(id: string, action: 'accepted' | 'declined' | 'completed') {
    if (actionRef.current) return;
    const r = requests.find((x) => x.id === id);
    if (!r) return;
    actionRef.current = true;

    const backendStatus =
      action === 'accepted' ? 'upcoming' : action === 'completed' ? 'completed' : 'rejected';
    const errLabel =
      action === 'accepted'
        ? 'Could not accept the booking'
        : action === 'completed'
          ? 'Could not mark the job completed'
          : 'Could not decline the booking';
    try {
      await expectJson(
        await authFetch(`/bookings/${id}`, {
          method: 'PUT',
          json: { status: backendStatus },
        }),
        errLabel,
      );
    } catch (e: any) {
      Alert.alert('Update failed', e?.message || 'Could not update the booking. Please try again.');
      return;
    } finally {
      actionRef.current = false;
    }

    // Update the UI only after the server confirmed the change. Accepting
    // flips the action state; declining/completing updates the canonical
    // status, which moves the card out of Present into the Past tab (the
    // split is derived from status — completed work stays visible there with
    // its outcome, and on the dashboard history).
    if (action === 'accepted') {
      setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, status: 'accepted', canonical: 'upcoming' } : x)));
    } else {
      const canonical: BookingStatus = action === 'completed' ? 'completed' : 'rejected';
      setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, canonical } : x)));
    }

    if (action === 'completed') {
      // The backend settles the final price, records job history, bumps the
      // worker's stats, and notifies the client ("Leave a review") — the
      // review itself is written on the client's profile page.
      Alert.alert(
        'Job completed 🎉',
        `${r.client} can now leave you a review — and you can review ${r.client} too.`,
        [
          {
            text: 'Review client',
            onPress: () =>
              router.push({
                pathname: '/user_profile',
                params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
              }),
          },
          { text: 'Later' },
        ],
      );
    }

    // No client-side notification POST here: the backend persists and pushes
    // the accepted/declined/completed notification itself, so it also reaches
    // a client who was offline at this moment (and can't be double-sent if
    // this app is killed right after the tap).
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
        <Text style={styles.title}>My Requests</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'present' && styles.tabBtnActive]} onPress={() => setTab('present')}>
            <Text style={[styles.tabText, tab === 'present' && styles.tabTextActive]}>Present Requests</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'past' && styles.tabBtnActive]} onPress={() => setTab('past')}>
            <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>Past Requests</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6F42C1']} tintColor="#6F42C1" />
          }
        >
          {loading ? (
            <ActivityIndicator color="#6F42C1" style={{ marginTop: 30 }} />
          ) : loadError && requests.length === 0 ? (
            <View style={styles.errorBox}>
              <Ionicons name="cloud-offline-outline" size={36} color="#ccc" />
              <Text style={styles.errorText}>Couldn&apos;t load booking requests.</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void loadRequests(uid)}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filtered.length === 0 ? (
            <Text style={styles.empty}>{tab === 'present' ? 'No present requests' : 'No past requests yet'}</Text>
          ) : (
            filtered.map((r) => {
              const isPast = isPastRequest(r);
              const sc = statusColor(r, isPast);
              return (
              <TouchableOpacity key={r.id} style={styles.card} activeOpacity={0.85} onPress={() => openClient(r)}>
                <View style={styles.leftCol}>
                  <Avatar uri={r.avatar} name={r.client} size={60} style={styles.avatar} />
                </View>
                <View style={styles.rightCol}>
                  <View style={styles.headerRow}>
                    <Text style={styles.client} numberOfLines={1}>{r.client}</Text>
                    <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusText, { color: sc.fg }]}>{sc.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.job} numberOfLines={1}>{r.job}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.dateRow}>
                      <Ionicons name="calendar-outline" size={11} color="#888" />
                      <Text style={styles.date}>{r.date}</Text>
                    </View>
                    <Text style={styles.price}>{r.price > 0 ? `₹${r.price}` : 'Quote pending'}</Text>
                  </View>

                  {!isPast && renderPricePanel(r)}

                  {!isPast && r.status === 'pending' && (
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
                  )}
                  {!isPast && r.status === 'accepted' && (
                    <View style={styles.acceptedActions}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                        <Text style={styles.acceptedTag}>Accepted</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.completeBtn}
                        onPress={(e) => { e.stopPropagation?.(); updateStatus(r.id, 'completed'); }}
                      >
                        <Ionicons name="checkmark-done" size={13} color="#fff" />
                        <Text style={styles.completeText}>Mark Completed</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {isPast && r.canonical === 'completed' && (
                    <TouchableOpacity
                      style={styles.reviewClientBtn}
                      activeOpacity={0.8}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        router.push({
                          pathname: '/user_profile',
                          params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
                        });
                      }}
                    >
                      <Ionicons name={reviewedBookings.has(r.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
                      <Text style={styles.reviewClientText}>{reviewedBookings.has(r.id) ? 'View my rating' : 'Review client'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
              );
            })
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  client: { fontSize: 14, fontWeight: '800', color: '#222', flex: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 10, fontWeight: '800' },
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
  acceptedActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  acceptedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  acceptedTag: { color: '#10b981', fontWeight: '800', fontSize: 12 },
  completeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#6F42C1' },
  completeText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  reviewClientBtn: { marginTop: 8, flexDirection: 'row', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FFB800', backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center', gap: 5 },
  reviewClientText: { color: '#92400e', fontWeight: '800', fontSize: 12 },
  empty: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 24 },
  errorBox: { alignItems: 'center', paddingVertical: 40 },
  errorText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: '#b91c1c', textAlign: 'center' },
  retryBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: '#6F42C1' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 12 },

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
