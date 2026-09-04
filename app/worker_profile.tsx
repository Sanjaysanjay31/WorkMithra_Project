import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, readApiError } from '@/lib/api';
import { AvailabilitySlot, listAvailability, upsertAvailability } from '@/lib/availability';
import { useI18n } from '@/lib/i18n';
import { pickImageNative, pickImageWeb } from '@/lib/image-picker';
import { disconnectSocket } from '@/lib/socket';
import { clearAllWorkMitraStorage, storage } from '@/lib/storage';
import { UploadFilePart, uploadMultipart } from '@/lib/upload';
import { ReviewResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const WORKER_KEY = 'workmithra:worker_profile';

type WorkerForm = {
  full_name: string;
  age: string;
  email: string;
  phone: string;
  alternate_phone: string;
  skill: string;
  experience_years: string;
  hourly_rate: string;
  bio: string;
  timings: string;
  city: string;
  location: string;
  pincode: string;
  aadhaar_verified: boolean;
  profile_image: string;
};

const EMPTY: WorkerForm = {
  full_name: '', age: '', email: '', phone: '', alternate_phone: '',
  skill: '', experience_years: '', hourly_rate: '', bio: '', timings: '',
  city: '', location: '', pincode: '', aadhaar_verified: false, profile_image: '',
};

// ── Availability editor ────────────────────────────────────────────────────

const DAYS: { key: string; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

type DayState = {
  slot_id: number | null;
  is_available: boolean;
  start_time: string;
  end_time: string;
};

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function formatTimeLabel(value: string): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr); const m = Number(mStr);
  const hr12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hr12}:${pad(m)} ${ampm}`;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dateFromTime(t: string): Date {
  const [h, m] = t.split(':').map(Number);
  const dt = new Date();
  dt.setHours(h || 9, m || 0, 0, 0);
  return dt;
}

function emptyWeek(): Record<string, DayState> {
  return Object.fromEntries(
    DAYS.map((d) => [d.key, { slot_id: null, is_available: false, start_time: DEFAULT_START, end_time: DEFAULT_END }]),
  );
}

function mergeSlots(base: Record<string, DayState>, slots: AvailabilitySlot[]): Record<string, DayState> {
  const next = { ...base };
  slots.forEach((s) => {
    const key = (s.available_day || '').toLowerCase();
    if (!next[key]) return;
    next[key] = {
      slot_id: s.id,
      is_available: s.is_available,
      start_time: s.start_time || DEFAULT_START,
      end_time: s.end_time || DEFAULT_END,
    };
  });
  return next;
}

/** Review a client wrote about this worker (shown on the My Reviews tab). */
type ReceivedReview = {
  id: string | number;
  name: string;
  rating: number;
  date: string;
  text: string;
  images?: string[];
};

export default function WorkerProfilePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [profile, setProfile] = useState<WorkerForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [showPwdForm, setShowPwdForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [currentWorkerId, setCurrentWorkerId] = useState('');

  // Reviews this worker RECEIVED from clients — shown on the My Reviews tab
  // (the mirror of the client profile's My Reviews tab).
  const [reviews, setReviews] = useState<ReceivedReview[]>([]);
  // Full-screen viewer for review photos.
  const [viewImage, setViewImage] = useState<string | null>(null);

  // Availability editor state (Active hours tab)
  const [availDays, setAvailDays] = useState<Record<string, DayState>>(emptyWeek());
  const [availLoading, setAvailLoading] = useState(true);
  const [availError, setAvailError] = useState('');
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ day: string; field: 'start_time' | 'end_time' } | null>(null);
  // Details / Reviews / Active hours / Settings tabs — keeps the profile compact
  // instead of one endless scroll.
  const [tab, setTab] = useState<'details' | 'reviews' | 'hours' | 'settings'>('details');

  useEffect(() => { load(); }, []);

  async function loadReviews(wid: string) {
    if (!wid) return;
    try {
      const res = await authFetch(`/reviews/?worker_id=${wid}`);
      if (!res.ok) return;
      const data: ReviewResponse[] = await res.json();
      setReviews(
        data.map((r) => ({
          id: r.id,
          // user_name carries the REVIEWER's display name — the client.
          name: r.user_name || 'Client',
          rating: Number(r.rating) || 0,
          date: r.created_at ? String(r.created_at).split('T')[0] : '',
          text: r.review_text || '',
          images:
            r.review_images && r.review_images.length > 0
              ? r.review_images
              : r.review_image
                ? [r.review_image]
                : undefined,
        })),
      );
    } catch (e) {
      console.warn('Failed to load received reviews', e);
    }
  }

  async function load() {
    let wid = '';
    try {
      const authRaw = await storage.get('workmithra:auth');
      if (authRaw) {
        const auth = JSON.parse(authRaw);
        if (auth.id) { wid = String(auth.id); setCurrentWorkerId(wid); }
      }
    } catch {}

    // Use local cache only if it belongs to the current worker id.
    try {
      const raw = await storage.get(WORKER_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (!cached.__uid || String(cached.__uid) === wid) {
          setProfile({ ...EMPTY, ...cached });
        } else {
          await storage.remove(WORKER_KEY);
          setProfile(EMPTY);
        }
      }
    } catch {}

    if (!wid) return;
    // Reviews from clients load alongside the profile (independent request —
    // a failure there must not block the profile form).
    void loadReviews(wid);

    // Load availability
    setAvailLoading(true);
    setAvailError('');
    try {
      const slots = await listAvailability(Number(wid));
      setAvailDays((prev) => mergeSlots(emptyWeek(), slots));
    } catch (e: any) {
      console.warn('Failed to load availability', e);
      setAvailError(e?.message || 'Could not reach the server.');
    }
    setAvailLoading(false);
    try {
      const res = await authFetch(`/workers/${wid}`);
      if (!res.ok) return;
      const w = await res.json();
      const fromServer: WorkerForm = {
        full_name: w.full_name || '',
        age: w.age != null ? String(w.age) : '',
        email: w.email || '',
        phone: w.phone || '',
        alternate_phone: w.alternate_phone || w.alt_phone || '',
        skill: w.skill || '',
        experience_years: w.experience_years != null ? String(w.experience_years) : '',
        hourly_rate: w.hourly_rate != null ? String(w.hourly_rate) : '',
        bio: w.bio || '',
        timings: w.timings || '',
        city: w.city || '',
        location: w.location || w.address || '',
        pincode: w.pincode || '',
        aadhaar_verified: !!w.aadhaar_verified,
        profile_image: w.profile_image || '',
      };
      setProfile(fromServer);
      // Persist WITH the owning account's id — the cache-read guard refuses
      // entries whose __uid doesn't match, so an untagged write here would
      // leak account A's profile onto account B's next load.
      await storage.set(WORKER_KEY, JSON.stringify({ ...fromServer, __uid: wid }));
    } catch (e) {
      console.warn('Failed to load worker from backend', e);
    }
  }

  // ── Availability helpers ─────────────────────────────────────────────────

  async function saveAvailDay(dayKey: string, patch: Partial<DayState>) {
    if (!currentWorkerId) return;
    const merged = { ...availDays[dayKey], ...patch };
    setAvailDays((d) => ({ ...d, [dayKey]: merged }));
    setBusyDay(dayKey);
    const saved = await upsertAvailability({
      worker_id: Number(currentWorkerId),
      available_day: dayKey,
      start_time: merged.start_time,
      end_time: merged.end_time,
      is_available: merged.is_available,
    });
    setBusyDay(null);
    if (saved) {
      setAvailDays((d) => ({ ...d, [dayKey]: { ...merged, slot_id: saved.id } }));
    } else {
      Alert.alert('Not saved', 'Could not update your availability. Please try again.');
      try {
        const slots = await listAvailability(Number(currentWorkerId));
        setAvailDays(() => mergeSlots(emptyWeek(), slots));
      } catch { /* keep optimistic value */ }
    }
  }

  function onAvailTimeChange(dayKey: string, field: 'start_time' | 'end_time', value: string) {
    if (!value) return;
    const cur = availDays[dayKey];
    const next = { ...cur, [field]: value, is_available: true };
    if (toMinutes(next.start_time) >= toMinutes(next.end_time)) {
      Alert.alert('Invalid time window', 'Start time must be before end time.');
      return;
    }
    void saveAvailDay(dayKey, next);
  }

  // ── General helpers ─────────────────────────────────────────────────────

  function update<K extends keyof WorkerForm>(k: K, v: any) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (!currentWorkerId) {
      Alert.alert('Not logged in', 'Please log in again to save your profile.');
      return;
    }
    if (!profile.full_name.trim() || !profile.phone.trim()) {
      Alert.alert('Missing info', 'Name and phone are required.');
      return;
    }
    setSaving(true);
    try {
      // aadhaar_verified is server-owned (set by admin verification only) —
      // never send it from the client. Numeric fields travel as numbers; an
      // empty input is omitted (undefined) rather than sent as "" — the
      // backend would reject "" for an int/float field with a 422.
      const { aadhaar_verified, age, experience_years, hourly_rate, ...rest } = profile;
      const toNumber = (v: string): number | undefined => {
        const t = v.trim();
        if (!t) return undefined;
        const n = Number(t);
        return Number.isFinite(n) ? n : undefined;
      };
      const payload = {
        ...rest,
        age: toNumber(age),
        experience_years: toNumber(experience_years),
        hourly_rate: toNumber(hourly_rate),
      };
      const res = await authFetch(`/workers/${currentWorkerId}`, {
        method: 'PUT',
        json: payload,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.detail === 'string' ? data.detail : `Server responded with ${res.status}`;
        Alert.alert('Save failed', msg);
        return;
      }
      // Cache only after the server accepted the change, so the local copy
      // never diverges from what's actually stored.
      await storage.set(WORKER_KEY, JSON.stringify({ ...profile, __uid: currentWorkerId }));
      Alert.alert('Saved', 'Your worker profile has been saved.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function pickAndUploadImage() {
    if (!currentWorkerId) {
      Alert.alert('Not logged in', 'Please log in again to upload a photo.');
      return;
    }
    setUploading(true);
    try {
      // Uploads go through uploadMultipart (XHR): global fetch rejects
      // { uri, name, type } parts on native with "Unsupported FormDataPart".
      let part: UploadFilePart;
      if (Platform.OS === 'web') {
        const file = await pickImageWeb();
        if (!file) { setUploading(false); return; }
        part = file;
      } else {
        const asset = await pickImageNative();
        if (!asset) { setUploading(false); return; }
        const name = asset.fileName || asset.uri.split('/').pop() || 'photo.jpg';
        const ext = (name.split('.').pop() || 'jpg').toLowerCase();
        const mime = asset.mimeType || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
        part = { uri: asset.uri, name, type: mime };
      }
      const data = await uploadMultipart<{ url: string }>('/upload-profile-image', part, {
        fields: { user_id: currentWorkerId, role: 'worker' },
      });
      const next = { ...profile, profile_image: data.url };
      setProfile(next);
      await storage.set(WORKER_KEY, JSON.stringify({ ...next, __uid: currentWorkerId }));
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload image');
    } finally {
      setUploading(false);
    }
  }

  async function changePasswordWithCurrent() {
    if (!profile.email.trim()) return Alert.alert('Email needed', 'Please enter your email in the form first.');
    if (!currentPwd || !newPwd) return Alert.alert('Missing fields', 'Enter current and new password.');
    // Same 8-character minimum as register/forgot-password/profile.
    if (newPwd.length < 8) return Alert.alert('Weak password', 'Use at least 8 characters.');
    if (newPwd !== confirmPwd) return Alert.alert('Mismatch', 'New passwords do not match.');
    setPwdLoading(true);
    try {
      const res = await authFetch('/change-password', {
        method: 'POST',
        json: { email: profile.email, current_password: currentPwd, new_password: newPwd },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Change failed');
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd(''); setShowPwdForm(false);
      Alert.alert('Done', 'Password changed successfully.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not change password');
    } finally {
      setPwdLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        {/* Same as ai-assistant: window pans, KAV 'padding' lifts inputs above the keyboard. */}
        <KeyboardAvoidingView style={styles.kav} behavior="padding">
          {/* Hero header */}
          <View style={styles.hero}>
            <View style={styles.avatarWrap}>
              <Avatar uri={profile.profile_image} name={profile.full_name} size={130} style={styles.avatar} />
              <TouchableOpacity style={styles.cameraBadge} onPress={pickAndUploadImage} activeOpacity={0.85}>
                {uploading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="camera" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
            <Text style={styles.heroName}>{profile.full_name || 'Your Name'}</Text>
            <Text style={styles.heroSkill}>{profile.skill || 'Add your skill'}</Text>
            <View style={styles.heroBadges}>
              {profile.hourly_rate ? (
                <View style={styles.badge}>
                  <Ionicons name="cash-outline" size={11} color="#10b981" />
                  <Text style={styles.badgeText}>₹{profile.hourly_rate}/hr</Text>
                </View>
              ) : null}
              {profile.experience_years ? (
                <View style={styles.badge}>
                  <Ionicons name="trophy-outline" size={11} color="#FFB800" />
                  <Text style={styles.badgeText}>{profile.experience_years} yrs</Text>
                </View>
              ) : null}
              <View style={styles.badge}>
                <Ionicons name={profile.aadhaar_verified ? 'shield-checkmark' : 'shield-outline'} size={11} color={profile.aadhaar_verified ? '#10b981' : '#999'} />
                <Text style={styles.badgeText}>{profile.aadhaar_verified ? 'Verified' : 'Unverified'}</Text>
              </View>
            </View>
          </View>

          {/* Details / Reviews / Settings switch — keeps the worker profile
              compact instead of one endless scroll. */}
          <View style={styles.tabRow}>
            <TouchableOpacity style={[styles.tab, tab === 'details' && styles.tabActive]} onPress={() => setTab('details')}>
              <Text style={[styles.tabText, tab === 'details' && styles.tabTextActive]}>My Details</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'reviews' && styles.tabActive]} onPress={() => setTab('reviews')}>
              <Text style={[styles.tabText, tab === 'reviews' && styles.tabTextActive]}>
                My Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'hours' && styles.tabActive]} onPress={() => setTab('hours')}>
              <Text style={[styles.tabText, tab === 'hours' && styles.tabTextActive]} numberOfLines={1}>Active hours</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'settings' && styles.tabActive]} onPress={() => setTab('settings')}>
              <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>Settings</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {tab === 'details' && (
              <>
          {/* Bio */}
          <View style={styles.section}>
            <SectionTitle>About me</SectionTitle>
            <View style={styles.fieldGroup}>
              <View style={styles.bioWrap}>
                <Ionicons name="chatbox-ellipses-outline" size={14} color="#6F42C1" style={{ marginTop: 6 }} />
                <TextInput
                  style={styles.bioInput}
                  multiline
                  placeholder="Tell clients about your work, specialties, and approach…"
                  placeholderTextColor="#999"
                  value={profile.bio}
                  onChangeText={(v) => update('bio', v)}
                />
              </View>
            </View>
          </View>

          {/* Personal */}
          <View style={styles.section}>
            <SectionTitle>Personal</SectionTitle>
            <View style={styles.fieldGroup}>
              <Field label="Full Name" icon="person-outline" value={profile.full_name} onChange={(v) => update('full_name', v)} placeholder="Your name" />
              <Field label="Age" icon="calendar-outline" value={profile.age} onChange={(v) => update('age', v)} placeholder="e.g. 32" keyboardType="numeric" />
              <Field label="Email" icon="mail-outline" value={profile.email} onChange={(v) => update('email', v)} placeholder="you@example.com" keyboardType="email-address" />
              <Field label="Phone" icon="call-outline" value={profile.phone} onChange={(v) => update('phone', v)} placeholder="+91 XXXXXXXXXX" keyboardType="phone-pad" />
              <Field label="Alt. Phone" icon="call-outline" value={profile.alternate_phone} onChange={(v) => update('alternate_phone', v)} placeholder="Optional" keyboardType="phone-pad" last />
            </View>
          </View>

          {/* Work */}
          <View style={styles.section}>
            <SectionTitle>Work</SectionTitle>
            <View style={styles.fieldGroup}>
              <Field label="Domain / Skill" icon="briefcase-outline" value={profile.skill} onChange={(v) => update('skill', v)} placeholder="e.g. Plumber" />
              <Field label="Experience (yrs)" icon="trophy-outline" value={profile.experience_years} onChange={(v) => update('experience_years', v)} placeholder="e.g. 5" keyboardType="numeric" />
              <Field label="Wage (₹/hour)" icon="cash-outline" value={profile.hourly_rate} onChange={(v) => update('hourly_rate', v)} placeholder="e.g. 500" keyboardType="numeric" />
              <Field label="Timings" icon="time-outline" value={profile.timings} onChange={(v) => update('timings', v)} placeholder="e.g. 9 AM - 7 PM" last />
            </View>
          </View>

          {/* Location */}
          <View style={styles.section}>
            <SectionTitle>Location</SectionTitle>
            <View style={styles.fieldGroup}>
              <Field label="City" icon="business-outline" value={profile.city} onChange={(v) => update('city', v)} placeholder="e.g. Hyderabad" />
              <Field label="Area" icon="location-outline" value={profile.location} onChange={(v) => update('location', v)} placeholder="e.g. Madhapur" />
              <Field label="Pincode" icon="pin-outline" value={profile.pincode} onChange={(v) => update('pincode', v)} placeholder="6-digit pincode" keyboardType="numeric" last />
            </View>
          </View>

          {/* Verification status — read-only. Verification is granted by
              WorkMitra after document checks; workers cannot self-verify. */}
          <View style={styles.section}>
            <SectionTitle>Verification</SectionTitle>
            <View style={styles.verifyRow}>
              <View style={[styles.verifyIcon, { backgroundColor: profile.aadhaar_verified ? '#dcfce7' : '#f0f0f0' }]}>
                <Ionicons
                  name={profile.aadhaar_verified ? 'shield-checkmark' : 'shield-outline'}
                  size={18}
                  color={profile.aadhaar_verified ? '#10b981' : '#999'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.verifyTitle}>Aadhaar Verification</Text>
                <Text style={styles.verifySub}>
                  {profile.aadhaar_verified
                    ? 'You are verified'
                    : 'Pending — WorkMithra verifies your documents before marking your profile as verified'}
                </Text>
              </View>
            </View>
          </View>

          {/* Save */}
          <View style={[styles.section, { paddingTop: 4 }]}>
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="save" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}>  Save Changes</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
              </>
            )}

            {tab === 'reviews' && (
              // Reviews this worker RECEIVED from clients — the worker's side
              // of the review system (clients see the mirror on their profile).
              <View style={styles.section}>
                <SectionTitle>My Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}</SectionTitle>
                {reviews.length === 0 ? (
                  <View style={styles.reviewsEmpty}>
                    <Ionicons name="star-outline" size={18} color="#999" />
                    <Text style={styles.reviewsEmptyText}>
                      No reviews yet — clients can review you after a completed job.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.reviewsSummary}>
                      <Ionicons name="star" size={16} color="#FFB800" />
                      <Text style={styles.reviewsSummaryText}>
                        {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)} average from {reviews.length} {reviews.length === 1 ? 'client' : 'clients'}
                      </Text>
                    </View>
                    {reviews.map((r) => (
                      <View key={r.id} style={styles.reviewCard}>
                        <View style={styles.reviewHeader}>
                          <Text style={styles.reviewName}>{r.name}</Text>
                          <Text style={styles.reviewRating}>⭐ {r.rating.toFixed(1)}</Text>
                        </View>
                        <Text style={styles.reviewDate}>{r.date}</Text>
                        {r.text ? <Text style={styles.reviewText}>&quot;{r.text}&quot;</Text> : null}
                        {r.images && r.images.length > 0 && (
                          <View style={styles.reviewImageRow}>
                            {r.images.map((img, i) => (
                              <TouchableOpacity key={`${img}-${i}`} activeOpacity={0.8} onPress={() => setViewImage(img)}>
                                <Image source={{ uri: img }} style={styles.reviewThumb} resizeMode="cover" />
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}

            {tab === 'hours' && (
              <>
          {/* Inline availability editor — same UX as worker_availability.tsx */}
          <View style={styles.section}>
            <SectionTitle>Your Availability</SectionTitle>
            <Text style={styles.hoursDesc}>
              Clients can only book you during these hours. Days you switch off block new requests.
            </Text>
            {availLoading ? (
              <ActivityIndicator color="#6F42C1" style={{ marginVertical: 20 }} />
            ) : availError ? (
              <View style={{ alignItems: 'center', padding: 16 }}>
                <Text style={{ color: '#b91c1c', fontSize: 13, textAlign: 'center' }}>{availError}</Text>
                <TouchableOpacity style={{ marginTop: 10 }} onPress={() => void load()}>
                  <Text style={{ color: '#6F42C1', fontWeight: '700', fontSize: 13 }}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
            <Text style={styles.availCount}>
              Available {DAYS.filter((d) => availDays[d.key]?.is_available).length} of 7 days
            </Text>
            {DAYS.map((d) => {
              const st = availDays[d.key];
              const busy = busyDay === d.key;
              return (
                <View key={d.key} style={[styles.dayCard, !st.is_available && styles.dayCardOff]}>
                  <View style={styles.dayHead}>
                    <Text style={[styles.dayName, !st.is_available && styles.dayNameOff]}>{d.label}</Text>
                    <View style={styles.dayHeadRight}>
                      {busy && <ActivityIndicator size="small" color="#6F42C1" />}
                      <Switch
                        value={st.is_available}
                        onValueChange={(v) => void saveAvailDay(d.key, { is_available: v })}
                        disabled={busy}
                        trackColor={{ false: '#e5e7eb', true: '#d4c3f2' }}
                        thumbColor={st.is_available ? '#6F42C1' : '#f4f4f5'}
                      />
                    </View>
                  </View>
                  {st.is_available ? (
                    Platform.OS === 'web' ? (
                      <View style={styles.timeRow}>
                        <View style={styles.webTimeWrap}>
                          <Ionicons name="time-outline" size={14} color="#6F42C1" />
                          {React.createElement('input', {
                            type: 'time',
                            value: st.start_time,
                            onChange: (e: any) => onAvailTimeChange(d.key, 'start_time', e.target.value),
                            style: { flex: 1, padding: 6, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                          })}
                        </View>
                        <Text style={styles.timeSep}>to</Text>
                        <View style={styles.webTimeWrap}>
                          <Ionicons name="time-outline" size={14} color="#6F42C1" />
                          {React.createElement('input', {
                            type: 'time',
                            value: st.end_time,
                            onChange: (e: any) => onAvailTimeChange(d.key, 'end_time', e.target.value),
                            style: { flex: 1, padding: 6, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                          })}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.timeRow}>
                        <TouchableOpacity
                          style={styles.timeChip}
                          activeOpacity={0.7}
                          disabled={busy}
                          onPress={() => setPicker({ day: d.key, field: 'start_time' })}
                        >
                          <Ionicons name="time-outline" size={13} color="#6F42C1" />
                          <Text style={styles.timeChipText}>{formatTimeLabel(st.start_time)}</Text>
                        </TouchableOpacity>
                        <Text style={styles.timeSep}>to</Text>
                        <TouchableOpacity
                          style={styles.timeChip}
                          activeOpacity={0.7}
                          disabled={busy}
                          onPress={() => setPicker({ day: d.key, field: 'end_time' })}
                        >
                          <Ionicons name="time-outline" size={13} color="#6F42C1" />
                          <Text style={styles.timeChipText}>{formatTimeLabel(st.end_time)}</Text>
                        </TouchableOpacity>
                      </View>
                    )
                  ) : (
                    <Text style={styles.offText}>Not available — new bookings are blocked</Text>
                  )}
                </View>
              );
            })}
              </>
            )}
          </View>
              </>
            )}

            {tab === 'settings' && (
              <>
          {/* Switch Role + Logout */}
          <View style={styles.section}>
            <SectionTitle>Account Settings</SectionTitle>
            <TouchableOpacity
              style={styles.pwdOption}
              onPress={async () => {
                const doSwitch = async () => {
                  disconnectSocket();
                  await clearAllWorkMitraStorage();
                  router.replace('/login');
                };
                const message = t('auth.switchRoleMessage');
                if (Platform.OS === 'web') {
                  if (typeof window !== 'undefined' && window.confirm(message)) {
                    await doSwitch();
                  }
                } else {
                  Alert.alert(t('auth.switchTitle'), message, [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.switch'), style: 'destructive', onPress: doSwitch },
                  ]);
                }
              }}
            >
              <View style={[styles.pwdIcon, { backgroundColor: '#e0f2fe' }]}>
                <Ionicons name="swap-horizontal" size={18} color="#0284c7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pwdTitle}>Switch Role</Text>
                <Text style={styles.pwdSub}>Log out and switch between Worker and User</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.pwdOption}
              onPress={async () => {
                const doLogout = async () => {
                  disconnectSocket();
                  await clearAllWorkMitraStorage();
                  router.replace('/login');
                };
                const message = t('auth.logoutMessage');
                if (Platform.OS === 'web') {
                  if (typeof window !== 'undefined' && window.confirm(message)) {
                    await doLogout();
                  }
                } else {
                  Alert.alert(t('auth.logoutTitle'), message, [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.logout'), style: 'destructive', onPress: doLogout },
                  ]);
                }
              }}
            >
              <View style={[styles.pwdIcon, { backgroundColor: '#fee2e2' }]}>
                <Ionicons name="log-out-outline" size={18} color="#FF6B6B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pwdTitle}>Logout</Text>
                <Text style={styles.pwdSub}>Sign out of your account</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </TouchableOpacity>
          </View>

          {/* Password change */}
          <View style={styles.section}>
            <SectionTitle>Change Password</SectionTitle>
            {!showPwdForm ? (
              <>
                <TouchableOpacity style={styles.pwdOption} onPress={() => setShowPwdForm(true)}>
                  <View style={[styles.pwdIcon, { backgroundColor: '#f0e6ff' }]}>
                    <Ionicons name="lock-closed-outline" size={18} color="#6F42C1" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pwdTitle}>Using current password</Text>
                    <Text style={styles.pwdSub}>I know my current password</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#999" />
                </TouchableOpacity>

                <TouchableOpacity style={styles.pwdOption} onPress={() => router.push('/forgot-password')}>
                  <View style={[styles.pwdIcon, { backgroundColor: '#fee2e2' }]}>
                    <Ionicons name="key-outline" size={18} color="#FF6B6B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pwdTitle}>Forgot password</Text>
                    <Text style={styles.pwdSub}>Get an OTP on email to reset</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#999" />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.pwdForm}>
                <Field label="Current Password" icon="lock-closed-outline" value={currentPwd} onChange={setCurrentPwd} placeholder="Current password" secure={!showPwd} />
                <Field label="New Password" icon="lock-open-outline" value={newPwd} onChange={setNewPwd} placeholder="New password" secure={!showPwd} />
                <Field label="Confirm New Password" icon="shield-checkmark-outline" value={confirmPwd} onChange={setConfirmPwd} placeholder="Re-enter new password" secure={!showPwd} last />

                <TouchableOpacity onPress={() => setShowPwd((v) => !v)} style={{ alignSelf: 'flex-end', marginVertical: 6 }}>
                  <Text style={{ color: '#6F42C1', fontSize: 12, fontWeight: '700' }}>{showPwd ? 'Hide' : 'Show'} passwords</Text>
                </TouchableOpacity>

                <View style={styles.row}>
                  <TouchableOpacity style={[styles.cancelBtn, { flex: 1, marginRight: 8 }]} onPress={() => { setShowPwdForm(false); setCurrentPwd(''); setNewPwd(''); setConfirmPwd(''); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.saveBtn, { flex: 1, marginTop: 0 }]} onPress={changePasswordWithCurrent} disabled={pwdLoading}>
                    {pwdLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Update</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
              </>
            )}
        </ScrollView>
        </KeyboardAvoidingView>

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

        {/* DateTimePicker for availability time selection. */}
        {picker ? (
          <DateTimePicker
            value={dateFromTime(availDays[picker.day]?.[picker.field] || '09:00')}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_: any, date?: Date) => {
              if (Platform.OS !== 'ios') setPicker(null);
              if (date) {
                const hh = pad(date.getHours());
                const mm = pad(date.getMinutes());
                onAvailTimeChange(picker.day, picker.field, `${hh}:${mm}`);
              }
              if (Platform.OS === 'ios') setPicker(null);
            }}
          />
        ) : null}
      </View>
      <BottomNav currentRoute="profile_worker" role="worker" />
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Field({
  label, icon, value, onChange, placeholder, keyboardType, secure, last,
}: {
  label: string;
  icon: any;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  secure?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.fieldRow, !last && styles.fieldRowBorder]}>
      <View style={styles.fieldIcon}>
        <Ionicons name={icon} size={14} color="#6F42C1" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor="#bbb"
          keyboardType={keyboardType || 'default'}
          secureTextEntry={!!secure}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8f5ff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#f8f5ff' },
  kav: { flex: 1 },

  hero: { alignItems: 'center', paddingTop: 22, paddingBottom: 18, backgroundColor: '#6F42C1', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  avatarWrap: { width: 130, height: 130, marginBottom: 10 },
  avatar: { width: 130, height: 130, borderRadius: 65, backgroundColor: '#fff', borderWidth: 4, borderColor: '#fff' },
  cameraBadge: { position: 'absolute', right: 4, bottom: 4, width: 32, height: 32, borderRadius: 16, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  heroName: { fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 4 },
  heroSkill: { fontSize: 13, color: '#e9d5ff', marginTop: 2 },
  heroBadges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#333' },

  section: { paddingHorizontal: 14, paddingTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#6F42C1', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

  fieldGroup: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 10, borderWidth: 1, borderColor: '#eee' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  fieldRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3eefb' },
  fieldIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f0e6ff', alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: '#888', marginBottom: 1 },
  fieldInput: { fontSize: 13, color: '#222', paddingVertical: 2 },

  bioWrap: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#eee', gap: 8, alignItems: 'flex-start' },
  bioInput: { flex: 1, fontSize: 13, color: '#222', minHeight: 60, textAlignVertical: 'top' },

  verifyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#eee', gap: 10 },
  verifyIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  verifyTitle: { fontSize: 13, fontWeight: '800', color: '#333' },
  verifySub: { fontSize: 11, color: '#666', marginTop: 2 },

  saveBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  cancelBtn: { backgroundColor: '#f0f0f0', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  cancelBtnText: { color: '#666', fontWeight: '700' },
  row: { flexDirection: 'row' },

  pwdOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee', gap: 10 },
  pwdIcon: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  pwdTitle: { fontSize: 13, fontWeight: '800', color: '#333' },
  pwdSub: { fontSize: 11, color: '#666', marginTop: 1 },
  pwdForm: { backgroundColor: '#fff', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#eee' },

  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#999' },
  tabTextActive: { color: '#6F42C1' },

  hoursDesc: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 14 },
  hoursManageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f0fb',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e6dbf5',
    gap: 8,
  },
  hoursManageText: { flex: 1, fontSize: 14, fontWeight: '800', color: '#6F42C1' },

  // --- availability editor (Active hours tab) ---
  availCount: { fontSize: 12, color: '#6F42C1', fontWeight: '700', marginBottom: 10 },
  dayCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  dayCardOff: { backgroundColor: '#fafafa', borderColor: '#f0f0f0' },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayName: { fontSize: 14, fontWeight: '700', color: '#333' },
  dayNameOff: { color: '#999' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f5f0fb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  timeChipText: { fontSize: 13, fontWeight: '600', color: '#6F42C1' },
  timeSep: { fontSize: 12, color: '#999', fontWeight: '600' },
  webTimeWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f5f0fb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  offText: { fontSize: 12, color: '#bbb', marginTop: 6, fontStyle: 'italic' },

  // --- reviews received from clients ---
  reviewsEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#eee' },
  reviewsEmptyText: { fontSize: 12, color: '#999', fontStyle: 'italic', flex: 1 },
  reviewsSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb', borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#fde68a' },
  reviewsSummaryText: { fontSize: 12, fontWeight: '800', color: '#92400e' },
  reviewCard: { backgroundColor: '#fff', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewName: { fontSize: 13, fontWeight: '800', color: '#333' },
  reviewRating: { fontSize: 12, fontWeight: '800', color: '#FFB800' },
  reviewDate: { fontSize: 11, color: '#999', marginTop: 2 },
  reviewText: { fontSize: 12, color: '#444', lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  reviewImageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  reviewThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#eee' },
  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '92%', height: '75%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 16 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 },
});
