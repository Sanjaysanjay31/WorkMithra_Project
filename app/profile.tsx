import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, getAuth, readApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { pickImageWithPreview } from '@/lib/image-picker';
import { unregisterPush } from '@/lib/push';
import { uploadMultipart } from '@/lib/upload';
import { disconnectSocket } from '@/lib/socket';
import { clearAllWorkMitraStorage, storage } from '@/lib/storage';
import { ReviewResponse } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const PROFILE_KEY = 'workmithra:profile';

type ProfileForm = {
  full_name: string;
  email: string;
  phone: string;
  alternate_phone: string;
  location: string;
  pincode: string;
  profile_image?: string;
};

/** Review a worker wrote about this client (shown on the profile). */
type ReceivedReview = {
  id: string | number;
  name: string;
  rating: number;
  date: string;
  text: string;
  images?: string[];
};

const EMPTY: ProfileForm = {
  full_name: '', email: '', phone: '', alternate_phone: '', location: '', pincode: '', profile_image: '',
};

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Password change form state
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');

  // Reviews this client RECEIVED from workers — the mirror of the review
  // list a worker sees on their dashboard.
  const [reviews, setReviews] = useState<ReceivedReview[]>([]);
  // Full-screen viewer for review photos.
  const [viewImage, setViewImage] = useState<string | null>(null);
  // Details vs Reviews tabs — keeps a long review history from turning the
  // profile into one endless scroll.
  const [tab, setTab] = useState<'details' | 'reviews' | 'settings'>('details');

  useEffect(() => { load(); }, []);

  async function loadReviews(uid: string) {
    if (!uid) return;
    try {
      const res = await authFetch(`/reviews/?user_id=${uid}`);
      if (!res.ok) return;
      const data: ReviewResponse[] = await res.json();
      setReviews(
        data.map((r) => ({
          id: r.id,
          // user_name carries the REVIEWER's display name — the worker.
          name: r.user_name || 'Worker',
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
    let uid = '';
    try {
      const auth = await getAuth();
      if (auth?.id) { uid = String(auth.id); setCurrentUserId(uid); }
    } catch {}

    // Local cache is only used as a quick paint while backend fetch is in flight,
    // and ONLY if it belongs to the same uid (prevents leaking across accounts).
    try {
      const raw = await storage.get(PROFILE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (!cached.__uid || String(cached.__uid) === uid) {
          setProfile({ ...EMPTY, ...cached });
        } else {
          await storage.remove(PROFILE_KEY);
          setProfile(EMPTY);
        }
      }
    } catch {}

    if (!uid) return;
    // Reviews from workers load alongside the profile (independent request —
    // a failure there must not block the profile form).
    void loadReviews(uid);
    try {
      const res = await authFetch(`/profiles/user/${uid}`);
      if (!res.ok) return;
      const u = await res.json();
      const fresh: ProfileForm = {
        full_name: u.full_name || '',
        email: u.email || '',
        phone: u.phone || '',
        alternate_phone: u.alternate_phone || u.alt_phone || '',
        location: u.location || u.city || u.address || '',
        pincode: u.pincode || '',
        profile_image: u.profile_image || '',
      };
      setProfile(fresh);
      await storage.set(PROFILE_KEY, JSON.stringify({ ...fresh, __uid: uid }));
    } catch (e) {
      console.warn('Failed to load user profile from backend', e);
    }
  }

  function update<K extends keyof ProfileForm>(k: K, v: string) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (!currentUserId) {
      Alert.alert('Not logged in', 'Please log in again to save your profile.');
      return;
    }
    if (!profile.full_name.trim() || !profile.phone.trim()) {
      Alert.alert('Missing info', 'Name and phone are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/profiles/user/${currentUserId}`, {
        method: 'PUT',
        json: profile,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Save failed (${res.status})`);
      }
      // Only cache locally after the server confirms the write.
      await storage.set(PROFILE_KEY, JSON.stringify({ ...profile, __uid: currentUserId }));
      Alert.alert('Saved', 'Your profile has been saved.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function pickAndUploadImage() {
    if (!currentUserId) {
      Alert.alert('Not logged in', 'Please log in again to upload a photo.');
      return;
    }
    setUploading(true);
    try {
      // Uploads go through uploadMultipart (XHR): global fetch rejects
      // { uri, name, type } parts on native with "Unsupported FormDataPart".
      const picked = await pickImageWithPreview();
      if (!picked) { setUploading(false); return; }
      const part = picked.part;
      const data = await uploadMultipart<{ url: string }>('/upload-profile-image', part, {
        fields: { user_id: currentUserId, role: 'user' },
      });
      const next = { ...profile, profile_image: data.url };
      setProfile(next);
      await storage.set(PROFILE_KEY, JSON.stringify({ ...next, __uid: currentUserId }));
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload image');
    } finally {
      setUploading(false);
    }
  }

  async function changePasswordWithCurrent() {
    if (!profile.email.trim()) return Alert.alert('Email needed', 'Please enter your email in the form first.');
    if (!currentPwd || !newPwd) return Alert.alert('Missing fields', 'Enter current and new password.');
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
      // Never write the new password to storage. If a cached session for this
      // account carries a stale password field, strip it out.
      try {
        const auth = await getAuth();
        if (auth && 'password' in auth) {
          delete (auth as Record<string, unknown>).password;
          await storage.set('workmithra:auth', JSON.stringify(auth));
        }
      } catch {}
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
          {/* Avatar header */}
          <View style={styles.headerBg}>
            <View style={styles.avatarWrap}>
              <Avatar uri={profile.profile_image} name={profile.full_name} size={130} style={styles.avatar} />
              <TouchableOpacity style={styles.cameraBadge} onPress={pickAndUploadImage} activeOpacity={0.85}>
                {uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="camera" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.headerName}>{profile.full_name || 'Your Name'}</Text>
            <Text style={styles.headerSub}>{profile.email || profile.phone || 'Add your details below'}</Text>
          </View>

          {/* Details / Reviews switch — keeps a long review history from
              turning the profile into one endless scroll. */}
          <View style={styles.tabRow}>
            <TouchableOpacity style={[styles.tab, tab === 'details' && styles.tabActive]} onPress={() => setTab('details')}>
              <Text style={[styles.tabText, tab === 'details' && styles.tabTextActive]}>My Details</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'reviews' && styles.tabActive]} onPress={() => setTab('reviews')}>
              <Text style={[styles.tabText, tab === 'reviews' && styles.tabTextActive]}>
                My Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'settings' && styles.tabActive]} onPress={() => setTab('settings')}>
              <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>Settings</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {tab === 'details' && (
              <>
          {/* Editable form */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Details</Text>

            <Field label="Full Name" icon="person-outline" value={profile.full_name} onChange={(v) => update('full_name', v)} placeholder="John Doe" />
            <Field label="Email" icon="mail-outline" value={profile.email} onChange={(v) => update('email', v)} placeholder="you@example.com" keyboardType="email-address" />
            <Field label="Phone Number" icon="call-outline" value={profile.phone} onChange={(v) => update('phone', v)} placeholder="+91 XXXXXXXXXX" keyboardType="phone-pad" />
            <Field label="Alternative Phone" icon="call-outline" value={profile.alternate_phone} onChange={(v) => update('alternate_phone', v)} placeholder="Optional" keyboardType="phone-pad" />
            <Field label="Location" icon="location-outline" value={profile.location} onChange={(v) => update('location', v)} placeholder="City, Area" />
            <Field label="Pincode" icon="pin-outline" value={profile.pincode} onChange={(v) => update('pincode', v)} placeholder="6-digit pincode" keyboardType="numeric" />

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="save" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}> Save Changes</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
              </>
            )}

            {tab === 'reviews' && (
              // Reviews received from workers — the client's side of the review
              // system (workers see the mirror list on their dashboard).
              <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              My Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
            </Text>
            {reviews.length === 0 ? (
              <View style={styles.reviewsEmpty}>
                <Ionicons name="star-outline" size={18} color="#999" />
                <Text style={styles.reviewsEmptyText}>
                  No reviews yet — workers can review you after a completed job.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.reviewsSummary}>
                  <Ionicons name="star" size={16} color="#FFB800" />
                  <Text style={styles.reviewsSummaryText}>
                    {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)} average from {reviews.length} {reviews.length === 1 ? 'worker' : 'workers'}
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

            {tab === 'settings' && (
              <>
          {/* Switch Role + Logout */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Settings</Text>
            <TouchableOpacity
              style={styles.pwdOption}
              onPress={async () => {
                const doSwitch = async () => {
                  disconnectSocket();
                  await unregisterPush();
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
                <Text style={styles.pwdSub}>Log out and switch between User and Worker</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.pwdOption}
              onPress={async () => {
                const doLogout = async () => {
                  disconnectSocket();
                  await unregisterPush();
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
            <Text style={styles.sectionTitle}>Change Password</Text>

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
                <Field label="Confirm New Password" icon="shield-checkmark-outline" value={confirmPwd} onChange={setConfirmPwd} placeholder="Re-enter new password" secure={!showPwd} />

                <TouchableOpacity onPress={() => setShowPwd((v) => !v)} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
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
      </View>
      <BottomNav currentRoute="profile" />
    </View>
  );
}

function Field({
  label, icon, value, onChange, placeholder, keyboardType, secure,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  secure?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name={icon} size={16} color="#6c757d" />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor="#999"
          keyboardType={keyboardType || 'default'}
          secureTextEntry={!!secure}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#fff' },
  kav: { flex: 1 },

  headerBg: { backgroundColor: '#6F42C1', paddingTop: 24, paddingBottom: 20, alignItems: 'center', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  avatarWrap: { width: 144, height: 144, marginBottom: 12 },
  avatar: { width: 144, height: 144, borderRadius: 72, backgroundColor: '#fff', borderWidth: 4, borderColor: '#fff' },
  cameraBadge: { position: 'absolute', right: 2, bottom: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  headerName: { fontSize: 16, fontWeight: '800', color: '#fff', marginTop: 4 },
  headerSub: { fontSize: 12, color: '#e9d5ff', marginTop: 2 },

  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#999' },
  tabTextActive: { color: '#6F42C1' },

  section: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#333', marginBottom: 10 },

  field: { marginBottom: 10 },
  label: { fontSize: 11, fontWeight: '700', color: '#666', marginBottom: 4 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 10, gap: 8 },
  input: { flex: 1, paddingVertical: 10, fontSize: 13, color: '#333' },

  saveBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  cancelBtn: { backgroundColor: '#f0f0f0', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  cancelBtnText: { color: '#666', fontWeight: '700' },
  row: { flexDirection: 'row' },

  pwdOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fafafa', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee', gap: 10 },
  pwdIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  pwdTitle: { fontSize: 13, fontWeight: '800', color: '#333' },
  pwdSub: { fontSize: 11, color: '#666', marginTop: 1 },
  pwdForm: { backgroundColor: '#fafafa', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#eee' },

  // --- reviews received from workers ---
  reviewsEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fafafa', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eee' },
  reviewsEmptyText: { fontSize: 12, color: '#999', fontStyle: 'italic', flex: 1 },
  reviewsSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb', borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#fde68a' },
  reviewsSummaryText: { fontSize: 12, fontWeight: '800', color: '#92400e' },
  reviewCard: { backgroundColor: '#fafafa', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
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
