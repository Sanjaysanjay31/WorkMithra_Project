import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, readApiError } from '@/lib/api';
import { AvailabilitySlot, listAvailability } from '@/lib/availability';
import { normalizeBookingStatus } from '@/lib/booking-status';
import { pickImageNative, pickImageWeb } from '@/lib/image-picker';
import { ensureSocket } from '@/lib/socket';
import { storage } from '@/lib/storage';
import { UploadFilePart, uploadMultipart } from '@/lib/upload';
import { JobHistoryResponse, ReviewResponse, WorkerResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { WebView } from 'react-native-webview';


type Tab = 'profile' | 'reviews' | 'chat' | 'booking' | 'map';

// Real booking statuses — a freshly created booking is pending, not completed.
type HistoryItem = { id: string; bookingId?: string; date: string; time: string; price: number; status: 'pending' | 'upcoming' | 'completed' | 'rejected' };

function historyStatusLabel(status: HistoryItem['status']): { text: string; color: string } {
  switch (status) {
    case 'completed': return { text: '✓ Completed', color: '#10b981' };
    case 'upcoming': return { text: '⏳ Upcoming', color: '#1e40af' };
    case 'rejected': return { text: '✗ Cancelled', color: '#991b1b' };
    default: return { text: '⏳ Pending', color: '#92400e' };
  }
}

function toRad(d: number) { return (d * Math.PI) / 180; }

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function formatTimeLabel(value: string): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr); const m = Number(mStr);
  const hr12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hr12}:${pad(m)} ${ampm}`;
}

// JS getDay(): 0 = Sunday. Maps a YYYY-MM-DD date onto the backend's
// canonical availability day keys.
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

function dayKeyOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DAY_KEYS[new Date(y, m - 1, d).getDay()];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Maximum photos attachable to one review (enforced by the backend too).
const MAX_REVIEW_PHOTOS = 5;

export default function WorkerInfoPage() {
  const router = useRouter();
  const { id, tab: tabParam, booking: bookingParam } = useLocalSearchParams();
  const workerId = String(id || '');
  // Callers can deep-link to a tab (e.g. bookings' "Rate worker" opens
  // straight onto the review form): /worker_info?id=5&tab=reviews
  const initialTab: Tab = (['profile', 'reviews', 'chat', 'booking', 'map'] as Tab[]).includes(tabParam as Tab)
    ? (tabParam as Tab)
    : 'profile';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [worker, setWorker] = useState<WorkerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Booking form state
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [bookNote, setBookNote] = useState('');
  const [bookPrice, setBookPrice] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // The worker's weekly availability (shown on the booking form and checked
  // before submitting — mirrors the backend's pre-booking validation).
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  // Separate from `loading` (which swaps the whole screen for a spinner):
  // booking must disable the button without hiding the form, and it must
  // block double-taps that would otherwise create duplicate bookings.
  const [submitting, setSubmitting] = useState(false);

  // Map state
  const [clientLoc, setClientLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locUnavailable, setLocUnavailable] = useState(false);

  // Feedback state — reviews loaded from backend
  type ReviewItem = { id: string | number; userId?: string; bookingId?: string; name: string; rating: number; date: string; text: string; images?: string[] };
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  // The logged-in client's id — used to pick their own reviews out of the
  // list (one per completed booking) and show them as read-only cards.
  const [myUid, setMyUid] = useState('');
  // The booking whose review form is currently open (one form at a time).
  const [reviewingBookingId, setReviewingBookingId] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(5);
  // Review photos: uploaded URL + local preview URI, up to MAX_REVIEW_PHOTOS.
  const [feedbackImages, setFeedbackImages] = useState<{ url: string; preview: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Full-screen viewer for review photos.
  const [viewImage, setViewImage] = useState<string | null>(null);

  // The review THIS client wrote for a specific booking, if any. Reviews are
  // per booking — the same worker can be reviewed once per completed job.
  function myReviewFor(bookingId?: string) {
    if (!myUid || !bookingId) return undefined;
    return reviews.find((r) => r.userId === myUid && r.bookingId === bookingId);
  }

  async function loadReviews() {
    const wid = Number(id);
    if (!wid) return;
    try {
      const res = await authFetch(`/reviews/?worker_id=${wid}`);
      if (!res.ok) return;
      const data: ReviewResponse[] = await res.json();
      setReviews(
        data.map((r) => ({
          id: r.id,
          // user_id carries the REVIEWER's id for client-written reviews —
          // used below to spot this client's own review.
          userId: r.user_id != null ? String(r.user_id) : undefined,
          bookingId: r.booking_id != null ? String(r.booking_id) : undefined,
          name: r.user_name || (r.user_id ? `User #${r.user_id}` : 'Client'),
          rating: Number(r.rating) || 0,
          date: r.created_at ? String(r.created_at).split('T')[0] : '',
          text: r.review_text || '',
          // Prefer the multi-image array; older rows/reviews only carry the
          // single legacy review_image.
          images:
            r.review_images && r.review_images.length > 0
              ? r.review_images
              : r.review_image
                ? [r.review_image]
                : undefined,
        })),
      );
    } catch {}
  }

  /** Pick a photo and upload it; the returned URL joins the attached set. */
  async function attachReviewImage() {
    if (uploadingImage) return;
    if (feedbackImages.length >= MAX_REVIEW_PHOTOS) {
      Alert.alert('Photo limit', `You can attach up to ${MAX_REVIEW_PHOTOS} photos per review.`);
      return;
    }
    setUploadingImage(true);
    try {
      // Uploads go through uploadMultipart (XHR): global fetch rejects
      // { uri, name, type } parts on native with "Unsupported FormDataPart".
      let part: UploadFilePart;
      let preview = '';
      if (Platform.OS === 'web') {
        const file = await pickImageWeb();
        if (!file) { setUploadingImage(false); return; }
        part = file;
        preview = URL.createObjectURL(file);
      } else {
        const asset = await pickImageNative();
        if (!asset) { setUploadingImage(false); return; }
        const name = asset.fileName || asset.uri.split('/').pop() || 'photo.jpg';
        const ext = (name.split('.').pop() || 'jpg').toLowerCase();
        const mime = asset.mimeType || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
        part = { uri: asset.uri, name, type: mime };
        preview = asset.uri;
      }
      const data = await uploadMultipart<{ url: string }>('/upload-review-image', part);
      setFeedbackImages((imgs) => [...imgs, { url: data.url, preview }]);
    } catch (e: any) {
      // Nothing was added to the list, so there's no preview to roll back.
      Alert.alert('Upload failed', e?.message || 'Could not upload the photo');
    } finally {
      setUploadingImage(false);
    }
  }

  function removeReviewImage(index: number) {
    setFeedbackImages((imgs) => imgs.filter((_, i) => i !== index));
  }

  async function handleSubmitFeedback(bookingId: string) {
    if (!bookingId) {
      Alert.alert('Submit failed', 'Missing booking — reopen the review form and try again.');
      return;
    }
    if (!feedbackText.trim()) {
      Alert.alert('Feedback', 'Please write something before submitting.');
      return;
    }
    if (uploadingImage) {
      Alert.alert('Photo still uploading', 'Wait for the photo upload to finish, or remove it.');
      return;
    }
    const wid = Number(id);
    if (!wid || Number.isNaN(wid)) {
      Alert.alert('Submit failed', `Invalid worker id: ${id}`);
      return;
    }
    const url = `/reviews/`;
    const urls = feedbackImages.map((p) => p.url);
    const body = {
      worker_id: wid,
      // Pin the review to THIS booking — each completed job gets its own
      // review (the backend enforces one review per booking per side).
      booking_id: Number(bookingId),
      rating: feedbackRating,
      review_text: feedbackText,
      // Single legacy field (old backends ignore the array) + full set.
      review_image: urls[0],
      review_images: urls.length > 0 ? urls : undefined,
    };
    try {
      const res = await authFetch(url, {
        method: 'POST',
        json: body,
      });
      if (!res.ok) {
        // Surface the backend's reason cleanly (e.g. "You can only review a
        // worker after a completed booking with them") instead of a raw dump.
        const detail = await readApiError(res, 'Could not submit your review');
        Alert.alert('Submit failed', detail);
        return;
      }
      setFeedbackText('');
      setFeedbackRating(5);
      setFeedbackImages([]);
      setReviewingBookingId('');
      await loadReviews();
      // A review on a PAID awaiting-payment booking AUTO-COMPLETES it on the
      // backend; a review on a flagged job closes it as 'not_completed'.
      // Check the fresh status so the alert can confirm the outcome.
      let completed = false;
      let closedNotCompleted = false;
      try {
        const bres = await authFetch(`/bookings/${bookingId}`);
        if (bres.ok) {
          const b = await bres.json();
          const st = normalizeBookingStatus(b.status);
          completed = st === 'completed';
          closedNotCompleted = st === 'not_completed';
        }
      } catch {}
      Alert.alert(
        completed ? 'Job completed 🎉' : closedNotCompleted ? 'Booking closed ⏱' : 'Success',
        completed
          ? 'Thanks for your review — the booking is now marked complete.'
          : closedNotCompleted
            ? 'Thanks for your review — the booking is now closed as not completed.'
            : 'Thank you for your feedback!',
      );
    } catch (e: any) {
      Alert.alert('Submit failed', `${e?.message || 'Network error'}`);
    }
  }

  useEffect(() => {
    fetchWorkerDetails();
    loadReviews();
    // This client's own id — needed to spot their own reviews in the list.
    void getCurrentUid().then(setMyUid);
    // Any authenticated caller may read a worker's slots (pre-booking check).
    // Slots are optional here — on failure show none rather than crash.
    if (Number(id)) listAvailability(Number(id)).then(setSlots).catch(() => setSlots([]));
    // Load the worker's history first, then (for deep links from the bookings
    // screen's "Rate worker" / "View my rating" buttons) inject the
    // deep-linked booking into `history` so its review form renders.
    //
    // ORDER MATTERS: `loadHistory()` OVERWRITES the entire `history` state
    // when its fetch resolves, so injecting the synthetic row BEFORE it
    // finishes would be clobbered — `reviewableJobs` would stay empty and the
    // client would see "You can review … after a completed job" instead of
    // the review form for an active `payment_proof_submitted` / paid booking.
    (async () => {
      await loadHistory();
      if (initialTab === 'reviews' && bookingParam) {
        const bidStr = String(bookingParam);
        setReviewingBookingId(bidStr);
        // Active-state bookings (e.g. `payment_proof_submitted`) don't appear
        // in `history` (which is loaded from /job-history/ and only returns
        // completed jobs). Without this fetch, the review form for the
        // deep-linked booking would never render because `reviewableJobs`
        // would be empty. We inject the booking as a synthetic history row
        // so the existing form/markReviewed logic finds it.
        await ensureBookingInHistory(bidStr);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (activeTab === 'map') tryGetLocation();
  }, [activeTab]);

  async function fetchWorkerDetails() {
    setLoading(true);
    try {
      const res = await authFetch(`/workers/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WorkerResponse = await res.json();
      setWorker(data);
    } catch (e) {
      console.warn('Failed to fetch worker', e);
      Alert.alert('Error', 'Failed to load worker details');
    } finally {
      setLoading(false);
    }
  }

  async function getCurrentUid(): Promise<string> {
    try {
      const authRaw = await storage.get('workmithra:auth');
      if (authRaw) {
        const auth = JSON.parse(authRaw);
        if (auth.id) return String(auth.id);
      }
    } catch {}
    return '';
  }

  // Cache key is scoped to BOTH the user and the worker — users and workers
  // have overlapping ids, and the same device may host multiple accounts, so a
  // worker-only key would leak one user's booking history to another.
  const historyCacheKey = (uid: string) => `workmithra:history:${uid}:${workerId}`;

  async function loadHistory() {
    const wid = Number(id);
    const uid = await getCurrentUid();
    if (wid) {
      try {
        // with_worker narrows MY history to jobs done by this worker — the
        // plain worker_id param is rejected for client tokens by the backend.
        const res = await authFetch(`/job-history/?with_worker=${wid}`);
        if (res.ok) {
          const rows: JobHistoryResponse[] = await res.json();
          if (Array.isArray(rows) && rows.length) {
            setHistory(
              rows.map((r) => ({
                id: String(r.id),
                bookingId: r.booking_id != null ? String(r.booking_id) : undefined,
                date: r.completed_at ? String(r.completed_at).split('T')[0] : '',
                time: r.completed_at ? String(r.completed_at).split('T')[1]?.slice(0, 5) || '' : '',
                price: 0,
                status: 'completed' as const,
              })),
            );
            // Job-history rows carry no price column — render "—" instead of
            // a fabricated ₹0 on every history card (see historyPrice below).
            return;
          }
        }
      } catch {}
    }
    // Fall back to locally cached history (scoped to this user) if the backend
    // has nothing yet.
    if (uid) {
      try {
        const raw = await storage.get(historyCacheKey(uid));
        if (raw) { setHistory(JSON.parse(raw)); return; }
      } catch {}
    }
    setHistory([]);
  }

  /** Inject a deep-linked booking (e.g. `payment_proof_submitted`) into the
   * history list so its review form can render. Only runs for bookings not
   * already in the list (a completed job from /job-history/ is already there).
   * The synthetic row carries the booking id and a "completed"-style entry so
   * the form rendering path treats it identically to a real completed job. */
  async function ensureBookingInHistory(bidStr: string) {
    if (!bidStr) return;
    const bid = Number(bidStr);
    if (!bid || Number.isNaN(bid)) return;
    setHistory((prev) => {
      if (prev.some((h) => h.bookingId === bidStr)) return prev;
      return [
        ...prev,
        {
          id: `synthetic-${bidStr}`,
          bookingId: bidStr,
          date: '',
          time: '',
          price: 0,
          status: 'completed' as const,
        },
      ];
    });
  }

  async function tryGetLocation() {
    // On failure we leave clientLoc null and flag locUnavailable — the UI
    // then says "Location unavailable" instead of silently substituting a
    // hardcoded Hyderabad point (which produced wildly wrong distances for
    // anyone outside that city).
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setLocUnavailable(true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => setClientLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocUnavailable(true),
        { enableHighAccuracy: false, timeout: 5000 },
      );
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocUnavailable(true); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setClientLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setLocUnavailable(true);
    }
  }

  const distanceKm = useMemo(() => {
    if (!clientLoc || !worker?.latitude || !worker?.longitude) return null;
    return haversineKm(clientLoc.lat, clientLoc.lng, Number(worker.latitude), Number(worker.longitude));
  }, [clientLoc, worker]);

  const handleCall = () => worker?.phone && Linking.openURL(`tel:${worker.phone}`);

  useEffect(() => {
    ensureSocket();
  }, []);

  async function handleBookNow() {
    if (submitting) return; // block double-taps creating duplicate bookings
    if (!bookDate.trim() || !bookTime.trim()) {
      Alert.alert('Booking', 'Please enter both date and time.');
      return;
    }
    // Never let a client book a slot that has already passed. `new Date` on a
    // 'YYYY-MM-DDTHH:MM' string parses as LOCAL time, so today-with-past-time
    // is caught exactly like a date in the past. The backend enforces the same
    // rule (create_booking) as a second line of defense.
    const chosenSlot = new Date(`${bookDate}T${String(bookTime).slice(0, 5)}`);
    if (Number.isNaN(chosenSlot.getTime()) || chosenSlot.getTime() <= Date.now()) {
      Alert.alert('Invalid slot', 'You cannot book a past date or time. Please pick a future slot.');
      return;
    }
    // A ₹0 agreed price is rejected by the backend — catch it client-side. An
    // EMPTY price is fine (means "discuss later", sent as null).
    if (bookPrice.trim() && (!Number(bookPrice) || Number(bookPrice) <= 0)) {
      Alert.alert('Booking', 'Agreed price must be more than ₹0, or leave it blank to discuss later.');
      return;
    }

    // Client-side mirror of the backend's availability check — instant,
    // friendly guidance instead of a 400 round-trip. Only enforced when the
    // worker has configured slots (no slots = any time can be requested).
    if (slots.length > 0) {
      const daySlot = slots.find(
        (s) => (s.available_day || '').toLowerCase() === dayKeyOf(bookDate),
      );
      if (!daySlot || !daySlot.is_available) {
        Alert.alert(
          'Worker unavailable',
          `${worker?.full_name || 'This worker'} doesn't take bookings on that day. Check their working hours under "Book a new slot".`,
        );
        return;
      }
      const t = bookTime.slice(0, 5);
      if ((daySlot.start_time && t < daySlot.start_time) || (daySlot.end_time && t > daySlot.end_time)) {
        Alert.alert(
          'Outside working hours',
          `Please pick a time between ${formatTimeLabel(daySlot.start_time || '')} and ${formatTimeLabel(daySlot.end_time || '')} on that day.`,
        );
        return;
      }
    }

    const currentUid = await getCurrentUid();
    if (!currentUid) {
      Alert.alert('Authentication', 'Please login to book a worker');
      return;
    }

    setSubmitting(true);
    try {
      // Use the customer's real address from their profile when available.
      let customerAddress = 'Home Address (Default)';
      try {
        const pRes = await authFetch(`/profiles/user/${currentUid}`);
        if (pRes.ok) {
          const prof = await pRes.json();
          customerAddress = prof.address || prof.location || customerAddress;
        }
      } catch {}

      // 1. Create booking in DB (user_id comes from the auth token server-side).
      //    POST to '/bookings/' WITH the trailing slash — the backend route is
      //    '/bookings/'. Omitting it makes Starlette answer a 307 redirect on a
      //    POST, which only works if every network layer re-sends the JSON body;
      //    hitting the exact route avoids that fragility entirely.
      const res = await authFetch('/bookings/', {
        method: 'POST',
        json: {
          worker_id: Number(workerId),
          booking_date: bookDate,
          booking_time: bookTime.length === 5 ? `${bookTime}:00` : bookTime,
          problem_description: bookNote,
          estimated_price: bookPrice && !isNaN(Number(bookPrice)) ? Number(bookPrice) : null,
          customer_address: customerAddress,
          status: 'pending'
        },
      });

      if (!res.ok) {
        // Surface the backend's reason (e.g. worker unavailable, bad slot).
        const detail = await readApiError(res, 'Failed to create booking');
        throw new Error(detail);
      }
      const bookingData = await res.json();

      // 2. Real-time notification to the worker is emitted by the backend
      //    (POST /bookings pushes 'new_booking_request' over Socket.IO).

      // 3. Update local history with the REAL status (a new booking is
      //    pending, not completed) and cache it under this user's key.
      const agreedPrice = bookPrice && !isNaN(Number(bookPrice)) ? Number(bookPrice) : 0;
      const serverStatus = bookingData.status === 'upcoming' ? 'upcoming' : 'pending';
      const newItem: HistoryItem = {
        id: String(bookingData.id),
        date: bookDate,
        time: bookTime,
        price: agreedPrice,
        status: serverStatus,
      };
      const next = [newItem, ...history];
      setHistory(next);
      await storage.set(historyCacheKey(currentUid), JSON.stringify(next));

      // No client-side notification POST: the backend persists a
      // 'booking_request' notification for the worker (and pushes it over
      // the socket), so an offline worker still sees it — a local-only write
      // from this device would just duplicate it.

      Alert.alert(
        'Booked',
        agreedPrice > 0
          ? `Request sent for ${bookDate} at ${bookTime}. Agreed price ₹${agreedPrice}.`
          : `Request sent for ${bookDate} at ${bookTime}. You can set the agreed price later.`
      );
      setBookDate(''); setBookTime(''); setBookNote(''); setBookPrice('');
      setActiveTab('profile');
    } catch (e: any) {
      console.error('Booking failed', e);
      Alert.alert('Booking failed', e?.message || 'Failed to create booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#6F42C1" style={{ marginTop: 200 }} />
      </View>
    );
  }
  if (!worker) {
    // Not a dead end: give the user a way back AND a way to retry — on web
    // especially there is no swipe-back gesture to escape this screen.
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Couldn&apos;t load this worker</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <TouchableOpacity
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#eee' }}
          >
            <Text style={{ fontWeight: '700', color: '#333' }}>Go back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Retry loading worker"
            onPress={() => {
              setLoading(true);
              void fetchWorkerDetails();
            }}
            style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#6F42C1' }}
          >
            <Text style={{ fontWeight: '700', color: '#fff' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const repeatBooking = history.length >= 2;

  // Jobs the client can review for THIS worker. Includes both completed jobs
  // (legacy flow) and active reviewable states (new flow: client paid and
  // submitted proof, booking is `payment_proof_submitted`). The deep-link from
  // the bookings screen (`?tab=reviews&booking=<id>`) sets `reviewingBookingId`
  // — if the booking is in the active chain but not yet completed, it won't
  // appear in `history` (only completed jobs do) and the form would never
  // open. Injecting it here ensures the form is reachable.
  const reviewableJobs = history.filter((h) => !!h.bookingId);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Worker Details', headerShown: false }} />
      <View style={styles.designFrame}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#6F42C1" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Worker Details</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.workerHeader}>
          <Avatar uri={worker.profile_image} name={worker.full_name} size={90} style={styles.largeAvatar} />
          <Text style={styles.workerNameLarge}>{worker.full_name}</Text>
          <Text style={styles.workerSkill}>{worker.skill || 'Professional'}</Text>
          <View style={styles.ratingRow}>
            <Text style={styles.ratingText}>⭐ {(worker.rating ?? 0).toFixed(1)}</Text>
            <Text style={styles.jobsText}>• {worker.completed_jobs ?? worker.total_jobs ?? 0} jobs</Text>
          </View>
        </View>

        <View style={styles.tabsContainer}>
          {(['profile', 'reviews', 'chat', 'booking', 'map'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.activeTab]} onPress={() => setActiveTab(t)}>
              <Text style={[styles.tabText, activeTab === t && styles.activeTabText]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Same as ai-assistant: window pans, KAV 'padding' lifts inputs above the keyboard. */}
        <KeyboardAvoidingView style={styles.kav} behavior="padding">
        <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          {activeTab === 'profile' && (
            <View style={styles.tabPane}>
              <Detail label="Name" value={worker.full_name || undefined} />
              <Detail label="Age" value={worker.age ? `${worker.age} years` : '—'} />
              <Detail label="Domain" value={worker.skill || 'General'} />
              <Detail label="Wage" value={`₹${worker.hourly_rate || '—'} / hour`} />
              <Detail label="Experience" value={`${worker.experience_years ?? 0} years`} />
              <Detail label="Completed Jobs" value={String(worker.completed_jobs ?? worker.total_jobs ?? 0)} />
              <Detail label="Phone" value={worker.phone || undefined} />
              <Detail label="Alt. Phone" value={worker.alternate_phone || worker.alt_phone || '—'} />
              <Detail label="City" value={worker.city || '—'} />
              <Detail label="Address" value={worker.address || worker.location || '—'} />
              <Detail label="Verified" value={worker.aadhaar_verified ? '✓ Aadhaar Verified' : 'Not verified'} />
            </View>
          )}

          {activeTab === 'reviews' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Your reviews</Text>
              {reviewableJobs.length === 0 ? (
                <View style={styles.noJobsNote}>
                  <Ionicons name="information-circle-outline" size={16} color="#92400e" />
                  <Text style={styles.noJobsNoteText}>
                    You can review {worker.full_name || 'this worker'} after a completed job — each booking gets its own review.
                  </Text>
                </View>
              ) : (
                reviewableJobs.map((h) => {
                  const my = myReviewFor(h.bookingId);
                  return my ? (
                    <View key={h.bookingId} style={styles.feedbackForm}>
                      <View style={styles.jobReviewHead}>
                        <Text style={styles.jobReviewDate}>Job on {h.date || '—'}</Text>
                        <Text style={styles.reviewRating}>⭐ {my.rating.toFixed(1)}</Text>
                      </View>
                      <View style={styles.starsRow}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Ionicons
                            key={star}
                            name={star <= my.rating ? 'star' : 'star-outline'}
                            size={22}
                            color="#FFB800"
                          />
                        ))}
                      </View>
                      {my.text ? <Text style={styles.myReviewText}>&quot;{my.text}&quot;</Text> : null}
                      {my.images && my.images.length > 0 && (
                        <View style={styles.photoPreviewRow}>
                          {my.images.map((img, i) => (
                            <TouchableOpacity key={`${img}-${i}`} activeOpacity={0.8} onPress={() => setViewImage(img)}>
                              <Image source={{ uri: img }} style={styles.photoThumb} resizeMode="cover" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                      <View style={styles.alreadyReviewedNote}>
                        <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                        <Text style={styles.alreadyReviewedText}>You reviewed this booking — one review per job.</Text>
                      </View>
                    </View>
                  ) : (
                    <View key={h.bookingId} style={styles.feedbackForm}>
                      <Text style={styles.jobReviewDate}>Job on {h.date || '—'} · not reviewed yet</Text>
                      {reviewingBookingId === h.bookingId ? (
                        <>
                          <View style={styles.starsRow}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <TouchableOpacity key={star} onPress={() => setFeedbackRating(star)} activeOpacity={0.7}>
                                <Ionicons
                                  name={star <= feedbackRating ? 'star' : 'star-outline'}
                                  size={26}
                                  color="#FFB800"
                                />
                              </TouchableOpacity>
                            ))}
                            <Text style={styles.ratingLabel}>{feedbackRating}/5</Text>
                          </View>
                          <TextInput
                            style={styles.feedbackInput}
                            placeholder="Share your experience with this worker..."
                            placeholderTextColor="#999"
                            multiline
                            value={feedbackText}
                            onChangeText={setFeedbackText}
                          />
                          {feedbackImages.length > 0 && (
                            <View style={styles.photoPreviewRow}>
                              {feedbackImages.map((p, idx) => (
                                <View key={`${p.preview}-${idx}`} style={styles.photoThumbWrap}>
                                  <Image source={{ uri: p.preview }} style={styles.photoThumb} />
                                  <TouchableOpacity
                                    onPress={() => removeReviewImage(idx)}
                                    style={styles.photoRemove}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <Ionicons name="close-circle" size={20} color="#991b1b" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                              {uploadingImage && (
                                <View style={[styles.photoThumbWrap, styles.photoThumbUploading]}>
                                  <ActivityIndicator size="small" color="#6F42C1" />
                                </View>
                              )}
                            </View>
                          )}
                          <TouchableOpacity
                            style={[styles.attachPhotoBtn, feedbackImages.length >= MAX_REVIEW_PHOTOS && { opacity: 0.5 }]}
                            onPress={attachReviewImage}
                            disabled={uploadingImage || feedbackImages.length >= MAX_REVIEW_PHOTOS}
                            activeOpacity={0.8}
                          >
                            {uploadingImage
                              ? <ActivityIndicator size="small" color="#6F42C1" />
                              : <Ionicons name="camera-outline" size={16} color="#6F42C1" />}
                            <Text style={styles.attachPhotoText}>
                              {feedbackImages.length >= MAX_REVIEW_PHOTOS
                                ? `${MAX_REVIEW_PHOTOS}/${MAX_REVIEW_PHOTOS} photos — limit reached`
                                : uploadingImage
                                  ? 'Uploading…'
                                  : `Add photos (${feedbackImages.length}/${MAX_REVIEW_PHOTOS})`}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.submitFeedbackBtn} onPress={() => handleSubmitFeedback(h.bookingId || '')} activeOpacity={0.85}>
                            <Ionicons name="send" size={16} color="#fff" />
                            <Text style={styles.submitFeedbackText}>Submit Review</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <TouchableOpacity
                          style={styles.writeReviewBtn}
                          activeOpacity={0.85}
                          onPress={() => {
                            // One form at a time — reset it when it moves to a
                            // different booking so nothing leaks across jobs.
                            setFeedbackText('');
                            setFeedbackRating(5);
                            setFeedbackImages([]);
                            setReviewingBookingId(h.bookingId || '');
                          }}
                        >
                          <Ionicons name="create-outline" size={16} color="#fff" />
                          <Text style={styles.writeReviewText}>Write review</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })
              )}

              <Text style={[styles.sectionTitle, { marginTop: 24 }]}>What clients say</Text>
              {reviews.map((r) => (
                <View key={r.id} style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <Text style={styles.reviewName}>{r.name}</Text>
                    <Text style={styles.reviewRating}>⭐ {r.rating.toFixed(1)}</Text>
                  </View>
                  <Text style={styles.reviewDate}>{r.date}</Text>
                  <Text style={styles.reviewText}>&quot;{r.text}&quot;</Text>
                  {r.images && r.images.length > 0 && (
                    <View style={styles.photoPreviewRow}>
                      {r.images.map((img, i) => (
                        <TouchableOpacity key={`${img}-${i}`} activeOpacity={0.8} onPress={() => setViewImage(img)}>
                          <Image source={{ uri: img }} style={styles.photoThumb} resizeMode="cover" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {activeTab === 'chat' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Talk to the worker</Text>
              <View style={styles.contactInfo}>
                <Ionicons name="call-outline" size={24} color="#6F42C1" />
                {/* No fabricated placeholder numbers — if the worker has no
                    phone on file, say so instead of showing fake data. */}
                <Text style={styles.phoneText}>{worker.phone || 'No phone number shared'}</Text>
              </View>
              {worker.phone ? (
                <TouchableOpacity style={styles.callButton} onPress={handleCall} accessibilityLabel="Call worker">
                  <Ionicons name="call" size={20} color="white" />
                  <Text style={styles.callButtonText}>Call Worker</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.chatButton]}
                onPress={() => router.push({ pathname: '/chat', params: { workerId, workerName: worker.full_name || '' } })}
              >
                <Ionicons name="chatbubbles-outline" size={20} color="white" />
                <Text style={styles.chatButtonText}>Open AI Translation Chat</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeTab === 'booking' && (
            <View style={styles.tabPane}>
              {history.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>
                    {repeatBooking ? `You've booked ${worker.full_name} ${history.length} times` : 'Your history with this worker'}
                  </Text>
                  {history.map((h) => {
                    const st = historyStatusLabel(h.status);
                    return (
                      <View key={h.id} style={styles.historyCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyDate}>{h.date}  ·  {h.time}</Text>
                          <Text style={[styles.historyStatus, { color: st.color }]}>{st.text}</Text>
                        </View>
                        {/* History rows have no price data — show a dash, never ₹0. */}
                        <Text style={styles.historyPrice}>{h.price > 0 ? `₹${h.price}` : '—'}</Text>
                      </View>
                    );
                  })}
                </>
              )}

              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Book a new slot</Text>
              <View style={styles.bookForm}>
                {slots.some((s) => s.is_available) ? (
                  <View style={styles.hoursBox}>
                    <Ionicons name="time-outline" size={14} color="#6F42C1" />
                    <Text style={styles.hoursText}>
                      {slots
                        .filter((s) => s.is_available)
                        .map((s) => `${DAY_SHORT[(s.available_day || '').toLowerCase()] || s.available_day} ${formatTimeLabel(s.start_time || '')}–${formatTimeLabel(s.end_time || '')}`)
                        .join('  ·  ')}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.hoursNone}>
                    No weekly hours set — any day/time can be requested.
                  </Text>
                )}
                {Platform.OS === 'web' ? (
                  <>
                    <View style={styles.formRow}>
                      <Ionicons name="calendar-outline" size={18} color="#6F42C1" />
                      {React.createElement('input', {
                        type: 'date',
                        value: bookDate,
                        min: new Date().toISOString().slice(0, 10),
                        onChange: (e: any) => setBookDate(e.target.value),
                        style: { flex: 1, padding: 10, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                      })}
                    </View>
                    <View style={styles.formRow}>
                      <Ionicons name="time-outline" size={18} color="#6F42C1" />
                      {React.createElement('input', {
                        type: 'time',
                        value: bookTime ? bookTime.slice(0, 5) : '',
                        onChange: (e: any) => setBookTime(e.target.value),
                        style: { flex: 1, padding: 10, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.formRow} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
                      <Ionicons name="calendar-outline" size={18} color="#6F42C1" />
                      <Text style={[styles.formInput, { paddingVertical: 12, color: bookDate ? '#333' : '#999' }]}>
                        {bookDate || 'Select date'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color="#999" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.formRow} onPress={() => setShowTimePicker(true)} activeOpacity={0.7}>
                      <Ionicons name="time-outline" size={18} color="#6F42C1" />
                      <Text style={[styles.formInput, { paddingVertical: 12, color: bookTime ? '#333' : '#999' }]}>
                        {bookTime ? formatTimeLabel(bookTime) : 'Select time'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color="#999" />
                    </TouchableOpacity>
                  </>
                )}
                <View style={styles.formRow}>
                  <Ionicons name="document-text-outline" size={18} color="#6F42C1" />
                  <TextInput
                    style={styles.formInput}
                    placeholder="Note (optional)"
                    placeholderTextColor="#999"
                    value={bookNote}
                    onChangeText={setBookNote}
                  />
                </View>
                <View style={styles.formRow}>
                  <Ionicons name="pricetag-outline" size={18} color="#6F42C1" />
                  <TextInput
                    style={styles.formInput}
                    placeholder="Agreed price ₹ (after chat with worker)"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    value={bookPrice}
                    onChangeText={setBookPrice}
                  />
                </View>

                <View style={styles.priceBox}>
                  <Text style={styles.priceLabel}>Agreed price</Text>
                  <Text style={[styles.priceValue, !bookPrice && { color: '#FF9800', fontSize: 13 }]}>
                    {bookPrice && !isNaN(Number(bookPrice)) ? `₹${Number(bookPrice)}` : 'Discuss with worker first'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.bookNowButton, submitting && { opacity: 0.6 }]}
                  onPress={handleBookNow}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.bookNowButtonText}>Book Now</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {activeTab === 'map' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Route to worker</Text>
              <View style={styles.mapInfoCard}>
                <View style={styles.mapRow}>
                  <Ionicons name="navigate" size={18} color="#6F42C1" />
                  <Text style={styles.mapLabel}>You</Text>
                  <Text style={styles.mapValue}>{clientLoc ? `${clientLoc.lat.toFixed(3)}, ${clientLoc.lng.toFixed(3)}` : locUnavailable ? 'Location unavailable' : 'Locating…'}</Text>
                </View>
                <View style={styles.mapRow}>
                  <Ionicons name="location" size={18} color="#FF6B6B" />
                  <Text style={styles.mapLabel}>Worker</Text>
                  <Text style={styles.mapValue}>
                    {worker.latitude && worker.longitude
                      ? `${Number(worker.latitude).toFixed(3)}, ${Number(worker.longitude).toFixed(3)}`
                      : worker.city || worker.location || '—'}
                  </Text>
                </View>
                <View style={styles.distanceRow}>
                  <Text style={styles.distanceLabel}>Distance</Text>
                  <Text style={styles.distanceValue}>
                    {distanceKm != null ? `${distanceKm.toFixed(1)} km` : locUnavailable ? 'Location unavailable' : '—'}
                  </Text>
                </View>
              </View>

              {clientLoc && worker.latitude && worker.longitude && (() => {
                const bbox = `${Math.min(clientLoc.lng, worker.longitude) - 0.02},${Math.min(clientLoc.lat, worker.latitude) - 0.02},${Math.max(clientLoc.lng, worker.longitude) + 0.02},${Math.max(clientLoc.lat, worker.latitude) + 0.02}`;
                const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${worker.latitude},${worker.longitude}`;
                return (
                  <View style={styles.mapEmbedWrap}>
                    {Platform.OS === 'web' ? (
                      <iframe style={{ width: '100%', height: 260, border: 0, borderRadius: 12 } as any} src={src} />
                    ) : (
                      <WebView source={{ uri: src }} style={{ width: '100%', height: 260, borderRadius: 12 }} />
                    )}
                  </View>
                );
              })()}

              <TouchableOpacity
                style={styles.openMapsBtn}
                onPress={() => {
                  if (!worker.latitude || !worker.longitude) {
                    Alert.alert('Map', 'Worker location not available');
                    return;
                  }
                  const origin = clientLoc ? `${clientLoc.lat},${clientLoc.lng}` : '';
                  const dest = `${worker.latitude},${worker.longitude}`;
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`);
                }}
              >
                <Ionicons name="map" size={18} color="#fff" />
                <Text style={styles.openMapsBtnText}>Open Route in Google Maps</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {Platform.OS !== 'web' && showDatePicker && (
        <DateTimePicker
          value={(() => {
            if (bookDate) {
              const [y, m, d] = bookDate.split('-').map(Number);
              return new Date(y, (m || 1) - 1, d || 1);
            }
            return new Date();
          })()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
          minimumDate={new Date()}
          onChange={(event, selected) => {
            setShowDatePicker(false);
            if (event.type === 'set' && selected) {
              const y = selected.getFullYear();
              const m = pad(selected.getMonth() + 1);
              const d = pad(selected.getDate());
              setBookDate(`${y}-${m}-${d}`);
            }
          }}
        />
      )}

      {Platform.OS !== 'web' && showTimePicker && (
        <DateTimePicker
          value={(() => {
            if (bookTime) {
              const [h, m] = bookTime.split(':').map(Number);
              const dt = new Date();
              dt.setHours(h || 9, m || 0, 0, 0);
              return dt;
            }
            const dt = new Date();
            dt.setHours(9, 0, 0, 0);
            return dt;
          })()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          is24Hour={false}
          onChange={(event, selected) => {
            setShowTimePicker(false);
            if (event.type === 'set' && selected) {
              const h = pad(selected.getHours());
              const m = pad(selected.getMinutes());
              setBookTime(`${h}:${m}:00`);
            }
          }}
        />
      )}

      {/* Full-screen viewer for review photos. */}
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

      <BottomNav currentRoute="home" />
    </View>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  designFrame: { flex: 1, width: '100%', backgroundColor: '#fff' },
  kav: { flex: 1 },
  errorText: { fontSize: 16, color: '#999' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  workerHeader: { alignItems: 'center', paddingVertical: 16, backgroundColor: '#f8f8f8' },
  largeAvatar: { width: 90, height: 90, borderRadius: 45, marginBottom: 10, backgroundColor: '#e9ecef' },
  workerNameLarge: { fontSize: 18, fontWeight: '800', color: '#333' },
  workerSkill: { fontSize: 13, color: '#666', marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  ratingText: { fontSize: 13, fontWeight: '700', color: '#FFB800' },
  jobsText: { fontSize: 11, color: '#999', marginLeft: 4 },
  tabsContainer: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#6F42C1' },
  tabText: { fontSize: 11, fontWeight: '600', color: '#999' },
  activeTabText: { color: '#6F42C1' },
  tabContent: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  tabPane: { paddingBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#333', marginBottom: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  detailLabel: { fontSize: 13, fontWeight: '700', color: '#666', flex: 1 },
  detailValue: { fontSize: 13, color: '#333', flex: 1.4, textAlign: 'right' },

  reviewCard: { backgroundColor: '#fafafa', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewName: { fontSize: 13, fontWeight: '800', color: '#333' },
  reviewRating: { fontSize: 12, fontWeight: '800', color: '#FFB800' },
  reviewDate: { fontSize: 11, color: '#999', marginTop: 2 },
  reviewText: { fontSize: 12, color: '#444', lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  myReviewText: { fontSize: 13, color: '#333', lineHeight: 19, marginTop: 8, fontStyle: 'italic' },
  alreadyReviewedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#dcfce7', borderRadius: 8, padding: 8, marginTop: 12, borderWidth: 1, borderColor: '#bbf7d0' },
  alreadyReviewedText: { flex: 1, fontSize: 11, fontWeight: '700', color: '#166534' },
  jobReviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  jobReviewDate: { fontSize: 12, fontWeight: '800', color: '#333', marginBottom: 6 },
  writeReviewBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8, gap: 6 },
  writeReviewText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  noJobsNote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb', borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#fde68a' },
  noJobsNoteText: { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 17 },

  feedbackForm: { backgroundColor: '#fcfcfc', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#eee', marginBottom: 10 },
  starsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 4 },
  ratingLabel: { marginLeft: 8, fontSize: 14, fontWeight: '800', color: '#6F42C1' },
  feedbackInput: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', padding: 12, fontSize: 13, minHeight: 80, textAlignVertical: 'top', color: '#333' },
  attachPhotoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#d4c3f2', backgroundColor: '#f5f0fb' },
  attachPhotoText: { fontSize: 12, fontWeight: '700', color: '#6F42C1' },
  photoPreviewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photoThumbWrap: { width: 60, height: 60 },
  photoThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#eee' },
  photoRemove: { position: 'absolute', top: -7, right: -7, backgroundColor: '#fff', borderRadius: 10 },
  photoThumbUploading: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d4c3f2', borderStyle: 'dashed', borderRadius: 8 },
  submitFeedbackBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 6 },
  submitFeedbackText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '92%', height: '75%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 16 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 },

  contactInfo: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', padding: 14, borderRadius: 12, marginBottom: 12 },
  phoneText: { fontSize: 14, fontWeight: '600', color: '#333', marginLeft: 10 },
  callButton: { flexDirection: 'row', backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  callButtonText: { color: '#fff', fontWeight: '700', marginLeft: 8, fontSize: 14 },
  chatButton: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chatButtonText: { color: '#fff', fontWeight: '700', marginLeft: 8, fontSize: 14 },

  historyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fafafa', padding: 10, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  historyDate: { fontSize: 12, fontWeight: '700', color: '#333' },
  historyStatus: { fontSize: 11, color: '#10b981', fontWeight: '700', marginTop: 2 },
  historyPrice: { fontSize: 14, fontWeight: '800', color: '#6F42C1' },

  bookForm: { backgroundColor: '#fafafa', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#eee' },
  hoursBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#f5f0fb', borderRadius: 8, padding: 8, marginBottom: 10, borderWidth: 1, borderColor: '#e6dbf5' },
  hoursText: { flex: 1, fontSize: 11, color: '#4c1d95', lineHeight: 16, fontWeight: '600' },
  hoursNone: { fontSize: 11, color: '#888', marginBottom: 10 },
  formRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee', gap: 8 },
  formInput: { flex: 1, paddingVertical: 10, fontSize: 13, color: '#333' },
  priceBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 10, marginVertical: 6 },
  priceLabel: { fontSize: 12, color: '#666', fontWeight: '700' },
  priceValue: { fontSize: 16, color: '#10b981', fontWeight: '800' },
  bookNowButton: { backgroundColor: '#FF6B6B', paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  bookNowButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  mapInfoCard: { backgroundColor: '#fafafa', padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  mapRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  mapLabel: { fontSize: 12, fontWeight: '700', color: '#666', width: 60 },
  mapValue: { fontSize: 12, color: '#333', flex: 1 },
  distanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  distanceLabel: { fontSize: 13, fontWeight: '700', color: '#666' },
  distanceValue: { fontSize: 16, fontWeight: '800', color: '#6F42C1' },
  mapEmbedWrap: { borderRadius: 12, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  openMapsBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
  openMapsBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: '#333', marginBottom: 10, textAlign: 'center' },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  pickerItemActive: { backgroundColor: '#6F42C1' },
  pickerItemText: { fontSize: 14, fontWeight: '600', color: '#333' },
  pickerItemTextActive: { color: '#fff' },
  pickerItemSub: { fontSize: 11, color: '#999', marginTop: 2 },
});
