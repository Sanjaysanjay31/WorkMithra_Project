import WorkerBottomNav from '@/components/worker-bottom-nav';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import Avatar from '@/components/avatar';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;
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

export default function WorkerProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<WorkerForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [showPwdForm, setShowPwdForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [currentWorkerId, setCurrentWorkerId] = useState('1');

  useEffect(() => { load(); }, []);

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
    try {
      const res = await fetch(`${BASE_URL}/workers/${wid}`);
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
      await storage.set(WORKER_KEY, JSON.stringify(fromServer));
    } catch (e) {
      console.warn('Failed to load worker from backend', e);
    }
  }

  function update<K extends keyof WorkerForm>(k: K, v: any) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (!profile.full_name.trim() || !profile.phone.trim()) {
      Alert.alert('Missing info', 'Name and phone are required.');
      return;
    }
    setSaving(true);
    try {
      await storage.set(WORKER_KEY, JSON.stringify({ ...profile, __uid: currentWorkerId }));
      await fetch(`${BASE_URL}/workers/${currentWorkerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
    } catch {}
    setSaving(false);
    Alert.alert('Saved', 'Your worker profile has been saved.');
  }

  async function pickAndUploadImage() {
    if (Platform.OS !== 'web') {
      Alert.alert('Upload', 'Image upload works in the browser. Add expo-image-picker for native.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('user_id', currentWorkerId);
        fd.append('role', 'worker');
        const res = await fetch(`${BASE_URL}/upload-profile-image`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Upload failed');
        const next = { ...profile, profile_image: data.url };
        setProfile(next);
        await storage.set(WORKER_KEY, JSON.stringify({ ...next, __uid: currentWorkerId }));
      } catch (e: any) {
        Alert.alert('Upload failed', e?.message || 'Could not upload image');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  async function changePasswordWithCurrent() {
    if (!profile.email.trim()) return Alert.alert('Email needed', 'Please enter your email in the form first.');
    if (!currentPwd || !newPwd) return Alert.alert('Missing fields', 'Enter current and new password.');
    if (newPwd.length < 6) return Alert.alert('Weak password', 'Use at least 6 characters.');
    if (newPwd !== confirmPwd) return Alert.alert('Mismatch', 'New passwords do not match.');
    setPwdLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: profile.email, current_password: currentPwd, new_password: newPwd }),
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
        <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>

          {/* Hero header */}
          <View style={styles.hero}>
            <View style={styles.avatarWrap}>
              <Avatar uri={profile.profile_image} name={profile.full_name} size={130} style={styles.avatar as any} />
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

          {/* Verification toggle */}
          <View style={styles.section}>
            <SectionTitle>Verification</SectionTitle>
            <TouchableOpacity
              style={styles.verifyRow}
              onPress={() => update('aadhaar_verified', !profile.aadhaar_verified)}
              activeOpacity={0.8}
            >
              <View style={[styles.verifyIcon, { backgroundColor: profile.aadhaar_verified ? '#dcfce7' : '#f0f0f0' }]}>
                <Ionicons
                  name={profile.aadhaar_verified ? 'shield-checkmark' : 'shield-outline'}
                  size={18}
                  color={profile.aadhaar_verified ? '#10b981' : '#999'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.verifyTitle}>Aadhaar Verification</Text>
                <Text style={styles.verifySub}>{profile.aadhaar_verified ? 'You are verified' : 'Tap to mark as verified (demo)'}</Text>
              </View>
              <View style={[styles.toggle, profile.aadhaar_verified && styles.toggleOn]}>
                <View style={[styles.toggleDot, profile.aadhaar_verified && styles.toggleDotOn]} />
              </View>
            </TouchableOpacity>
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

          {/* Switch Role + Logout */}
          <View style={styles.section}>
            <SectionTitle>Account Settings</SectionTitle>
            <TouchableOpacity
              style={styles.pwdOption}
              onPress={async () => {
                await storage.remove('workmithra:auth');
                await storage.remove('workmithra:worker_profile').catch(() => {});
                await storage.remove('workmithra:user_profile').catch(() => {});
                router.replace('/login');
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
                  await storage.remove('workmithra:auth');
                  await storage.remove('workmithra:worker_profile').catch(() => {});
                  await storage.remove('workmithra:user_profile').catch(() => {});
                  router.replace('/login');
                };
                if (Platform.OS === 'web') {
                  if (typeof window !== 'undefined' && window.confirm('Are you sure you want to log out?')) {
                    await doLogout();
                  }
                } else {
                  Alert.alert('Logout', 'Are you sure you want to log out?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Logout', style: 'destructive', onPress: doLogout },
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
        </ScrollView>
      </View>
      <WorkerBottomNav currentRoute="profile" />
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
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#f8f5ff' },

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
  toggle: { width: 36, height: 20, borderRadius: 10, backgroundColor: '#e0e0e0', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#10b981' },
  toggleDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', transform: [{ translateX: 0 }] },
  toggleDotOn: { transform: [{ translateX: 16 }] },

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
});
