import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, getAuth } from '@/lib/api';
import { isCompletedStatus, normalizeBookingStatus } from '@/lib/booking-status';
import { unreadCount } from '@/lib/notifications';
import { platformShadow } from '@/lib/shadow';
import { ensureSocket, onNotificationCreated } from '@/lib/socket';
import { storage } from '@/lib/storage';
import { BookingResponse, PastWorkItem, ReviewResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const WORKER_PROFILE_KEY = 'workmithra:worker_profile';

type Tab = 'details' | 'past';

type WorkerProfile = {
  full_name?: string;
  age?: string;
  skill?: string;
  hourly_rate?: string;
  experience_years?: string;
  phone?: string;
  alternate_phone?: string;
  profile_image?: string;
  location?: string;
  pincode?: string;
  email?: string;
  bio?: string;
  // city/timings are part of the shared worker_profile cache that the profile
  // EDIT form also reads — the dashboard must persist them too, otherwise a
  // save from a cache-only load would blank them out on the server.
  city?: string;
  timings?: string;
  aadhaar_verified?: boolean;
  completed_jobs?: number;
  rating?: number;
};

export default function WorkerDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('details');
  const [profile, setProfile] = useState<WorkerProfile>({});
  const [pastWork, setPastWork] = useState<PastWorkItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadingWork, setLoadingWork] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Pull-to-refresh has its own flag so its spinner animates independently of
  // the initial-load spinner.
  const [refreshing, setRefreshing] = useState(false);

  const [userId, setUserId] = useState<string>('');
  // Full-screen viewer for review photos on the Past Work cards.
  const [viewImage, setViewImage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const auth = await getAuth();
        if (auth?.id) setUserId(String(auth.id));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    // One initial fetch for the badge; after that the backend pushes
    // 'notification_created' (with the fresh unread count) over the socket,
    // so no polling interval is needed.
    unreadCount('worker', userId).then((n) => { if (alive) setUnread(n); }).catch(() => {});
    let off: () => void = () => {};
    (async () => {
      // ensureSocket() is async — the listener must be registered only after
      // the socket exists, otherwise onNotificationCreated no-ops.
      await ensureSocket();
      if (!alive) return;
      off = onNotificationCreated((data) => {
        if (data.audience !== 'worker' || String(data.recipient_id) !== userId) return;
        setUnread((u) => (typeof data.unread_count === 'number' ? data.unread_count : u + 1));
      });
    })();
    return () => { alive = false; off(); };
  }, [userId]);

  // Local cache for instant paint — but only if it belongs to the current
  // worker. Users and workers have overlapping ids and a device can host
  // multiple accounts, so an unguarded read could paint account A's cached
  // profile onto account B's dashboard after a switch.
  useEffect(() => {
    (async () => {
      const p = await storage.get(WORKER_PROFILE_KEY);
      if (!p) return;
      try {
        const cached = JSON.parse(p);
        if (!cached.__uid || String(cached.__uid) === String(userId)) {
          setProfile(cached);
        }
      } catch {}
    })();
  }, [userId]);

  /** Fetch profile + past work. silent=true (re-focus / pull-to-refresh)
   * keeps the existing list on screen instead of flashing the spinner. */
  const loadDashboard = useCallback(async (silent: boolean) => {
    // Wait for the real user id from storage — never query with a guessed id.
    if (!userId) return;

    if (!silent) {
      setLoadingWork(true);
    }
    setLoadError('');

    // Live profile from backend
    try {
      const wRes = await authFetch(`/workers/${userId}`);
      if (wRes.ok) {
        const w = await wRes.json();
        const merged: WorkerProfile = {
          full_name: w.full_name,
          age: w.age != null ? String(w.age) : undefined,
          skill: w.skill,
          hourly_rate: w.hourly_rate != null ? String(w.hourly_rate) : undefined,
          experience_years: w.experience_years != null ? String(w.experience_years) : undefined,
          phone: w.phone,
          alternate_phone: w.alternate_phone || w.alt_phone,
          profile_image: w.profile_image,
          location: w.location || w.city || w.address,
          pincode: w.pincode,
          email: w.email,
          bio: w.bio,
          // Keep the shared cache complete for the profile EDIT form — it
          // reads city/timings from this same key.
          city: w.city,
          timings: w.timings,
          aadhaar_verified: !!w.aadhaar_verified,
          completed_jobs: w.completed_jobs ?? w.total_jobs,
          rating: w.rating,
        };
        setProfile(merged);
        // Tag the cache with the owning account id — the profile form's read
        // guard refuses entries whose __uid doesn't match, so an untagged
        // write here would leak this account's profile onto another's load.
        storage.set(WORKER_PROFILE_KEY, JSON.stringify({ ...merged, __uid: userId })).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to fetch worker profile', e);
    }

    try {
      // The worker's token scopes this list to their own bookings.
      // limit=100 — the default 20 silently truncates the past-work history.
      const res = await authFetch('/bookings/?limit=100');
      if (!res.ok) {
        // An error must never masquerade as "no past work yet".
        setLoadError('Could not load your work history. Pull down or reopen to retry.');
        return;
      }
      const data: BookingResponse[] = await res.json();
      const completed = data.filter((b) => isCompletedStatus(normalizeBookingStatus(b.status)));

      // Fetch all reviews for this worker once, then index by booking_id.
      const reviewByBooking: Record<string, ReviewResponse> = {};
      try {
        const rr = await authFetch(`/reviews/?worker_id=${userId}`);
        if (rr.ok) {
          const reviews: ReviewResponse[] = await rr.json();
          for (const r of reviews) {
            if (r.booking_id != null) reviewByBooking[String(r.booking_id)] = r;
          }
        }
      } catch {}

      // Client name/avatar come embedded on each booking — no extra requests.
      const past = completed.map((b) => {
        const review = reviewByBooking[String(b.id)];
        const client = b.user;
        // Prefer the multi-image array; older reviews only carry the single
        // legacy review_image field.
        const reviewImages = review
          ? review.review_images && review.review_images.length > 0
            ? review.review_images
            : review.review_image
              ? [review.review_image]
              : []
          : [];
        return {
          id: String(b.id),
          client_name: client?.full_name || `User ${b.user_id}`,
          client_avatar: client?.profile_image || undefined,
          place: b.customer_address || 'Local Area',
          date: b.booking_date || 'Recent',
          description: b.problem_description || 'Completed service',
          payment: b.final_price || b.estimated_price || 0,
          // Only an AGREED (final) price is real earnings — a proposal the
          // client never accepted is not money in the bank.
          earned: b.final_price || 0,
          rating: review ? Number(review.rating) || 0 : 0,
          review: review ? (review.review_text || '') : '',
          review_images: reviewImages,
        };
      });
      setPastWork(past);
    } catch (e) {
      console.warn('Failed to fetch past work', e);
      setLoadError('Could not load your work history. Pull down or reopen to retry.');
    } finally {
      if (!silent) setLoadingWork(false);
    }
  }, [userId]);

  // Focus-driven refresh: the bottom nav PUSHES screens and back pops them,
  // so this dashboard stays mounted while the worker marks jobs completed on
  // the Requests screen — a mount-only fetch would show stale history when
  // they return. Re-fetch every time the screen comes into focus.
  const hasLoadedRef = React.useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const silent = hasLoadedRef.current;
      hasLoadedRef.current = true;
      void loadDashboard(silent);
    }, [userId, loadDashboard]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboard(true);
    setRefreshing(false);
  }, [loadDashboard]);

  // Average over REVIEWED jobs only — counting unreviewed jobs as 0 stars
  // would drag the rating down unfairly.
  const reviewed = pastWork.filter((w) => w.rating > 0);
  const avgRating = reviewed.length
    ? (reviewed.reduce((s, w) => s + w.rating, 0) / reviewed.length).toFixed(1)
    : '0.0';
  const totalEarn = pastWork.reduce((s, w) => s + w.earned, 0);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>

        {/* Top hero */}
        <View style={styles.hero}>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/notifications')}
            activeOpacity={0.85}
          >
            <Ionicons name="notifications-outline" size={18} color="#fff" />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <Avatar uri={profile.profile_image} name={profile.full_name} size={88} style={styles.heroAvatar} />
          <Text style={styles.heroName}>{profile.full_name || 'Worker'}</Text>
          {profile.skill ? <Text style={styles.heroSkill}>{profile.skill}</Text> : null}
          <View style={styles.heroBadges}>
            <View style={styles.badge}>
              <Ionicons name="star" size={12} color="#FFB800" />
              <Text style={styles.badgeText}>{avgRating}</Text>
            </View>
            <View style={styles.badge}>
              <Ionicons name="briefcase-outline" size={12} color="#6F42C1" />
              <Text style={styles.badgeText}>{pastWork.length} jobs</Text>
            </View>
            <View style={styles.badge}>
              <Ionicons name="wallet-outline" size={12} color="#10b981" />
              <Text style={styles.badgeText}>₹{totalEarn}</Text>
            </View>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'details' && styles.tabBtnActive]} onPress={() => setTab('details')}>
            <Text style={[styles.tabText, tab === 'details' && styles.tabTextActive]}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'past' && styles.tabBtnActive]} onPress={() => setTab('past')}>
            <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>Past Work</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6F42C1" colors={['#6F42C1']} />
          }
        >
          {tab === 'details' ? (
            <View style={styles.section}>
              {profile.bio ? (
                <View style={styles.bioCard}>
                  <Text style={styles.bioTitle}>About me</Text>
                  <Text style={styles.bioText}>{profile.bio}</Text>
                </View>
              ) : null}

              <DetailGroup title="Personal">
                <Detail icon="person-outline" label="Name" value={profile.full_name} />
                <Detail icon="calendar-outline" label="Age" value={profile.age ? `${profile.age} years` : '—'} />
                <Detail icon="mail-outline" label="Email" value={profile.email} />
                <Detail icon="call-outline" label="Phone" value={profile.phone} />
                <Detail icon="call-outline" label="Alt. Phone" value={profile.alternate_phone} />
              </DetailGroup>

              <DetailGroup title="Work">
                <Detail icon="briefcase-outline" label="Domain" value={profile.skill} />
                <Detail icon="cash-outline" label="Wage" value={profile.hourly_rate ? `₹${profile.hourly_rate}/hr` : '—'} />
                <Detail icon="trophy-outline" label="Experience" value={profile.experience_years ? `${profile.experience_years} years` : '—'} />
                <Detail icon="checkmark-done-outline" label="Completed jobs" value={String(profile.completed_jobs ?? pastWork.length)} />
                <Detail icon="star-outline" label="Average rating" value={`⭐ ${avgRating}`} />
              </DetailGroup>

              <DetailGroup title="Location">
                <Detail icon="location-outline" label="City / Area" value={profile.location} />
                <Detail icon="pin-outline" label="Pincode" value={profile.pincode} />
              </DetailGroup>

              <DetailGroup title="Verification">
                <Detail
                  icon={profile.aadhaar_verified ? 'shield-checkmark' : 'shield-outline'}
                  label="Aadhaar"
                  value={profile.aadhaar_verified ? '✓ Verified' : 'Not verified'}
                />
              </DetailGroup>
            </View>
          ) : (
            <View style={styles.section}>
              {loadingWork ? (
                <ActivityIndicator color="#6F42C1" style={{ marginTop: 30 }} />
              ) : loadError ? (
                <Text style={styles.empty}>{loadError}</Text>
              ) : pastWork.length === 0 ? (
                <Text style={styles.empty}>No past work yet</Text>
              ) : (
                pastWork.map((w) => (
                  <View key={w.id} style={styles.pastCard}>
                    {/* Cover area for the completed work (no photo upload yet) */}
                    {w.photo ? (
                      <Image source={{ uri: w.photo }} style={styles.workPhoto} />
                    ) : (
                      <View style={[styles.workPhoto, styles.workPhotoPlaceholder]}>
                        <Ionicons name="checkmark-circle" size={28} color="#10b981" />
                        <Text style={styles.workPhotoPlaceholderText}>Job Completed</Text>
                      </View>
                    )}

                    {/* Description + place + date */}
                    <View style={styles.workBody}>
                      <View style={styles.workHeaderRow}>
                        <Text style={styles.workPlace} numberOfLines={1}>{w.place}</Text>
                        <Text style={styles.workDate}>{w.date}</Text>
                      </View>
                      <Text style={styles.workDesc}>{w.description}</Text>

                      {/* Client row + payment + rating */}
                      <View style={styles.clientRow}>
                        <Avatar uri={w.client_avatar} name={w.client_name} size={32} style={styles.clientAvatar} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.clientName} numberOfLines={1}>{w.client_name}</Text>
                          <View style={styles.starRow}>
                            <Ionicons name="star" size={12} color="#FFB800" />
                            <Text style={styles.starText}>{w.rating.toFixed(1)}</Text>
                          </View>
                        </View>
                        <View style={styles.paymentPill}>
                          <Text style={styles.paymentText}>₹{w.payment}</Text>
                        </View>
                      </View>

                      {/* Review — text plus any photos the client attached. */}
                      {w.review || (w.review_images && w.review_images.length > 0) ? (
                        <View style={styles.reviewBox}>
                          <View style={styles.reviewHeadRow}>
                            <Ionicons name="chatbox-ellipses" size={14} color="#6F42C1" />
                            <Text style={styles.reviewTitle}>Client review</Text>
                            <View style={styles.reviewStars}>
                              {[1, 2, 3, 4, 5].map((s) => (
                                <Ionicons
                                  key={s}
                                  name={s <= Math.round(w.rating) ? 'star' : 'star-outline'}
                                  size={11}
                                  color="#FFB800"
                                />
                              ))}
                            </View>
                          </View>
                          {w.review ? (
                            <Text style={styles.reviewText}>&quot;{w.review}&quot;</Text>
                          ) : null}
                          {w.review_images && w.review_images.length > 0 && (
                            <View style={styles.reviewImageRow}>
                              {w.review_images.map((img, i) => (
                                <TouchableOpacity
                                  key={`${img}-${i}`}
                                  activeOpacity={0.8}
                                  onPress={() => setViewImage(img)}
                                >
                                  <Image source={{ uri: img }} style={styles.reviewThumb} resizeMode="cover" />
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      ) : (
                        <View style={[styles.reviewBox, styles.reviewBoxEmpty]}>
                          <Ionicons name="chatbox-ellipses-outline" size={14} color="#999" />
                          <Text style={styles.reviewEmptyText}>Client hasn&apos;t reviewed this job yet</Text>
                        </View>
                      )}
                    </View>
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
      <BottomNav currentRoute="dashboard" role="worker" />
    </View>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.detailGroup}>
      <Text style={styles.detailGroupTitle}>{title}</Text>
      <View style={styles.detailGroupBody}>{children}</View>
    </View>
  );
}

function Detail({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value?: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={14} color="#6F42C1" />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#fff' },

  hero: { alignItems: 'center', paddingTop: 18, paddingBottom: 14, backgroundColor: '#6F42C1', borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  bellBtn: { position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#FF6B6B', paddingHorizontal: 3, justifyContent: 'center', alignItems: 'center' },
  bellBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  heroAvatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#fff', borderWidth: 3, borderColor: '#fff' },
  heroName: { fontSize: 16, fontWeight: '800', color: '#fff', marginTop: 8 },
  heroSkill: { fontSize: 12, color: '#e9d5ff', marginTop: 2 },
  heroBadges: { flexDirection: 'row', gap: 8, marginTop: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#333' },

  tabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginHorizontal: 16, marginTop: 14, marginBottom: 10 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },

  section: { paddingHorizontal: 16 },
  empty: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 30 },

  bioCard: { backgroundColor: '#f5f0ff', borderRadius: 10, padding: 10, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#6F42C1' },
  bioTitle: { fontSize: 11, fontWeight: '800', color: '#6F42C1', marginBottom: 4 },
  bioText: { fontSize: 12, color: '#444', lineHeight: 17 },

  detailGroup: { marginBottom: 12 },
  detailGroupTitle: { fontSize: 11, fontWeight: '800', color: '#6F42C1', marginBottom: 6, marginLeft: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailGroupBody: { backgroundColor: '#fafafa', borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: '#eee' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 8 },
  detailLabel: { fontSize: 12, fontWeight: '700', color: '#666', width: 110 },
  detailValue: { fontSize: 12, color: '#333', flex: 1, textAlign: 'right' },

  pastCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#eee', ...platformShadow('0px 1px 4px rgba(0,0,0,0.07)', '#000', 0, 1, 0.07, 2, 1) },
  workPhoto: { width: '100%', height: 140, backgroundColor: '#e9ecef' },
  workPhotoPlaceholder: { justifyContent: 'center', alignItems: 'center', gap: 6 },
  workPhotoPlaceholderText: { fontSize: 12, fontWeight: '700', color: '#9ca3af' },
  workBody: { padding: 12 },
  workHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workPlace: { fontSize: 13, fontWeight: '800', color: '#333', flex: 1, marginRight: 8 },
  workDate: { fontSize: 11, color: '#999' },
  workDesc: { fontSize: 12, color: '#555', lineHeight: 17, marginTop: 4 },
  clientRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  clientAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e9ecef' },
  clientName: { fontSize: 12, fontWeight: '700', color: '#333' },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  starText: { fontSize: 11, fontWeight: '700', color: '#FFB800' },
  paymentPill: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  paymentText: { fontSize: 12, fontWeight: '800', color: '#166534' },
  reviewBox: { backgroundColor: '#faf7ff', borderRadius: 8, padding: 8, marginTop: 8 },
  reviewHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reviewTitle: { fontSize: 11, fontWeight: '800', color: '#6F42C1', flex: 1 },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewText: { fontSize: 11, color: '#444', fontStyle: 'italic', lineHeight: 16, marginTop: 5 },
  reviewImageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  reviewThumb: { width: 58, height: 58, borderRadius: 8, backgroundColor: '#eee', borderWidth: 1, borderColor: '#eee' },
  reviewBoxEmpty: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fafafa' },
  reviewEmptyText: { fontSize: 11, color: '#999', fontStyle: 'italic' },

  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '92%', height: '75%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 16 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 },
});
