import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, getAuth, readApiError } from '@/lib/api';
import { normalizeBookingStatus } from '@/lib/booking-status';
import { pickImageWithPreview } from '@/lib/image-picker';
import { platformShadow } from '@/lib/shadow';
import { uploadMultipart } from '@/lib/upload';
import { BookingResponse, ReviewResponse, UserProfileResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
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

type Tab = 'profile' | 'chat' | 'map' | 'requests' | 'reviews';

// Maximum photos attachable to one review (enforced by the backend too).
const MAX_REVIEW_PHOTOS = 5;

type ClientProfile = {
  id: string;
  full_name: string;
  age?: number;
  email?: string;
  phone?: string;
  alternate_phone?: string;
  address?: string;
  city?: string;
  location?: string;
  pincode?: string;
  joined?: string;
  avatar?: string;
  latitude?: number;
  longitude?: number;
};

type RequestItem = {
  id: string;
  date: string;
  time: string;
  service: string;
  note?: string;
  price: number;
  status: 'pending' | 'accepted' | 'declined' | 'completed' | 'payment_proof_submitted';
};

function toRad(d: number) { return (d * Math.PI) / 180; }
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// (Fallback only — used if backend lookup fails. Shows just the known name;
// never fabricate contact details for a real client.)
function getFallbackClient(id: string, name?: string): ClientProfile {
  return {
    id: id || '0',
    full_name: name || `User ${id}`,
  };
}

function statusColor(s: RequestItem['status']) {
  if (s === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (s === 'accepted') return { bg: '#dbeafe', fg: '#1e40af', label: '✓ Accepted' };
  if (s === 'declined') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Declined' };
  return { bg: '#fef3c7', fg: '#92400e', label: '⏳ Pending' };
}

export default function UserProfilePage() {
  const router = useRouter();
  const { clientId, clientName, tab: tabParam, bookingId: bookingParam } = useLocalSearchParams<{ clientId?: string; clientName?: string; tab?: string; bookingId?: string }>();
  // Callers can deep-link to a tab (e.g. the requests screen's "Review
  // client" opens straight onto the review form): /user_profile?clientId=5&tab=reviews
  const initialTab: Tab = (['profile', 'chat', 'map', 'requests', 'reviews'] as Tab[]).includes(tabParam as Tab)
    ? (tabParam as Tab)
    : 'profile';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [workerLoc, setWorkerLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locUnavailable, setLocUnavailable] = useState(false);

  // Review state — reviews the client RECEIVED (worker-written) plus the
  // form this worker uses to add their own after a completed job.
  type ReviewItem = { id: string | number; workerId?: string; bookingId?: string; name: string; rating: number; date: string; text: string; images?: string[] };
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  // The logged-in worker's id — used to pick their own reviews out of the
  // list (one per completed booking) and show them as read-only cards.
  const [myWid, setMyWid] = useState('');
  // The booking whose review form is currently open (one form at a time).
  const [reviewingBookingId, setReviewingBookingId] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackImages, setFeedbackImages] = useState<{ url: string; preview: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  // Full-screen viewer for review photos.
  const [viewImage, setViewImage] = useState<string | null>(null);

  async function loadReviews() {
    const cid = String(clientId || '');
    if (!cid) return;
    try {
      const res = await authFetch(`/reviews/?user_id=${cid}`);
      if (!res.ok) return;
      const data: ReviewResponse[] = await res.json();
      setReviews(
        data.map((r) => ({
          id: r.id,
          // worker_id carries the REVIEWER's id for worker-written reviews —
          // used below to spot this worker's own review.
          workerId: r.worker_id != null ? String(r.worker_id) : undefined,
          bookingId: r.booking_id != null ? String(r.booking_id) : undefined,
          // user_name carries the REVIEWER's display name — for client
          // reviews that's the worker who wrote it.
          name: r.user_name || 'Worker',
          rating: Number(r.rating) || 0,
          date: r.created_at ? String(r.created_at).split('T')[0] : '',
          text: r.review_text || '',
          // Prefer the multi-image array; older reviews only carry the
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
      const picked = await pickImageWithPreview();
      if (!picked) { setUploadingImage(false); return; }
      const part = picked.part;
      const preview = picked.preview;
      const data = await uploadMultipart<{ url: string }>('/upload-review-image', part);
      setFeedbackImages((imgs) => [...imgs, { url: data.url, preview }]);
    } catch (e: any) {
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
      Alert.alert('Review', 'Please write something before submitting.');
      return;
    }
    if (uploadingImage) {
      Alert.alert('Photo still uploading', 'Wait for the photo upload to finish, or remove it.');
      return;
    }
    const cid = Number(clientId);
    if (!cid || Number.isNaN(cid)) {
      Alert.alert('Submit failed', 'Invalid client id.');
      return;
    }
    if (submittingReview) return;
    setSubmittingReview(true);
    const urls = feedbackImages.map((p) => p.url);
    try {
      const res = await authFetch('/reviews/', {
        method: 'POST',
        json: {
          // Worker reviewing a CLIENT — user_id is the reviewed client; the
          // backend verifies a completed booking between the pair.
          user_id: cid,
          // Pin the review to THIS booking — each completed job gets its own
          // review (the backend enforces one review per booking per side).
          booking_id: Number(bookingId),
          rating: feedbackRating,
          review_text: feedbackText,
          review_image: urls[0],
          review_images: urls.length > 0 ? urls : undefined,
        },
      });
      if (!res.ok) {
        // Surface the backend's reason cleanly (e.g. "You can only review a
        // client after a completed booking with them").
        const detail = await readApiError(res, 'Could not submit your review');
        Alert.alert('Submit failed', detail);
        return;
      }
      setFeedbackText('');
      setFeedbackRating(5);
      setFeedbackImages([]);
      setReviewingBookingId('');
      await loadReviews();
      Alert.alert('Success', 'Thank you for your review!');
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message || 'Network error');
    } finally {
      setSubmittingReview(false);
    }
  }

  useEffect(() => {
    (async () => {
      const cid = String(clientId || '');
      if (!cid) return;

      // 0. This worker's own id — needed to spot their own review in the
      // list and swap the form for a read-only "your review" card.
      try {
        const auth = await getAuth();
        if (auth?.id) setMyWid(String(auth.id));
      } catch {}
      // Deep link from the requests screen ("Review client" / "View my
      // rating") carries the booking — open its review form straight away.
      if (tabParam === 'reviews' && bookingParam) setReviewingBookingId(String(bookingParam));

      // 1. Fetch real client profile from backend
      try {
        const res = await authFetch(`/profiles/user/${cid}`);
        if (res.ok) {
          const u: UserProfileResponse = await res.json();
          setClient({
            id: String(u.id),
            full_name: u.full_name || (clientName ? String(clientName) : `User ${cid}`),
            age: u.age ?? undefined,
            email: u.email ?? undefined,
            phone: u.phone ?? undefined,
            alternate_phone: u.alternate_phone ?? undefined,
            address: u.address ?? undefined,
            city: u.city ?? undefined,
            location: u.location || u.address || undefined,
            pincode: u.pincode ?? undefined,
            joined: u.created_at ? String(u.created_at).slice(0, 10) : undefined,
            avatar: u.profile_image || undefined,
            latitude: u.latitude ?? undefined,
            longitude: u.longitude ?? undefined,
          });
        } else {
          setClient(getFallbackClient(cid, clientName ? String(clientName) : undefined));
        }
      } catch (e) {
        console.warn('Failed to fetch client profile', e);
        setClient(getFallbackClient(cid, clientName ? String(clientName) : undefined));
      }

      // 2. Fetch real requests this client made. The worker's token scopes the
      // list to their own bookings; we then narrow to this client locally.
      // limit=100 — the default 20 silently truncates a busy worker's list.
      try {
        const res = await authFetch('/bookings/?limit=100');
        if (res.ok) {
          const list: BookingResponse[] = await res.json();
          const mapped: RequestItem[] = list
            .filter((b) => String(b.user_id) === cid)
            .map((b) => {
              const s = normalizeBookingStatus(b.status);
              return {
                id: String(b.id),
                date: b.booking_date || 'Unknown',
                time: b.booking_time || '',
                service: b.problem_description || 'General Service',
                note: b.problem_description || undefined,
                price: b.final_price || b.estimated_price || 0,
                status:
                  s === 'completed' ? 'completed' :
                  s === 'upcoming' ? 'accepted' :
                  s === 'rejected' ? 'declined' :
                  s === 'payment_proof_submitted' ? 'payment_proof_submitted' :
                  'pending',
              };
            });
          setRequests(mapped);
        }
      } catch (e) {
        console.warn('Failed to fetch client requests', e);
      }

      // 3. Reviews this client received from workers.
      loadReviews();
    })();
  }, [clientId, clientName]);

  useEffect(() => {
    if (tab === 'map') tryGetLocation();
  }, [tab]);

  async function tryGetLocation() {
    // On failure we leave workerLoc null and flag locUnavailable — the UI
    // then says "Location unavailable" instead of silently substituting a
    // hardcoded point (which produced wildly wrong distances).
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setLocUnavailable(true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => setWorkerLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocUnavailable(true),
        { enableHighAccuracy: false, timeout: 5000 },
      );
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocUnavailable(true); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setWorkerLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setLocUnavailable(true);
    }
  }

  const distanceKm = useMemo(() => {
    if (!workerLoc || !client?.latitude || !client?.longitude) return null;
    return haversineKm(workerLoc.lat, workerLoc.lng, client.latitude, client.longitude);
  }, [workerLoc, client]);

  // Average of the worker-written reviews this client received — shown as a
  // badge so a worker can gauge the client before accepting a job.
  const avgClientRating = useMemo(() => {
    if (reviews.length === 0) return null;
    return (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
  }, [reviews]);

  // The review THIS worker wrote for a specific booking, if any. Reviews are
  // per booking — the same client can be reviewed once per completed job.
  function myReviewFor(bookingId?: string) {
    if (!myWid || !bookingId) return undefined;
    return reviews.find((r) => r.workerId === myWid && r.bookingId === bookingId);
  }

  // Completed jobs for this client — each one gets its own review slot
  // (reviewed = read-only card, otherwise a write form).
  const completedRequests = requests.filter((r) => r.status === 'completed' || r.status === 'payment_proof_submitted');

  async function updateRequest(id: string, status: RequestItem['status']) {
    // Optimistic update, rolled back if the server rejects the change.
    const prevStatus = requests.find((r) => r.id === id)?.status;
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    // Map the UI label to the canonical backend status enum.
    const backendStatus = status === 'accepted' ? 'upcoming' : status === 'declined' ? 'rejected' : status;
    try {
      const res = await authFetch(`/bookings/${id}`, {
        method: 'PUT',
        json: { status: backendStatus },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.detail === 'string' ? data.detail : `Server responded with ${res.status}`;
        if (prevStatus) {
          setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status: prevStatus } : r)));
        }
        Alert.alert('Update failed', msg);
      }
    } catch (e: any) {
      console.warn('Failed to update booking status', e);
      if (prevStatus) {
        setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status: prevStatus } : r)));
      }
      Alert.alert('Update failed', e?.message || 'Could not reach the server. Please try again.');
    }
  }

  if (!client) {
    // With a clientId this is a normal in-flight load (spinner). Without one the
    // fetch never runs, so a bare spinner would be a permanent dead end — on web
    // there's no swipe-back to escape. Always offer a way back.
    const hasId = !!String(clientId || '');
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          {hasId ? (
            <ActivityIndicator color="#6F42C1" />
          ) : (
            <>
              <Ionicons name="person-outline" size={40} color="#ccc" />
              <Text style={styles.noClientText}>No client selected</Text>
            </>
          )}
          <TouchableOpacity style={styles.backLinkBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={16} color="#6F42C1" />
            <Text style={styles.backLinkText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>

        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Client Details</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Avatar uri={client.avatar} name={client.full_name} size={90} style={styles.heroAvatar} />
          <Text style={styles.heroName}>{client.full_name}</Text>
          <Text style={styles.heroSub}>{client.city || client.location || '—'}{client.joined ? ` · joined ${client.joined}` : ''}</Text>
          <View style={styles.heroBadges}>
            {avgClientRating && (
              <View style={styles.badge}>
                <Ionicons name="star" size={11} color="#FFB800" />
                <Text style={styles.badgeText}>{avgClientRating}</Text>
              </View>
            )}
            <View style={styles.badge}>
              <Ionicons name="briefcase-outline" size={11} color="#6F42C1" />
              <Text style={styles.badgeText}>{requests.length} requests</Text>
            </View>
            <View style={styles.badge}>
              <Ionicons name="checkmark-done-outline" size={11} color="#10b981" />
              <Text style={styles.badgeText}>{requests.filter(r => r.status === 'completed').length} done</Text>
            </View>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {(['profile', 'chat', 'map', 'requests', 'reviews'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={styles.tabContent} contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
          {tab === 'profile' && (
            <View>
              <DetailGroup title="Personal">
                <Detail icon="person-outline" label="Name" value={client.full_name} />
                <Detail icon="calendar-outline" label="Age" value={client.age ? `${client.age} years` : '—'} />
                <Detail icon="mail-outline" label="Email" value={client.email} />
                <Detail icon="call-outline" label="Phone" value={client.phone} />
                <Detail icon="call-outline" label="Alt. Phone" value={client.alternate_phone} />
              </DetailGroup>

              <DetailGroup title="Address">
                <Detail icon="home-outline" label="Address" value={client.address} />
                <Detail icon="location-outline" label="Locality" value={client.location} />
                <Detail icon="business-outline" label="City" value={client.city} />
                <Detail icon="pin-outline" label="Pincode" value={client.pincode} />
              </DetailGroup>

              <DetailGroup title="Account">
                <Detail icon="time-outline" label="Joined" value={client.joined} />
                <Detail icon="document-text-outline" label="Total requests" value={String(requests.length)} />
              </DetailGroup>
            </View>
          )}

          {tab === 'chat' && (
            <View>
              <Text style={styles.sectionTitle}>Contact this client</Text>
              <View style={styles.contactInfo}>
                <Ionicons name="call-outline" size={22} color="#6F42C1" />
                {/* No fabricated placeholder numbers — say what's true. */}
                <Text style={styles.phoneText}>{client.phone || 'No phone number shared'}</Text>
              </View>
              {client.phone ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  accessibilityLabel="Call client"
                  onPress={async () => {
                    const url = `tel:${client.phone}`;
                    try {
                      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
                      else Alert.alert('Call', 'Calling is not supported on this device');
                    } catch {
                      Alert.alert('Call', 'Could not start the call');
                    }
                  }}
                >
                  <Ionicons name="call" size={18} color="#fff" />
                  <Text style={styles.callBtnText}>  Call Client</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.chatBtn}
                onPress={() => router.push({ pathname: '/chat', params: { workerId: client.id, workerName: client.full_name } })}
              >
                <Ionicons name="chatbubbles-outline" size={18} color="#fff" />
                <Text style={styles.chatBtnText}>  Open AI Translation Chat</Text>
              </TouchableOpacity>
            </View>
          )}

          {tab === 'map' && (
            <View>
              <Text style={styles.sectionTitle}>Route to client</Text>
              <View style={styles.mapInfoCard}>
                <View style={styles.mapRow}>
                  <Ionicons name="navigate" size={16} color="#6F42C1" />
                  <Text style={styles.mapLabel}>You</Text>
                  <Text style={styles.mapValue}>{workerLoc ? `${workerLoc.lat.toFixed(3)}, ${workerLoc.lng.toFixed(3)}` : locUnavailable ? 'Location unavailable' : 'Locating…'}</Text>
                </View>
                <View style={styles.mapRow}>
                  <Ionicons name="location" size={16} color="#FF6B6B" />
                  <Text style={styles.mapLabel}>Client</Text>
                  <Text style={styles.mapValue}>
                    {client.latitude && client.longitude
                      ? `${client.latitude.toFixed(3)}, ${client.longitude.toFixed(3)}`
                      : client.address || '—'}
                  </Text>
                </View>
                <View style={styles.distanceRow}>
                  <Text style={styles.distanceLabel}>Distance</Text>
                  <Text style={styles.distanceValue}>{distanceKm != null ? `${distanceKm.toFixed(1)} km` : locUnavailable ? 'Location unavailable' : '—'}</Text>
                </View>
              </View>

              {workerLoc && client.latitude && client.longitude && (() => {
                const bbox = `${Math.min(workerLoc.lng, client.longitude) - 0.02},${Math.min(workerLoc.lat, client.latitude) - 0.02},${Math.max(workerLoc.lng, client.longitude) + 0.02},${Math.max(workerLoc.lat, client.latitude) + 0.02}`;
                const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${client.latitude},${client.longitude}`;
                return (
                  <View style={styles.mapEmbedWrap}>
                    {Platform.OS === 'web' ? (
                      React.createElement('iframe', {
                        style: { width: '100%', height: 240, border: 0, borderRadius: 12 } as React.CSSProperties,
                        src,
                        title: 'Map showing client location',
                        loading: 'lazy',
                      })
                    ) : (
                      <WebView source={{ uri: src }} style={{ width: '100%', height: 240, borderRadius: 12 }} />
                    )}
                  </View>
                );
              })()}

              <TouchableOpacity
                style={styles.openMapsBtn}
                onPress={async () => {
                  if (!client.latitude || !client.longitude) return Alert.alert('Map', 'Client location not available');
                  const origin = workerLoc ? `${workerLoc.lat},${workerLoc.lng}` : '';
                  const dest = `${client.latitude},${client.longitude}`;
                  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
                  try {
                    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
                    else Alert.alert('Map', 'Could not open Google Maps on this device');
                  } catch {
                    Alert.alert('Map', 'Could not open Google Maps on this device');
                  }
                }}
              >
                <Ionicons name="map" size={16} color="#fff" />
                <Text style={styles.openMapsBtnText}>  Open Route in Google Maps</Text>
              </TouchableOpacity>
            </View>
          )}

          {tab === 'requests' && (
            <View>
              <Text style={styles.sectionTitle}>Requests from {client.full_name.split(' ')[0]}</Text>
              {requests.map((r) => {
                const sc = statusColor(r.status);
                return (
                  <View key={r.id} style={styles.reqCard}>
                    <View style={styles.reqHeader}>
                      <Text style={styles.reqService}>{r.service}</Text>
                      <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                        <Text style={[styles.statusText, { color: sc.fg }]}>{sc.label}</Text>
                      </View>
                    </View>
                    <View style={styles.reqRow}>
                      <Ionicons name="calendar-outline" size={13} color="#666" />
                      <Text style={styles.reqMeta}>{r.date}  ·  {r.time}</Text>
                    </View>
                    {r.note ? (
                      <View style={styles.reqRow}>
                        <Ionicons name="document-text-outline" size={13} color="#666" />
                        <Text style={styles.reqNote}>{r.note}</Text>
                      </View>
                    ) : null}
                    <View style={styles.reqFooter}>
                      <Text style={styles.reqPrice}>₹{r.price}</Text>
                      {r.status === 'pending' && (
                        <View style={styles.reqActions}>
                          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#10b981' }]} onPress={() => updateRequest(r.id, 'accepted')}>
                            <Text style={styles.actionText}>Accept</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FF6B6B' }]} onPress={() => updateRequest(r.id, 'declined')}>
                            <Text style={styles.actionText}>Decline</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {tab === 'reviews' && (
            <View>
              <Text style={styles.sectionTitle}>Your reviews</Text>
              {completedRequests.length === 0 ? (
                <View style={styles.noJobsNote}>
                  <Ionicons name="information-circle-outline" size={16} color="#92400e" />
                  <Text style={styles.noJobsNoteText}>
                    You can review {client.full_name.split(' ')[0]} after a completed job — each booking gets its own review.
                  </Text>
                </View>
              ) : (
                completedRequests.map((req) => {
                  const my = myReviewFor(req.id);
                  return my ? (
                    <View key={req.id} style={styles.feedbackForm}>
                      <View style={styles.jobReviewHead}>
                        <Text style={styles.jobReviewDate}>Job on {req.date || '—'} · {req.service}</Text>
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
                    <View key={req.id} style={styles.feedbackForm}>
                      <Text style={styles.jobReviewDate}>Job on {req.date || '—'} · {req.service} · not reviewed yet</Text>
                      {reviewingBookingId === req.id ? (
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
                            placeholder="Share your experience working with this client..."
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
                          <TouchableOpacity
                            style={[styles.submitFeedbackBtn, submittingReview && { opacity: 0.6 }]}
                            onPress={() => handleSubmitFeedback(req.id)}
                            disabled={submittingReview}
                            activeOpacity={0.85}
                          >
                            {submittingReview
                              ? <ActivityIndicator color="#fff" />
                              : <Ionicons name="send" size={16} color="#fff" />}
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
                            setReviewingBookingId(req.id);
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

              <Text style={[styles.sectionTitle, { marginTop: 18 }]}>
                What workers say ({reviews.length})
              </Text>
              {reviews.length === 0 ? (
                <Text style={styles.noReviews}>No worker reviews yet</Text>
              ) : (
                reviews.map((r) => (
                  <View key={r.id} style={styles.reviewCard}>
                    <View style={styles.reviewHeader}>
                      <Text style={styles.reviewName}>{r.name}</Text>
                      <Text style={styles.reviewRating}>⭐ {r.rating.toFixed(1)}</Text>
                    </View>
                    <Text style={styles.reviewDate}>{r.date}</Text>
                    {r.text ? <Text style={styles.reviewText}>&quot;{r.text}&quot;</Text> : null}
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
                ))
              )}
            </View>
          )}
        </ScrollView>

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
      </View>
      <BottomNav currentRoute="requests" role="worker" />
    </View>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

function Detail({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value?: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={13} color="#6F42C1" />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noClientText: { marginTop: 10, fontSize: 14, fontWeight: '700', color: '#999' },
  backLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: '#f0e6ff' },
  backLinkText: { fontSize: 13, fontWeight: '700', color: '#6F42C1' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#6F42C1', paddingHorizontal: 14, paddingVertical: 10 },
  headerTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },

  hero: { alignItems: 'center', paddingTop: 14, paddingBottom: 14, backgroundColor: '#6F42C1', borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  heroAvatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#fff', borderWidth: 3, borderColor: '#fff' },
  heroName: { fontSize: 16, fontWeight: '800', color: '#fff', marginTop: 8 },
  heroSub: { fontSize: 11, color: '#e9d5ff', marginTop: 2 },
  heroBadges: { flexDirection: 'row', gap: 8, marginTop: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#333' },

  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#6F42C1' },
  tabText: { fontSize: 11, fontWeight: '700', color: '#999' },
  tabTextActive: { color: '#6F42C1' },

  tabContent: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#333', marginBottom: 10 },

  groupTitle: { fontSize: 10, fontWeight: '800', color: '#6F42C1', marginBottom: 6, marginLeft: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  groupBody: { backgroundColor: '#fafafa', borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: '#eee' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 8 },
  detailLabel: { fontSize: 12, fontWeight: '700', color: '#666', width: 100 },
  detailValue: { fontSize: 12, color: '#333', flex: 1, textAlign: 'right' },

  contactInfo: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', padding: 12, borderRadius: 10, marginBottom: 10 },
  phoneText: { fontSize: 13, color: '#333', marginLeft: 8, fontWeight: '700' },
  callBtn: { flexDirection: 'row', backgroundColor: '#10b981', paddingVertical: 11, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  callBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  chatBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 11, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chatBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  mapInfoCard: { backgroundColor: '#fafafa', padding: 10, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  mapRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  mapLabel: { fontSize: 11, fontWeight: '800', color: '#666', width: 50 },
  mapValue: { fontSize: 11, color: '#333', flex: 1 },
  distanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#eee' },
  distanceLabel: { fontSize: 12, fontWeight: '700', color: '#666' },
  distanceValue: { fontSize: 15, fontWeight: '800', color: '#6F42C1' },
  mapEmbedWrap: { borderRadius: 12, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  openMapsBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 11, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  openMapsBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  reqCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee', ...platformShadow('0px 1px 4px rgba(0,0,0,0.06)', '#000', 0, 1, 0.06, 2, 1) },
  reqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reqService: { fontSize: 13, fontWeight: '800', color: '#333', flex: 1, marginRight: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 10, fontWeight: '800' },
  reqRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  reqMeta: { fontSize: 11, color: '#666' },
  reqNote: { fontSize: 11, color: '#666', flex: 1, fontStyle: 'italic' },
  reqFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  reqPrice: { fontSize: 14, fontWeight: '800', color: '#10b981' },
  reqActions: { flexDirection: 'row', gap: 6 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  actionText: { fontSize: 11, color: '#fff', fontWeight: '800' },

  // --- reviews tab (worker reviews the client) ---
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
  noReviews: { fontSize: 12, color: '#999', fontStyle: 'italic', marginTop: 4 },
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
  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '92%', height: '75%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 16 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 },
});
