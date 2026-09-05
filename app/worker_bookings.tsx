import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import FrameModal from '@/components/frame-modal';
import { authFetch, expectJson, getAuth, readApiError } from '@/lib/api';
import { BookingStatus, isActiveStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { formatBookingDateTime, isBookingDateTimePast } from '@/lib/format';
import { pickImageWithPreview } from '@/lib/image-picker';
import { platformShadow } from '@/lib/shadow';
import { uploadMultipart } from '@/lib/upload';
import { ensureSocket, onBookingRequest, onBookingStatusChanged, onPaymentReceived } from '@/lib/socket';
import { storage } from '@/lib/storage';
import { BookingResponse, ReviewResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal,
RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  /** UI action state for present requests, following the sequential workflow:
   * pending -> accepted (upcoming) -> work_completed -> work_reported ->
   * client_confirmed -> payment_completed -> payment_proof_submitted -> completed */
  status: 'pending' | 'accepted' | 'work_completed' | 'work_reported' | 'proof_submitted' | 'awaiting_payment';
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
      status: (status === 'upcoming'
        ? 'accepted'
        : status === 'work_completed'
          ? 'work_completed'
          : status === 'work_reported'
            ? 'work_reported'
            : status === 'payment_proof_submitted'
              ? 'proof_submitted'
              : status === 'awaiting_payment'
                ? 'awaiting_payment'
                : 'pending') as 'pending' | 'accepted' | 'work_completed' | 'work_reported' | 'proof_submitted' | 'awaiting_payment',
    };
  });
}

/** Same Present/Past rule as the client's bookings: a request is past once
 * it reached a terminal state. Datetime expiry is ignored — workflow completion
 * is what matters, not the scheduled slot. */
function isPastRequest(r: Request): boolean {
  return !isActiveStatus(r.canonical);
}

/** Status pill colors/labels — mirrors the client's bookings screen, phrased
 * from the worker's side. The Past tab describes OUTCOMES ("Not completed",
 * "Not accepted") rather than still-open states. */
function statusColor(r: Request, isPast: boolean, paid?: Set<string>) {
  if (r.canonical === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (r.canonical === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  if (r.canonical === 'unpaid') return { bg: '#fee2e2', fg: '#991b1b', label: '⚠ Unpaid' };
  if (r.canonical === 'not_completed') return { bg: '#fee2e2', fg: '#991b1b', label: '⏱ Not completed' };
  if (r.canonical === 'client_not_completed') return { bg: '#fee2e2', fg: '#991b1b', label: '⏱ Not completed' };
  // Flagged as not done — stays in Present (amber) until the review closes it.
  if (r.canonical === 'not_completed_pending_review') return { bg: '#ffedd5', fg: '#9a3412', label: '⏱ Not completed · review pending' };
  if (r.canonical === 'work_completed') return { bg: '#dbeafe', fg: '#1e40af', label: '🔧 Work marked complete' };
  if (r.canonical === 'work_reported') return { bg: '#ede9fe', fg: '#5b21b6', label: '📋 Report submitted' };
  if (r.canonical === 'client_confirmed') return { bg: '#fef3c7', fg: '#92400e', label: '👁 Client confirmed' };
  if (r.canonical === 'payment_completed') return { bg: '#d1fae5', fg: '#065f46', label: '💰 Payment done' };
  if (r.canonical === 'payment_proof_submitted') return { bg: '#d1fae5', fg: '#065f46', label: '📤 Proof submitted' };
  if (r.canonical === 'awaiting_payment') {
    return paid?.has(r.id)
      ? { bg: '#dcfce7', fg: '#166534', label: '💰 Paid ✓' }
      : { bg: '#fef3c7', fg: '#92400e', label: '💳 Awaiting payment' };
  }
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
  // Work-report modal state (the "Work Done" flow): photos of the finished
  // job + optional note + the amount when the price was never agreed.
  const [reportFor, setReportFor] = useState<Request | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportAmount, setReportAmount] = useState('');
  const [reportImages, setReportImages] = useState<{ url: string; preview: string }[]>([]);
  const [uploadingReportImage, setUploadingReportImage] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  // Booking ids the client has PAID — flipped live by the 'payment_received'
  // socket event so the awaiting-payment card shows "Paid ✓" immediately.
  const [paidBookings, setPaidBookings] = useState<Set<string>>(new Set());
  // Payment proof image URL per booking (the client submits it after paying).
  // The worker previews it to confirm the payment actually happened.
  const [paymentProofs, setPaymentProofs] = useState<Record<string, string>>({});
  // Full-screen viewer for the payment-proof / report image.
  const [viewImage, setViewImage] = useState<string | null>(null);
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
        const auth = await getAuth();
        if (auth?.id) setUid(String(auth.id));
        const cached = await storage.get('workmithra:cached_worker_bookings');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setRequests(parsed);
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
      const mapped = mapRequests(data);
      setRequests(mapped);
      try {
        await storage.set('workmithra:cached_worker_bookings', JSON.stringify(mapped));
      } catch {}
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

      // Payment state + payment-proof images for jobs in the payment chain —
      // the socket event flips the "Paid ✓" badge live, but a worker reopening
      // after the client paid / submitted proof (event missed while offline)
      // still needs the fresh state and the proof image.
      const payChain = data.filter((b) => {
        const s = normalizeBookingStatus(b.status);
        // Include completed/rated too so the proof stays visible in Past
        // after the booking finishes — the worker can still open it full-screen.
        return s === 'awaiting_payment' || s === 'payment_completed' || s === 'payment_proof_submitted' || s === 'completed' || s === 'rated';
      });
      const paidSet = new Set<string>();
      const proofMap: Record<string, string> = {};
      await Promise.all(
        payChain.map(async (b) => {
          try {
            const pay: { payment_status?: string | null; payment_proof_image?: string | null } | null = await expectJson(
              await authFetch(`/payments/booking/${b.id}`),
              'Could not load payment status',
            );
            if (pay && pay.payment_status === 'paid') paidSet.add(String(b.id));
            if (pay && pay.payment_proof_image) proofMap[String(b.id)] = pay.payment_proof_image;
          } catch {}
        }),
      );
      setPaidBookings(paidSet);
      setPaymentProofs(proofMap);
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
    let offPayment: (() => void) | undefined;
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
            // The client just submitted their payment proof — fetch the image
            // right away so the card previews it without a manual refresh.
            if (normalizeBookingStatus(updated.status) === 'payment_proof_submitted') {
              void fetchPaymentProof(String(data.booking_id));
            }
          } catch {}
        })();
      });
      // The client paid via Razorpay — flip the card to "Paid ✓" live.
      offPayment = onPaymentReceived((data) => {
        setPaidBookings((s) => new Set(s).add(String(data.booking_id)));
      });
    })();
    return () => {
      cancelled = true;
      offRequest?.();
      offStatus?.();
      offPayment?.();
    };
  }, [loadRequests, uid]);

  const present = requests.filter((r) => !isPastRequest(r));
  const past = requests
    .filter(isPastRequest)
    // Newest first in the history tab.
    .sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
  const filtered = tab === 'present' ? present : past;

  /** Fetch the client's payment-proof image for ONE booking and store it, so
 * the card shows the proof the moment it arrives (socket event) without
 * waiting for the next focus refresh. */
  async function fetchPaymentProof(bookingId: string) {
    try {
      const pay: { payment_proof_image?: string | null } | null = await expectJson(
        await authFetch(`/payments/booking/${bookingId}`),
        'Could not load payment status',
      );
      if (pay && pay.payment_proof_image) {
        const url = pay.payment_proof_image;
        setPaymentProofs((prev) => (prev[bookingId] === url ? prev : { ...prev, [bookingId]: url }));
      }
    } catch {}
  }

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

  async function updateStatus(id: string, action: 'accepted' | 'declined') {
    if (actionRef.current) return;
    const r = requests.find((x) => x.id === id);
    if (!r) return;
    actionRef.current = true;

    const backendStatus = action === 'accepted' ? 'upcoming' : 'rejected';
    const errLabel =
      action === 'accepted'
        ? 'Could not accept the booking'
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
    // flips the action state; declining updates the canonical status, which
    // moves the card out of Present into the Past tab (the split is derived
    // from status).
    if (action === 'accepted') {
      setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, status: 'accepted', canonical: 'upcoming' } : x)));
    } else {
      setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, canonical: 'rejected' } : x)));
    }

    // No client-side notification POST here: the backend persists and pushes
    // the accepted/declined notification itself, so it also reaches a client
    // who was offline at this moment.
  }

  /** Open the work-report modal ("Work Done"). The amount field is only
   * needed when the price was never agreed during negotiation. */
  function openReportModal(r: Request) {
    setReportNote('');
    setReportImages([]);
    setReportAmount(r.final_price > 0 ? String(r.final_price) : r.estimated_price > 0 ? String(r.estimated_price) : '');
    setReportFor(r);
  }

  /** Pick + upload a work photo; the returned URL joins the report set.
   * Same upload endpoint/pattern as review photos. */
  async function attachReportImage() {
    if (uploadingReportImage) return;
    if (reportImages.length >= 5) {
      Alert.alert('Photo limit', 'You can attach up to 5 photos to the work report.');
      return;
    }
    setUploadingReportImage(true);
    try {
      // Uploads go through uploadMultipart (XHR): global fetch rejects
      // { uri, name, type } parts on native with "Unsupported FormDataPart".
      const picked = await pickImageWithPreview();
      if (!picked) { setUploadingReportImage(false); return; }
      const part = picked.part;
      const preview = picked.preview;
      const data = await uploadMultipart<{ url: string }>('/upload-review-image', part);
      setReportImages((imgs) => [...imgs, { url: data.url, preview }]);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload the photo');
    } finally {
      setUploadingReportImage(false);
    }
  }

  /** Submit the work report — moves the booking to awaiting_payment and
   * opens the client's Razorpay payment. */
  async function submitWorkReport() {
    if (!reportFor || submittingReport) return;
    if (uploadingReportImage) {
      Alert.alert('Photo still uploading', 'Wait for the photo upload to finish, or remove it.');
      return;
    }
    const r = reportFor;
    // The amount is only REQUIRED when no price was agreed yet; when it is
    // agreed the backend keeps the locked final_price regardless.
    const needsPrice = r.final_price <= 0;
    const amt = Number(reportAmount);
    if (needsPrice && (!amt || amt <= 0)) {
      Alert.alert('Amount required', 'The price was not agreed yet — enter the amount the client should pay.');
      return;
    }
    setSubmittingReport(true);
    try {
      await expectJson(
        await authFetch(`/bookings/${r.id}/work-report`, {
          method: 'POST',
          json: {
            note: reportNote.trim() || undefined,
            images: reportImages.map((i) => i.url),
            final_price: needsPrice ? amt : undefined,
          },
        }),
        'Could not submit the work report',
      );
      setRequests((rs) =>
        rs.map((x) => (x.id === r.id ? { ...x, canonical: 'work_reported', status: 'work_reported', final_price: needsPrice ? amt : x.final_price, price: needsPrice ? amt : x.price } : x)),
      );
      setReportFor(null);
      Alert.alert(
        'Work report submitted ✓',
        `${r.client} will now review your report and confirm the work. Once they pay and review, the booking completes automatically.`,
      );
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message || 'Could not submit the work report. Please try again.');
    } finally {
      setSubmittingReport(false);
    }
  }

  /** Escalate an unpaid job: booking -> unpaid and a negative review is
   * posted on the client automatically (backend does both). */
  function reportNonPayment(r: Request) {
    if (actionRef.current) return;
    Alert.alert(
      'Report non-payment?',
      `${r.client} has not paid for this job. Reporting marks the booking as unpaid and posts a negative review on their account with your work photos. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, report',
          style: 'destructive',
          onPress: () => void (async () => {
            actionRef.current = true;
            try {
              const updated: BookingResponse = await expectJson(
                await authFetch(`/bookings/${r.id}/report-nonpayment`, { method: 'POST' }),
                'Could not report non-payment',
              );
              mergeBooking(updated);
              Alert.alert('Reported', 'The booking is marked unpaid and the client has been notified.');
            } catch (e: any) {
              Alert.alert('Report failed', e?.message || 'Please try again.');
            } finally {
              actionRef.current = false;
            }
          })(),
        },
      ],
    );
  }

  /** Step 1: Worker marks work as complete. Moves booking to work_completed. */
  function markWorkComplete(r: Request) {
    if (actionRef.current) return;
    Alert.alert(
      'Mark work as complete?',
      'This tells the client that the work is done. You will then submit the work report.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => void (async () => {
            actionRef.current = true;
            try {
              const updated: BookingResponse = await expectJson(
                await authFetch(`/bookings/${r.id}/mark-work-complete`, { method: 'POST' }),
                'Could not mark work as complete',
              );
              mergeBooking(updated);
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Please try again.');
            } finally {
              actionRef.current = false;
            }
          })(),
        },
      ],
    );
  }

  /** Flag a job as not completed — the client is notified and the booking
   * enters the pending-review state (NO auto review). The worker is then
   * prompted to review the client; the review submission finalizes it to
   * terminal 'not_completed', which moves it to Past on both sides. */
  function markNotCompleted(r: Request) {
    if (actionRef.current) return;
    Alert.alert(
      'Mark as not completed?',
      `${r.client} will be notified. You then submit your review to finish — the request moves to Past once the review is done.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: () => void (async () => {
            actionRef.current = true;
            try {
              const updated: BookingResponse = await expectJson(
                await authFetch(`/bookings/${r.id}/mark-incomplete`, { method: 'POST' }),
                'Could not mark as not completed',
              );
              mergeBooking(updated);
              // Pending-review state — walk the worker straight into the
              // client-review form, which finalizes the booking.
              Alert.alert(
                'Marked as not completed ⏱',
                'Submit your review to finish — the request moves to Past once the review is done.',
                [
                  { text: 'Later', style: 'cancel' },
                  {
                    text: 'Review client to finish',
                    onPress: () => {
                      router.push({
                        pathname: '/user_profile',
                        params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
                      });
                    },
                  },
                ],
              );
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Please try again.');
            } finally {
              actionRef.current = false;
            }
          })(),
        },
      ],
    );
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
              const sc = statusColor(r, isPast, paidBookings);
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

                  {/* Gate on the CANONICAL status, not the UI action state: the
                      action state falls back to 'pending' for workflow stages
                      like client_confirmed / payment_completed, which wrongly
                      showed Accept/Decline on paid bookings. */}
                  {!isPast && r.canonical === 'pending' && (
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
                    <View style={styles.acceptedActionsColumn}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                        <Text style={styles.acceptedTag}>Accepted</Text>
                      </View>
                      {/* Each action on its own full-width row so nothing
                          squeezes/clips on narrow phone widths. */}
                      <TouchableOpacity
                        style={styles.completeBtnFull}
                        onPress={(e) => { e.stopPropagation?.(); void markWorkComplete(r); }}
                      >
                        <Ionicons name="checkmark-circle-outline" size={13} color="#fff" />
                        <Text style={styles.completeText}>Mark Work Complete</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.notCompleteRowBtn}
                        onPress={(e) => { e.stopPropagation?.(); markNotCompleted(r); }}
                      >
                        <Ionicons name="warning-outline" size={13} color="#991b1b" />
                        <Text style={styles.notCompleteSmallText}>Mark not complete</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!isPast && r.status === 'work_completed' && (
                    <View style={styles.acceptedActionsColumn}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                        <Text style={styles.acceptedTag}>Work marked complete</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.completeBtnFull}
                        onPress={(e) => { e.stopPropagation?.(); openReportModal(r); }}
                      >
                        <Ionicons name="camera-outline" size={13} color="#fff" />
                        <Text style={styles.completeText}>Submit Work Report</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!isPast && r.status === 'work_completed' && (
                    <View style={styles.awaitingActions}>
                      <TouchableOpacity
                        style={styles.nonPayBtn}
                        onPress={(e) => { e.stopPropagation?.(); reportNonPayment(r); }}
                      >
                        <Ionicons name="warning-outline" size={13} color="#991b1b" />
                        <Text style={styles.nonPayText}>Report non-payment</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!isPast && r.status === 'work_reported' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="hourglass-outline" size={13} color="#b45309" />
                        <Text style={[styles.awaitingTag, { color: '#b45309' }]}>
                          Waiting for client to preview &amp; confirm
                        </Text>
                      </View>
                      <View style={styles.awaitingActions}>
                        <TouchableOpacity
                          style={styles.nonPayBtn}
                          onPress={(e) => { e.stopPropagation?.(); reportNonPayment(r); }}
                        >
                          <Ionicons name="warning-outline" size={13} color="#991b1b" />
                          <Text style={styles.nonPayText}>Report non-payment</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {!isPast && r.canonical === 'client_confirmed' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                        <Text style={[styles.awaitingTag, { color: '#10b981' }]}>
                          Client confirmed · waiting for payment
                        </Text>
                      </View>
                      <View style={styles.awaitingActions}>
                        <TouchableOpacity
                          style={styles.nonPayBtn}
                          onPress={(e) => { e.stopPropagation?.(); reportNonPayment(r); }}
                        >
                          <Ionicons name="warning-outline" size={13} color="#991b1b" />
                          <Text style={styles.nonPayText}>Report non-payment</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {/* Flagged as not done (by either side) — stays in Present
                      until a review is submitted, which moves it to Past. */}
                  {!isPast && r.canonical === 'not_completed_pending_review' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="hourglass-outline" size={13} color="#b45309" />
                        <Text style={[styles.awaitingTag, { color: '#b45309' }]}>
                          Job marked not completed · review pending
                        </Text>
                      </View>
                      <View style={styles.awaitingActions}>
                        <TouchableOpacity
                          style={styles.reviewClientSmallBtn}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push({
                              pathname: '/user_profile',
                              params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
                            });
                          }}
                        >
                          <Ionicons name={reviewedBookings.has(r.id) ? 'eye-outline' : 'star'} size={13} color="#FFB800" />
                          <Text style={styles.reviewClientSmallText}>
                            {reviewedBookings.has(r.id) ? 'View my rating' : 'Review client to finish'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {!isPast && r.canonical === 'payment_completed' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                        <Text style={[styles.awaitingTag, { color: '#10b981' }]}>
                          Payment received · waiting for proof
                        </Text>
                      </View>
                    </View>
                  )}
                  {!isPast && r.canonical === 'payment_proof_submitted' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                        <Text style={[styles.awaitingTag, { color: '#10b981' }]}>
                          Proof submitted · waiting for review
                        </Text>
                      </View>
                      {paymentProofs[r.id] ? (
                        <TouchableOpacity
                          style={styles.proofImageWrap}
                          activeOpacity={0.85}
                          onPress={(e) => { e.stopPropagation?.(); setViewImage(paymentProofs[r.id]); }}
                        >
                          <Image source={{ uri: paymentProofs[r.id] }} style={styles.proofImageThumb} resizeMode="cover" />
                          <Text style={styles.proofImageLabel}>
                            <Ionicons name="expand-outline" size={11} color="#6F42C1" /> Tap to view full payment proof
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.proofImageNone}>No payment proof image uploaded</Text>
                      )}
                      <View style={styles.awaitingActions}>
                        <TouchableOpacity
                          style={styles.reviewClientSmallBtn}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push({
                              pathname: '/user_profile',
                              params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
                            });
                          }}
                        >
                          <Ionicons name={reviewedBookings.has(r.id) ? 'eye-outline' : 'star'} size={13} color="#FFB800" />
                          <Text style={styles.reviewClientSmallText}>{reviewedBookings.has(r.id) ? 'View my rating' : 'Review client'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {!isPast && r.status === 'awaiting_payment' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons
                          name={paidBookings.has(r.id) ? 'checkmark-circle' : 'hourglass-outline'}
                          size={13}
                          color={paidBookings.has(r.id) ? '#10b981' : '#b45309'}
                        />
                        <Text style={[styles.awaitingTag, paidBookings.has(r.id) && { color: '#10b981' }]}>
                          {paidBookings.has(r.id) ? 'Paid ✓ by client' : `Waiting for payment · ₹${r.final_price || r.price}`}
                        </Text>
                      </View>
                      {paidBookings.has(r.id) ? (
                        <View style={styles.awaitingActionsColumn}>
                          <TouchableOpacity
                            style={styles.reviewClientSmallBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              router.push({
                                pathname: '/user_profile',
                                params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
                              });
                            }}
                          >
                            <Ionicons name={reviewedBookings.has(r.id) ? 'eye-outline' : 'star'} size={13} color="#FFB800" />
                            <Text style={styles.reviewClientSmallText}>{reviewedBookings.has(r.id) ? 'View my rating' : 'Review client'}</Text>
                          </TouchableOpacity>
                          {/* Mark-not-complete on its own full-width row below —
                              side-by-side it clips on narrow phone widths. */}
                          <TouchableOpacity
                            style={styles.nonPayBtnFull}
                            onPress={(e) => { e.stopPropagation?.(); markNotCompleted(r); }}
                          >
                            <Ionicons name="warning-outline" size={13} color="#991b1b" />
                            <Text style={styles.nonPayText}>Mark not complete</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.awaitingActions}>
                          <TouchableOpacity
                            style={styles.nonPayBtn}
                            onPress={(e) => { e.stopPropagation?.(); reportNonPayment(r); }}
                          >
                            <Ionicons name="warning-outline" size={13} color="#991b1b" />
                            <Text style={styles.nonPayText}>Report non-payment</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}
                  {isPast && r.canonical === 'not_completed' && (
                    <View>
                      <Text style={{ fontSize: 11, color: '#991b1b', fontWeight: '600' }}>⏱ Not completed</Text>
                      {!reviewedBookings.has(r.id) && (
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
                          <Ionicons name="star" size={15} color="#FFB800" />
                          <Text style={styles.reviewClientText}>Review client</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  {isPast && r.canonical === 'client_not_completed' && (
                    <View>
                      <Text style={{ fontSize: 11, color: '#991b1b', fontWeight: '600' }}>⏱ Not completed</Text>
                      {!reviewedBookings.has(r.id) && (
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
                          <Ionicons name="star" size={15} color="#FFB800" />
                          <Text style={styles.reviewClientText}>Review client</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  {/* Past tab: awaiting_payment bookings — same actions as present tab */}
                  {isPast && r.canonical === 'awaiting_payment' && (
                    <View style={styles.awaitingBox}>
                      <View style={styles.acceptedRow}>
                        <Ionicons
                          name={paidBookings.has(r.id) ? 'checkmark-circle' : 'hourglass-outline'}
                          size={13}
                          color={paidBookings.has(r.id) ? '#10b981' : '#b45309'}
                        />
                        <Text style={[styles.awaitingTag, paidBookings.has(r.id) && { color: '#10b981' }]}>
                          {paidBookings.has(r.id) ? 'Paid ✓ by client' : `Payment not received · ₹${r.final_price || r.price}`}
                        </Text>
                      </View>
                      {paidBookings.has(r.id) ? (
                        <View style={styles.awaitingActionsColumn}>
                          <TouchableOpacity
                            style={styles.reviewClientSmallBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              router.push({
                                pathname: '/user_profile',
                                params: { clientId: r.client_id, clientName: r.client, tab: 'reviews', bookingId: r.id },
                              });
                            }}
                          >
                            <Ionicons name={reviewedBookings.has(r.id) ? 'eye-outline' : 'star'} size={13} color="#FFB800" />
                            <Text style={styles.reviewClientSmallText}>{reviewedBookings.has(r.id) ? 'View my rating' : 'Review client'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.nonPayBtnFull}
                            onPress={(e) => { e.stopPropagation?.(); markNotCompleted(r); }}
                          >
                            <Ionicons name="warning-outline" size={13} color="#991b1b" />
                            <Text style={styles.nonPayText}>Mark not complete</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.awaitingActions}>
                          <TouchableOpacity
                            style={styles.nonPayBtn}
                            onPress={(e) => { e.stopPropagation?.(); reportNonPayment(r); }}
                          >
                            <Ionicons name="warning-outline" size={13} color="#991b1b" />
                            <Text style={styles.nonPayText}>Report non-payment</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}
                  {isPast && r.canonical === 'completed' && (
                    <View>
                      {/* Client's payment proof stays viewable after completion —
                          tap the thumbnail for the full-screen image. */}
                      {paymentProofs[r.id] ? (
                        <TouchableOpacity
                          style={styles.proofImageWrap}
                          activeOpacity={0.85}
                          onPress={(e) => { e.stopPropagation?.(); setViewImage(paymentProofs[r.id]); }}
                        >
                          <Image source={{ uri: paymentProofs[r.id] }} style={styles.proofImageThumb} resizeMode="cover" />
                          <Text style={styles.proofImageLabel}>
                            <Ionicons name="expand-outline" size={11} color="#6F42C1" /> Tap to view full payment proof
                          </Text>
                        </TouchableOpacity>
                      ) : null}
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
                    </View>
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
          {/* Inside a Modal the window pans (same as ai-assistant) — 'padding' lifts the card exactly above the keyboard. */}
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

      <FrameModal visible={!!reportFor} animationType="fade" onRequestClose={() => !submittingReport && setReportFor(null)}>
        <View style={styles.modalBackdrop}>
          {/* Inside a Modal the window pans (same as ai-assistant) — 'padding' lifts the card exactly above the keyboard. */}
          <KeyboardAvoidingView behavior="padding" style={styles.quoteKav}>
            <ScrollView contentContainerStyle={{ alignItems: 'center' }}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Work Done — Submit Report</Text>
                {reportFor && (
                  <Text style={styles.modalSub}>For {reportFor.client} · {reportFor.job}</Text>
                )}
                <Text style={styles.reportHint}>
                  Add photos of the finished work. The client pays through the app after seeing this report — once they pay and review, the booking completes automatically.
                </Text>

                <TouchableOpacity style={styles.reportAddPhoto} onPress={attachReportImage} disabled={uploadingReportImage}>
                  {uploadingReportImage
                    ? <ActivityIndicator size="small" color="#6F42C1" />
                    : <Ionicons name="camera-outline" size={16} color="#6F42C1" />}
                  <Text style={styles.reportAddPhotoText}>{uploadingReportImage ? 'Uploading…' : `Add work photos (${reportImages.length}/5)`}</Text>
                </TouchableOpacity>
                {reportImages.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reportPreviews}>
                    {reportImages.map((img, i) => (
                      <View key={`${img.url}-${i}`} style={styles.reportPreviewWrap}>
                        <Image source={{ uri: img.preview }} style={styles.reportPreview} />
                        <TouchableOpacity
                          style={styles.reportPreviewRemove}
                          onPress={() => setReportImages((imgs) => imgs.filter((_, j) => j !== i))}
                        >
                          <Ionicons name="close" size={12} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}

                <TextInput
                  style={styles.reportNoteInput}
                  placeholder="Note for the client (optional) — what was done, parts used…"
                  placeholderTextColor="#bbb"
                  value={reportNote}
                  onChangeText={setReportNote}
                  multiline
                />

                {reportFor && reportFor.final_price <= 0 && (
                  <View style={styles.reportAmountBlock}>
                    <Text style={styles.reportAmountLabel}>Amount to collect (₹) — price was not agreed yet</Text>
                    <View style={styles.amountRow}>
                      <Text style={styles.rupee}>₹</Text>
                      <TextInput
                        style={styles.amountInput}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#bbb"
                        value={reportAmount}
                        onChangeText={setReportAmount}
                      />
                    </View>
                  </View>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalCancel]}
                    disabled={submittingReport}
                    onPress={() => setReportFor(null)}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalSend, submittingReport && { opacity: 0.6 }]}
                    disabled={submittingReport}
                    onPress={submitWorkReport}
                  >
                    {submittingReport
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.modalSendText}>Submit Report</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </FrameModal>

      <Modal visible={!!viewImage} transparent animationType="fade" onRequestClose={() => setViewImage(null)}>
        <TouchableOpacity style={styles.imageModalBackdrop} activeOpacity={1} onPress={() => setViewImage(null)}>
          {viewImage ? (
            <Image source={{ uri: viewImage }} style={styles.imageModalImg} resizeMode="contain" />
          ) : null}
          <View style={styles.imageModalCloseRow}>
            <TouchableOpacity style={styles.imageModalClose} onPress={() => setViewImage(null)}>
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
  // Column layout — each action gets its own full-width row so nothing
  // squeezes or clips on narrow phone widths.
  acceptedActionsColumn: { marginTop: 8, gap: 6 },
  acceptedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  acceptedTag: { color: '#10b981', fontWeight: '800', fontSize: 12 },
  acceptedBtnRow: { flexDirection: 'row', gap: 6 },
  completeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#6F42C1' },
  completeBtnFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#6F42C1' },
  completeText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  notCompleteSmallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fff' },
  notCompleteSmallText: { color: '#991b1b', fontWeight: '800', fontSize: 11 },
  // Full-width "Mark not complete" on its own row (fits on narrow screens).
  notCompleteRowBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fff' },
  reviewClientBtn: { marginTop: 8, flexDirection: 'row', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FFB800', backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center', gap: 5 },
  reviewClientText: { color: '#92400e', fontWeight: '800', fontSize: 12 },

  // --- awaiting payment panel ---
  awaitingBox: { marginTop: 8, backgroundColor: '#fffbeb', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#fde68a' },
  awaitingTag: { color: '#b45309', fontWeight: '800', fontSize: 12 },
  awaitingActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  // Stacked variant — Review on first row, Mark-not-complete on its own
  // full-width row below (fits narrow phones).
  awaitingActionsColumn: { gap: 6, marginTop: 8 },
  reviewClientSmallBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#FFB800', backgroundColor: '#fff' },
  reviewClientSmallText: { color: '#92400e', fontWeight: '800', fontSize: 11 },
  nonPayBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fff' },
  nonPayBtnFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fff' },
  nonPayText: { color: '#991b1b', fontWeight: '800', fontSize: 11 },
  proofImageWrap: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f5f0fb', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#e6dbf5' },
  proofImageThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#e9ecef' },
  proofImageLabel: { flex: 1, color: '#6F42C1', fontWeight: '700', fontSize: 11 },
  proofImageNone: { marginTop: 8, fontSize: 11, color: '#999', fontStyle: 'italic' },
  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '95%', height: '80%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'flex-end', padding: 16, paddingTop: 48 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8 },

  // --- work report modal ---
  reportHint: { fontSize: 11, color: '#666', textAlign: 'center', marginTop: 8, lineHeight: 16 },
  reportAddPhoto: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: '#6F42C1', backgroundColor: '#f5f0fb' },
  reportAddPhotoText: { color: '#6F42C1', fontWeight: '800', fontSize: 12 },
  reportPreviews: { marginTop: 8 },
  reportPreviewWrap: { marginRight: 6 },
  reportPreview: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#e9ecef' },
  reportPreviewRemove: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: '#991b1b', alignItems: 'center', justifyContent: 'center' },
  reportNoteInput: { marginTop: 10, minHeight: 60, maxHeight: 100, backgroundColor: '#f8f8f8', borderRadius: 10, borderWidth: 1, borderColor: '#eee', paddingHorizontal: 10, paddingTop: 8, fontSize: 12, color: '#333', textAlignVertical: 'top' },
  reportAmountBlock: { marginTop: 10 },
  reportAmountLabel: { fontSize: 11, fontWeight: '700', color: '#6F42C1', marginBottom: 4 },
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
