import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import FrameModal from '@/components/frame-modal';
import RazorpayCheckout from '@/components/RazorpayCheckout';
import { authFetch, expectJson, getAuth, readApiError } from '@/lib/api';
import { BookingStatus, isActiveStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { formatBookingDateTime, isBookingDateTimePast } from '@/lib/format';
import { pickImageWithPreview } from '@/lib/image-picker';
import { platformShadow } from '@/lib/shadow';
import { uploadMultipart } from '@/lib/upload';
import { ensureSocket, onBookingStatusChanged } from '@/lib/socket';
import {
    BookingResponse,
    PaymentOrderResponse,
    PaymentResponse,
    RazorpaySuccessPayload,
    ReviewResponse,
    WorkerBrief,
    WorkReportResponse
} from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    RefreshControl,
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

function statusColor(s: BookingStatus, isPast: boolean, paymentResult?: string) {
  if (s === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (s === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  if (s === 'unpaid') return { bg: '#fee2e2', fg: '#991b1b', label: '⚠ Unpaid' };
  if (s === 'not_completed') return { bg: '#fee2e2', fg: '#991b1b', label: '⏱ Not completed' };
  if (s === 'client_not_completed') return { bg: '#fee2e2', fg: '#991b1b', label: '⏱ Not completed' };
  // Flagged as not done — stays in Present (amber) until the review closes it.
  if (s === 'not_completed_pending_review') return { bg: '#ffedd5', fg: '#9a3412', label: '⏱ Not completed · review pending' };
  if (s === 'work_completed') return { bg: '#dbeafe', fg: '#1e40af', label: '🔧 Work marked complete' };
  if (s === 'work_reported') return { bg: '#ede9fe', fg: '#5b21b6', label: '📋 Work report submitted' };
  if (s === 'client_confirmed') return { bg: '#fef3c7', fg: '#92400e', label: '👁 Work confirmed' };
  // Work report is in, payment open — stays in Present until paid + reviewed
  // (completed) or reported unpaid.
  if (s === 'payment_completed') {
    if (paymentResult === 'success') return { bg: '#d1fae5', fg: '#065f46', label: '💰 Payment done' };
    return { bg: '#d1fae5', fg: '#065f46', label: '💰 Payment completed' };
  }
  if (s === 'payment_proof_submitted') return { bg: '#d1fae5', fg: '#065f46', label: '📤 Proof submitted' };
  if (s === 'awaiting_payment') {
    if (paymentResult === 'success') return { bg: '#dcfce7', fg: '#166534', label: '✅ Paid' };
    if (paymentResult === 'failed') return { bg: '#fee2e2', fg: '#991b1b', label: '❌ Payment failed' };
    return { bg: '#fef3c7', fg: '#92400e', label: '💳 Pay pending' };
  }
  if (isPast) {
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
  // A failed load is NOT an empty history — keep it distinct so the screen
  // shows an error + retry instead of a misleading "No bookings here yet".
  const [loadError, setLoadError] = useState('');

  const [present, setPresent] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  // Booking ids this client has ALREADY reviewed — the Past tab swaps the
  // "Rate worker" button for "View my rating" on those jobs.
  const [reviewedBookings, setReviewedBookings] = useState<Set<string>>(new Set());
  const [priceFor, setPriceFor] = useState<Booking | null>(null);
  const [priceAmount, setPriceAmount] = useState('');
  // Payment chain state for awaiting_payment bookings (ids as strings):
  // which ones are already PAID, and the worker's work report per booking.
  const [paidBookings, setPaidBookings] = useState<Set<string>>(new Set());
  const [workReports, setWorkReports] = useState<Record<string, WorkReportResponse>>({});
  // Set while the Razorpay checkout modal is open (order came from
  // POST /payments/order); cleared on success/dismiss.
  const [checkoutFor, setCheckoutFor] = useState<{ booking: Booking; order: PaymentOrderResponse } | null>(null);
  // Booking id currently opening checkout / verifying — drives the spinner.
  const [payingId, setPayingId] = useState<string>('');
  // Payment-success receipt shown after verify. It STAYS on screen with the
  // transaction id until the user explicitly continues or closes it, so they
  // can take a screenshot for their records (Expo Go cannot capture the
  // screen programmatically, so persistence replaces auto-capture).
  const [paymentReceipt, setPaymentReceipt] = useState<{
    booking: Booking; amount: number; txnId: string;
  } | null>(null);
  // Per-booking payment result: 'success' | 'failed' | null
  const [paymentResults, setPaymentResults] = useState<Record<string, 'success' | 'failed' | 'not_completed'>>({});
  // Full-screen image viewer for work-report / review photos
  const [viewImage, setViewImage] = useState<string | null>(null);
  // Payment proof images (client uploads after successful payment)
  const [proofImages, setProofImages] = useState<Record<string, { url: string; preview: string }[]>>({});
  const [uploadingProof, setUploadingProof] = useState(false);
  // Session id kept in a ref so the realtime handler below can scope
  // incoming bookings without re-subscribing.
  const uidRef = useRef(0);
  // Pull-to-refresh has its own flag so its spinner animates independently of
  // the initial-load spinner.
  const [refreshing, setRefreshing] = useState(false);
  // Ref-based double-submit guard: state updates lag a re-render, so rapid
  // taps could fire duplicate POST/PUTs before `busy` ever renders.
  const actionRef = useRef(false);

  /** Merge a server response into whichever tab holds the booking. */
  function applyUpdate(b: BookingResponse) {
    const item = toBookingItem(b, Number(b.user_id))!;
    setPresent((rs) => rs.map((x) => (x.id === item.id ? item : x)));
    setPast((rs) => rs.map((x) => (x.id === item.id ? item : x)));
  }

  /** Fetch ONE booking's work report (worker-submitted proof photos + note)
   * and merge it into state — used by the realtime handler so newly submitted
   * reports appear without a manual refresh. Missing report (404) is fine. */
  async function fetchWorkReport(bookingId: string) {
    try {
      const rep: WorkReportResponse = await expectJson(
        await authFetch(`/bookings/${bookingId}/work-report`),
        'Could not load the work report',
      );
      if (rep) setWorkReports((prev) => ({ ...prev, [bookingId]: rep }));
    } catch {}
  }

  /** Merge a STATUS change: active bookings stay in Present, terminal ones
   * move to Past — the same rule the realtime handler applies, so a job
   * marked completed from this screen moves tabs immediately. */
  function mergeStatusUpdate(b: BookingResponse) {
    const item = toBookingItem(b, uidRef.current || b.user_id);
    if (!item) return;
    const active = isActiveStatus(item.status);
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
  }

  /** Step 3: Client confirms work after reviewing the report.
   * Moves the booking to client_confirmed, which unlocks the payment. */
  async function confirmWork(b: Booking) {
    if (actionRef.current) return;
    actionRef.current = true;
    try {
      const updated: BookingResponse = await expectJson(
        await authFetch(`/bookings/${b.id}/confirm-work`, { method: 'POST' }),
        'Could not confirm the work',
      );
      applyUpdate(updated);
    } catch (e: any) {
      Alert.alert('Could not confirm', e?.message || 'Please try again.');
    } finally {
      actionRef.current = false;
    }
  }

  /** Open Razorpay checkout (test mode) for an awaiting_payment booking.
   * The backend opens the order for the locked final_price — the client
   * never chooses the amount. */
  async function startPayment(b: Booking) {
    if (actionRef.current) return;
    actionRef.current = true;
    setPayingId(b.id);
    try {
      const order: PaymentOrderResponse = await expectJson(
        await authFetch('/payments/order', {
          method: 'POST',
          json: { booking_id: Number(b.id) },
        }),
        'Could not start the payment',
      );
      setCheckoutFor({ booking: b, order });
    } catch (e: any) {
      Alert.alert('Payment unavailable', e?.message || 'Please try again.');
    } finally {
      actionRef.current = false;
      setPayingId('');
    }
  }

  /** Pick + upload a payment proof image; the returned URL is stored against the booking. */
  async function uploadProofImage(bookingId: string) {
    if (uploadingProof) return;
    if ((proofImages[bookingId]?.length ?? 0) >= 3) {
      Alert.alert('Limit reached', 'You can attach up to 3 payment proof images.');
      return;
    }
    setUploadingProof(true);
    try {
      // Uploads go through uploadMultipart (XHR): global fetch rejects
      // { uri, name, type } parts on native with "Unsupported FormDataPart".
      const picked = await pickImageWithPreview('proof.jpg');
      if (!picked) { setUploadingProof(false); return; }
      const part = picked.part;
      const preview = picked.preview;
      const data = await uploadMultipart<{ url: string }>('/upload-review-image', part);
      setProofImages((prev) => ({
        ...prev,
        [bookingId]: [...(prev[bookingId] ?? []), { url: data.url, preview }],
      }));
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload the proof image');
    } finally {
      setUploadingProof(false);
    }
  }

  /** Submit payment proof images to the backend after successful payment.
   * On success, refetch the booking so the status moves to
   * `payment_proof_submitted` and the "Rate worker to complete" button
   * becomes active (the rate button is gated on that exact status — without
   * the refetch, the screen would still show the proof-upload UI and the
   * rate action would never appear). */
  async function submitPaymentProof(bookingId: string) {
    const images = proofImages[bookingId];
    if (!images || images.length === 0) return;
    try {
      for (const img of images) {
        await authFetch(`/payments/${bookingId}/proof`, {
          method: 'PATCH',
          json: { payment_proof_image: img.url },
        });
      }
      // Mark the proof as accepted locally so the success branch of the
      // rate-panel renders immediately, even before the refetch returns.
      setPaymentResults((prev) => ({ ...prev, [bookingId]: 'success' }));
      try {
        const res = await authFetch(`/bookings/${bookingId}`);
        if (res.ok) {
          const fresh: BookingResponse = await res.json();
          applyUpdate(fresh);
        }
      } catch {}
      Alert.alert('Proof uploaded', 'Your payment proof has been submitted.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not save payment proof.');
    }
  }

  /** Razorpay Checkout succeeded — verify the signature server-side before
   * celebrating; only the backend can accept the payment. */
  async function handlePaymentSuccess(payload: RazorpaySuccessPayload) {
    const ctx = checkoutFor;
    setCheckoutFor(null);
    if (!ctx) return;
    setPayingId(ctx.booking.id);
    try {
      const payment: PaymentResponse = await expectJson(
        await authFetch('/payments/verify', {
          method: 'POST',
          json: { booking_id: Number(ctx.booking.id), ...payload },
        }),
        'Could not confirm the payment',
      );
      setPaidBookings((s) => new Set(s).add(ctx.booking.id));
      setPaymentResults((prev) => ({ ...prev, [ctx.booking.id]: 'success' }));
      // Persistent receipt (not an auto-dismissing alert): shows the verified
      // transaction id and stays until the user continues or closes it.
      setPaymentReceipt({
        booking: ctx.booking,
        amount: Number(payment.amount ?? ctx.booking.final_price ?? ctx.booking.amount ?? 0),
        txnId: payment.transaction_id || payment.razorpay_payment_id || payload.razorpay_payment_id || '',
      });
    } catch (e: any) {
      setPaymentResults((prev) => ({ ...prev, [ctx.booking.id]: 'failed' }));
      Alert.alert(
        'Payment verification failed',
        `${e?.message || 'Please try again.'} If any amount was deducted, Razorpay refunds failed test payments automatically.`,
      );
    } finally {
      setPayingId('');
    }
  }

  async function markNotCompleted(id: string) {
    Alert.alert(
      'Mark as not completed?',
      'The worker will be notified. You then submit your review (photos optional) — the booking moves to Past once the review is done.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: async () => {
            try {
              // work_reported -> use confirm-not-completed (client reviewed report, not happy)
              // other statuses -> use mark-incomplete
              const b = present.find((x) => x.id === id) || past.find((x) => x.id === id);
              const endpoint = b?.status === 'work_reported'
                ? `/bookings/${id}/confirm-not-completed`
                : `/bookings/${id}/mark-incomplete`;
              const res = await authFetch(endpoint, { method: 'POST' });
              if (res.ok) {
                setPaymentResults((p) => ({ ...p, [id]: 'not_completed' }));
                void loadBookings(false);
                // The booking is now pending-review (still in Present) — walk
                // the client straight into the review form, which finalizes it.
                Alert.alert(
                  'Marked as not completed ⏱',
                  'Submit your review to finish — the booking moves to Past once the review is done.',
                  [
                    { text: 'Later', style: 'cancel' },
                    {
                      text: 'Review to finish',
                      onPress: () => {
                        if (b) {
                          router.push({
                            pathname: '/worker_info',
                            params: { id: String(b.worker.id), tab: 'reviews', booking: id },
                          });
                        }
                      },
                    },
                  ],
                );
              } else {
                const data = await res.json().catch(() => ({}));
                Alert.alert('Error', data?.detail || 'Could not mark as not completed.');
              }
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Something went wrong.');
            }
          },
        },
      ],
    );
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

  /** Fetch bookings. silent=true (re-focus / pull-to-refresh) keeps the
   * current list on screen instead of swapping it for a spinner. */
  const loadBookings = useCallback(async (silent: boolean) => {
    let uid = uidRef.current;
    if (!uid) {
      try {
        const auth = await getAuth();
        if (auth?.id) uid = Number(auth.id);
      } catch {}
      uidRef.current = uid;
    }
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      // The backend embeds worker details on each booking, so one request is enough.
      // limit=100 — the default 20 silently truncates long histories.
      const bookingsList: BookingResponse[] = await expectJson(
        await authFetch('/bookings/?limit=100'),
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
        const isPast = !isActiveStatus(bookingItem.status);
        if (isPast) {
          realPast.push(bookingItem);
        } else {
          realPresent.push(bookingItem);
        }
      });

      setPresent(realPresent);
      setPast(realPast);

      // Reviews THIS client wrote — a completed booking that already has one
      // shows "View my rating" instead of "Rate worker". Failure here only
      // costs the button label, so it must not fail the bookings load.
      try {
        const myReviews: ReviewResponse[] = await expectJson(
          await authFetch('/reviews/?mine=true'),
          'Could not load your reviews',
        );
        setReviewedBookings(
          new Set(myReviews.map((r) => (r.booking_id != null ? String(r.booking_id) : '')).filter(Boolean)),
        );
      } catch {}

      // Payment state + work reports for jobs in the workflow where the client
      // needs to take action — PLUS terminal states (completed/rated/…) so the
      // worker's work-proof photos stay visible in Past, not just in Present.
      // Failures only cost the pay panel (it re-loads on the next
      // focus/refresh), so they must not fail the bookings load.
      const actionStatuses = ['work_completed', 'work_reported', 'client_confirmed', 'payment_completed', 'payment_proof_submitted', 'awaiting_payment', 'rated', 'completed', 'not_completed', 'client_not_completed', 'not_completed_pending_review'];
      const needsAction = bookingsList.filter((b) => actionStatuses.includes(normalizeBookingStatus(b.status)));
      const paidSet = new Set<string>();
      const reports: Record<string, WorkReportResponse> = {};
      await Promise.all(
        needsAction.map(async (b) => {
          try {
            const pay: PaymentResponse | null = await expectJson(
              await authFetch(`/payments/booking/${b.id}`),
              'Could not load payment status',
            );
            if (pay && pay.payment_status === 'paid') paidSet.add(String(b.id));
          } catch {}
          try {
            const rep: WorkReportResponse = await expectJson(
              await authFetch(`/bookings/${b.id}/work-report`),
              'Could not load the work report',
            );
            if (rep) reports[String(b.id)] = rep;
          } catch {}
        }),
      );
      setPaidBookings(paidSet);
      setWorkReports(reports);
    } catch (e: any) {
      console.warn('Failed to fetch bookings', e);
      setLoadError(e?.message || 'Could not load your bookings.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Focus-driven refresh: the bottom nav PUSHES screens and back pops them,
  // so this screen stays mounted while the worker accepts/completes a job
  // from their side — without a re-focus fetch the client's list goes stale
  // (a just-completed job never moves to the Past tab until a manual pull).
  const hasLoadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const silent = hasLoadedRef.current;
      hasLoadedRef.current = true;
      void loadBookings(silent);
    }, [loadBookings]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBookings(true);
    setRefreshing(false);
  }, [loadBookings]);

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
            mergeStatusUpdate(updated);
            // The worker just submitted/updated the work report — pull its
            // photos so the client sees them immediately.
            void fetchWorkReport(String(data.booking_id));
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
  // Decides between the full-screen initial spinner and keeping the list (with
  // its pull-to-refresh) mounted while a refetch runs.
  const hasAnyData = present.length > 0 || past.length > 0;

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

  /** Worker's work-proof box — ALL submitted photos + full note. Every photo
   * is tappable for the full-screen viewer. Rendered in Present (payment
   * panel) AND in Past cards so the client can always review what was done. */
  function renderReportBox(b: Booking) {
    const report = workReports[b.id];
    if (!report || (report.images.length === 0 && !report.note)) return null;
    return (
      <View style={styles.reportBox}>
        <View style={styles.reportHead}>
          <Ionicons name="camera-outline" size={13} color="#6F42C1" />
          <Text style={styles.reportHeadText} numberOfLines={1}>
            Work photos from {b.worker.full_name || 'worker'}
            {report.images.length > 0 ? ` (${report.images.length})` : ''}
          </Text>
        </View>
        {report.images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reportImages}>
            {report.images.map((u, i) => (
              <TouchableOpacity
                key={`${u}-${i}`}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); setViewImage(u); }}
              >
                <Image source={{ uri: u }} style={styles.reportImage} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {report.images.length > 0 && (
          <Text style={styles.reportHint}>Tap a photo to view it full-screen</Text>
        )}
        {!!report.note && (
          <Text style={styles.reportNote}>{report.note}</Text>
        )}
      </View>
    );
  }

  /** Payment panel: shows the worker's work report and the appropriate action
   * based on the booking's sequential workflow status:
   * - work_reported: "Confirm Work" button
   * - client_confirmed: Pay button (unlocked after confirm)
   * - payment_completed: proof upload
   * - payment_proof_submitted: "Rate to Complete"
   * - awaiting_payment: (legacy) Pay button for old flow */
  function renderPaymentPanel(b: Booking) {
    const paid = paidBookings.has(b.id);
    const proofResult = paymentResults[b.id];
    const proofs = proofImages[b.id] ?? [];
    const status = b.status;

    return (
      <View style={styles.payPanel}>
        {renderReportBox(b)}

        {/* Step 3: Client reviews work report — choose Complete or Not Completed */}
        {status === 'work_reported' && (
          <View>
            <Text style={styles.payTitle}>Review the work report</Text>
            <TouchableOpacity
              style={styles.payBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); void confirmWork(b); }}
            >
              <Ionicons name="checkmark-circle" size={15} color="#fff" />
              <Text style={styles.payText}>✅ Mark as Complete &amp; Pay</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.notCompleteBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
            >
              <Ionicons name="warning-outline" size={14} color="#991b1b" />
              <Text style={styles.notCompleteText}>Not Completed</Text>
            </TouchableOpacity>
            <Text style={styles.proofRequiredNote}>Choosing Not Completed means no payment is needed.</Text>
          </View>
        )}

        {/* Step 4: Client pays (unlocked after confirm-work) */}
        {(status === 'client_confirmed' || status === 'awaiting_payment') && !paid && (
          <TouchableOpacity
            style={styles.payBtn}
            activeOpacity={0.8}
            disabled={payingId === b.id}
            onPress={(e) => { e.stopPropagation?.(); void startPayment(b); }}
          >
            {payingId === b.id
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="card-outline" size={15} color="#fff" />}
            <Text style={styles.payText}>Pay ₹{b.final_price || b.amount} with Razorpay</Text>
          </TouchableOpacity>
        )}

        {/* Legacy awaiting_payment flow: retry on failure */}
        {(status === 'client_confirmed' || status === 'awaiting_payment') && paid && proofResult === 'failed' && (
          <View style={styles.failedBox}>
            <Ionicons name="warning" size={16} color="#991b1b" />
            <Text style={styles.failedText}>Payment failed. Please try again.</Text>
            <TouchableOpacity
              style={styles.payBtn}
              activeOpacity={0.8}
              disabled={payingId === b.id}
              onPress={(e) => { e.stopPropagation?.(); void startPayment(b); }}
            >
              {payingId === b.id
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="card-outline" size={15} color="#fff" />}
              <Text style={styles.payText}>Retry payment</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 5: Proof upload (after payment) — proof is MANDATORY: the client
            must attach and submit it before the rating step unlocks. */}
        {(status === 'payment_completed' || (paid && status !== 'payment_proof_submitted')) && proofResult !== 'success' && (
          <View style={styles.proofSection}>
            <Text style={styles.proofTitle}>💳 Payment proof (required)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.proofImagesRow}>
              {proofs.map((p, i) => (
                <TouchableOpacity key={p.url} activeOpacity={0.8} onPress={() => setViewImage(p.url)}>
                  <Image source={{ uri: p.preview || p.url }} style={styles.proofThumb} />
                </TouchableOpacity>
              ))}
              {proofs.length < 3 && (
                <TouchableOpacity
                  style={styles.proofAddBtn}
                  onPress={() => void uploadProofImage(b.id)}
                  disabled={uploadingProof}
                >
                  {uploadingProof
                    ? <ActivityIndicator size="small" color="#6F42C1" />
                    : <Ionicons name="add" size={22} color="#6F42C1" />}
                </TouchableOpacity>
              )}
            </ScrollView>
            {proofs.length > 0 ? (
              <TouchableOpacity
                style={styles.proofSubmitBtn}
                onPress={() => void submitPaymentProof(b.id)}
              >
                <Text style={styles.proofSubmitText}>Submit proof</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.proofRequiredNote}>
                Add at least one proof screenshot and submit it — rating unlocks after the proof is submitted.
              </Text>
            )}
          </View>
        )}

        {/* Step 6: Rate to complete (after proof submitted) */}
        {(status === 'payment_proof_submitted' || proofResult === 'success') && (
          <View style={styles.proofSection}>
            {proofResult === 'success' && (
              <Text style={{ fontSize: 11, color: '#065f46', marginBottom: 6 }}>✅ Payment proof submitted</Text>
            )}
            <TouchableOpacity
              style={styles.rateBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
            >
              <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
              <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : '⭐ Rate worker to complete booking'}</Text>
            </TouchableOpacity>
            {!reviewedBookings.has(b.id) && (
              <TouchableOpacity
                style={styles.notCompleteBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
              >
                <Ionicons name="warning-outline" size={14} color="#991b1b" />
                <Text style={styles.notCompleteText}>Mark as not completed</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  }

  const renderCard = (b: Booking) => {
    const sc = statusColor(b.status, tab === 'past', paymentResults[b.id]);
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
          {tab === 'present' && (b.status === 'upcoming' || b.status === 'work_completed') && (
            <TouchableOpacity
              style={styles.notCompleteBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
            >
              <Ionicons name="warning-outline" size={14} color="#991b1b" />
              <Text style={styles.notCompleteText}>Mark as not completed</Text>
            </TouchableOpacity>
          )}
          {/* Flagged as not done — stays in Present until the review closes it. */}
          {tab === 'present' && b.status === 'not_completed_pending_review' && (
            <View>
              {renderReportBox(b)}
              <Text style={styles.proofRequiredNote}>
                Job marked not completed — your review (photos optional) closes it.
              </Text>
              <TouchableOpacity
                style={styles.rateBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
              >
                <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
                <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : '⭐ Rate worker to finish'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {tab === 'present' && (b.status === 'work_reported' || b.status === 'client_confirmed' || b.status === 'payment_completed' || b.status === 'payment_proof_submitted' || b.status === 'awaiting_payment') && renderPaymentPanel(b)}
          {/* Past: always show the worker's work photos when they exist, so the
              client can review every submitted proof image even after completion. */}
          {tab === 'past' && renderReportBox(b)}
          {tab === 'past' && b.status === 'completed' && (
            <TouchableOpacity
              style={styles.rateBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
            >
              <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
              <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : 'Rate worker'}</Text>
            </TouchableOpacity>
          )}
          {tab === 'past' && b.status === 'not_completed' && (
            <TouchableOpacity
              style={styles.rateBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
            >
              <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
              <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : 'Rate worker'}</Text>
            </TouchableOpacity>
          )}
          {tab === 'past' && b.status === 'client_not_completed' && (
            <TouchableOpacity
              style={styles.rateBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
            >
              <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
              <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : 'Rate worker'}</Text>
            </TouchableOpacity>
          )}
          {/* Past tab: work_reported means client never confirmed — show Complete + Not Completed */}
          {tab === 'past' && b.status === 'work_reported' && (
            <>
              <TouchableOpacity
                style={styles.payBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); void confirmWork(b); }}
              >
                <Ionicons name="checkmark-circle" size={15} color="#fff" />
                <Text style={styles.payText}>✅ Mark as Complete &amp; Pay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.notCompleteBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
              >
                <Ionicons name="warning-outline" size={14} color="#991b1b" />
                <Text style={styles.notCompleteText}>Not Completed</Text>
              </TouchableOpacity>
            </>
          )}
          {/* Past tab: client_confirmed but not paid — pay button */}
          {tab === 'past' && b.status === 'client_confirmed' && (
            <TouchableOpacity
              style={styles.payBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); void startPayment(b); }}
            >
              <Ionicons name="card-outline" size={15} color="#fff" />
              <Text style={styles.payText}>Pay ₹{b.final_price || b.amount}</Text>
            </TouchableOpacity>
          )}
          {/* Past tab: payment_completed but proof not submitted */}
          {tab === 'past' && b.status === 'payment_completed' && (
            <TouchableOpacity
              style={styles.notCompleteBtn}
              activeOpacity={0.8}
              onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
            >
              <Ionicons name="warning-outline" size={14} color="#991b1b" />
              <Text style={styles.notCompleteText}>Mark as not completed</Text>
            </TouchableOpacity>
          )}
          {/* Past tab: payment_proof_submitted but not rated */}
          {tab === 'past' && b.status === 'payment_proof_submitted' && (
            <>
              <TouchableOpacity
                style={styles.rateBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
              >
                <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
                <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : 'Rate worker to complete'}</Text>
              </TouchableOpacity>
              {!reviewedBookings.has(b.id) && (
                <TouchableOpacity
                  style={styles.notCompleteBtn}
                  activeOpacity={0.8}
                  onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
                >
                  <Ionicons name="warning-outline" size={14} color="#991b1b" />
                  <Text style={styles.notCompleteText}>Mark as not completed</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {/* Legacy: awaiting_payment in past with payment success */}
          {tab === 'past' && b.status === 'awaiting_payment' && paymentResults[b.id] === 'success' && (
            <>
              <TouchableOpacity
                style={styles.rateBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/worker_info', params: { id: String(b.worker.id), tab: 'reviews', booking: b.id } }); }}
              >
                <Ionicons name={reviewedBookings.has(b.id) ? 'eye-outline' : 'star'} size={15} color="#FFB800" />
                <Text style={styles.rateText}>{reviewedBookings.has(b.id) ? 'View my rating' : 'Rate worker'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.notCompleteBtn}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); void markNotCompleted(b.id); }}
              >
                <Ionicons name="warning-outline" size={14} color="#991b1b" />
                <Text style={styles.notCompleteText}>Mark as not completed</Text>
              </TouchableOpacity>
            </>
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

        {loading && !hasAnyData ? (
          <ActivityIndicator color="#6F42C1" style={{ marginTop: 30 }} />
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6F42C1" colors={['#6F42C1']} />
            }
          >
            {loadError && data.length === 0 ? (
              <View style={styles.errorBox}>
                <Ionicons name="cloud-offline-outline" size={36} color="#ccc" />
                <Text style={styles.errorText}>{loadError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => void loadBookings(false)}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : data.length === 0 ? (
              <Text style={styles.placeholder}>No bookings here yet</Text>
            ) : (
              data.map(renderCard)
            )}
          </ScrollView>
        )}
      </View>
      <FrameModal visible={!!priceFor} animationType="fade" onRequestClose={() => setPriceFor(null)}>
        <View style={styles.modalBackdrop}>
          {/* Inside a Modal the window pans (same as ai-assistant) — 'padding' lifts the card exactly above the keyboard. */}
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

      {checkoutFor && (
        <RazorpayCheckout
          order={checkoutFor.order}
          description={`Booking #${checkoutFor.booking.id} · ${checkoutFor.booking.worker.full_name || 'worker'}`}
          onSuccess={(p) => void handlePaymentSuccess(p)}
          onDismiss={(reason) => {
            setCheckoutFor(null);
            if (reason) Alert.alert('Payment not completed', reason);
          }}
        />
      )}

      {/* Payment-success receipt — stays on screen with the transaction id
          until the user continues or closes it, so they can screenshot it. */}
      <FrameModal visible={!!paymentReceipt} animationType="fade" onRequestClose={() => setPaymentReceipt(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Ionicons name="checkmark-circle" size={44} color="#10b981" style={{ textAlign: 'center' }} />
            <Text style={styles.modalTitle}>Payment successful ✓</Text>
            {paymentReceipt && (
              <>
                <Text style={styles.receiptAmount}>₹{paymentReceipt.amount}</Text>
                <Text style={styles.modalSub}>
                  Booking #{paymentReceipt.booking.id} · {paymentReceipt.booking.worker.full_name || 'worker'}
                </Text>
                {!!paymentReceipt.txnId && (
                  <View style={styles.receiptTxnBox}>
                    <Text style={styles.receiptTxnLabel}>Transaction ID</Text>
                    <Text style={styles.receiptTxnId} selectable>{paymentReceipt.txnId}</Text>
                  </View>
                )}
                <Text style={styles.receiptNote}>
                  Take a screenshot for your records. Next: submit your payment proof screenshot, then rate the worker to complete the booking.
                </Text>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setPaymentReceipt(null)}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSave]}
                onPress={() => {
                  const r = paymentReceipt;
                  setPaymentReceipt(null);
                  if (r) {
                    router.push({
                      pathname: '/worker_info',
                      params: { id: String(r.booking.worker.id), tab: 'reviews', booking: r.booking.id },
                    });
                  }
                }}
              >
                <Text style={styles.modalSaveText}>Add proof + Review</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </FrameModal>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewImage} transparent animationType="fade" onRequestClose={() => setViewImage(null)}>
        <TouchableOpacity style={styles.imageModalBackdrop} activeOpacity={1} onPress={() => setViewImage(null)}>
          {viewImage ? (
            <Image source={{ uri: viewImage }} style={styles.imageModalImg} resizeMode="contain" />
          ) : null}
          <View style={styles.imageModalCloseRow}>
            <TouchableOpacity style={styles.imageModalClose} onPress={() => setViewImage(null)}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  errorBox: { alignItems: 'center', paddingVertical: 40 },
  errorText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: '#b91c1c', textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: '#6F42C1' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 12 },

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

  // --- payment panel (awaiting_payment) ---
  payPanel: { marginTop: 8 },
  payTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6, textAlign: 'center' },
  reportBox: { backgroundColor: '#f5f0fb', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#e6dbf5' },
  reportHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reportHeadText: { fontSize: 12, fontWeight: '700', color: '#4c1d95', flex: 1 },
  reportImages: { marginTop: 6 },
  reportImage: { width: 64, height: 64, borderRadius: 8, marginRight: 6, backgroundColor: '#e9ecef' },
  reportHint: { fontSize: 10, color: '#6F42C1', marginTop: 4, fontWeight: '600' },
  reportNote: { fontSize: 11, color: '#555', marginTop: 6 },
  payBtn: { marginTop: 8, flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#6F42C1', alignItems: 'center', justifyContent: 'center', gap: 6 },
  // Button labels shrink + wrap instead of overflowing the narrow card column.
  payText: { color: '#fff', fontWeight: '800', fontSize: 12, flexShrink: 1, textAlign: 'center' },
  rateBtn: { marginTop: 8, flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FFB800', backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center', gap: 5 },
  rateText: { color: '#92400e', fontWeight: '800', fontSize: 12, flexShrink: 1, textAlign: 'center' },

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

  // --- payment-success receipt (stays until dismissed for screenshot) ---
  receiptAmount: { fontSize: 28, fontWeight: '800', color: '#10b981', textAlign: 'center', marginTop: 6 },
  receiptTxnBox: { marginTop: 12, backgroundColor: '#f8f8f8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#eee' },
  receiptTxnLabel: { fontSize: 11, fontWeight: '700', color: '#888', textAlign: 'center' },
  receiptTxnId: { fontSize: 13, fontWeight: '800', color: '#333', textAlign: 'center', marginTop: 4 },
  receiptNote: { fontSize: 11, color: '#666', textAlign: 'center', marginTop: 12, lineHeight: 16 },

  // --- payment proof & result ---
  proofSection: { marginTop: 8 },
  proofTitle: { fontSize: 12, fontWeight: '700', color: '#555', marginBottom: 6 },
  proofImagesRow: { flexDirection: 'row', gap: 6 },
  proofThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#e9ecef' },
  proofAddBtn: { width: 56, height: 56, borderRadius: 8, borderWidth: 1.5, borderColor: '#6F42C1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  proofSubmitBtn: { marginTop: 8, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#6F42C1', alignItems: 'center' },
  proofSubmitText: { color: '#6F42C1', fontWeight: '800', fontSize: 12 },
  proofRequiredNote: { marginTop: 8, fontSize: 11, color: '#b45309', lineHeight: 16 },
  failedBox: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderRadius: 8, padding: 10 },
  failedText: { flex: 1, fontSize: 12, color: '#991b1b', fontWeight: '600' },
  notCompleteBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#991b1b',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    gap: 6,
  },
  notCompleteText: { color: '#991b1b', fontWeight: '800', fontSize: 12, flexShrink: 1, textAlign: 'center' },

  // --- full-screen image viewer ---
  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '95%', height: '80%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'flex-end', padding: 16, paddingTop: 48 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8 },
});
