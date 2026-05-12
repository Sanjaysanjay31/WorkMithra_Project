import BottomNav from '@/components/bottom-nav';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
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

const EMPTY: ProfileForm = {
  full_name: '', email: '', phone: '', alternate_phone: '', location: '', pincode: '', profile_image: '',
};

export default function ProfilePage() {
  const router = useRouter();
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
  const [currentUserId, setCurrentUserId] = useState('1');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const raw = await storage.get(PROFILE_KEY);
      if (raw) setProfile({ ...EMPTY, ...JSON.parse(raw) });
      const authRaw = await storage.get('workmithra:auth');
      if (authRaw) {
        const auth = JSON.parse(authRaw);
        if (auth.id) setCurrentUserId(String(auth.id));
      }
    } catch {}
  }

  function update<K extends keyof ProfileForm>(k: K, v: string) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (!profile.full_name.trim() || !profile.phone.trim()) {
      Alert.alert('Missing info', 'Name and phone are required.');
      return;
    }
    setSaving(true);
    try { await storage.set(PROFILE_KEY, JSON.stringify(profile)); } catch {}
    try {
      await fetch(`${BASE_URL}/profiles/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUserId },
        body: JSON.stringify(profile),
      });
    } catch {}
    setSaving(false);
    Alert.alert('Saved', 'Your profile has been saved.');
  }

  async function pickAndUploadImage() {
    if (Platform.OS !== 'web') {
      Alert.alert('Upload', 'Image upload via file picker works in the browser. Add expo-image-picker for native.');
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
        fd.append('user_id', currentUserId);
        const res = await fetch(`${BASE_URL}/upload-profile-image`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Upload failed');
        const next = { ...profile, profile_image: data.url };
        setProfile(next);
        await storage.set(PROFILE_KEY, JSON.stringify(next));
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
      // update local auth cache
      try {
        const raw = await storage.get('workmithra:auth');
        const auth = raw ? JSON.parse(raw) : {};
        auth.password = newPwd;
        await storage.set('workmithra:auth', JSON.stringify(auth));
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
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>

          {/* Avatar header */}
          <View style={styles.headerBg}>
            <View style={styles.avatarWrap}>
              <Image
                source={{ uri: profile.profile_image || 'https://placehold.co/120x120/6F42C1/fff?text=Me' }}
                style={styles.avatar}
              />
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

          {/* Switch Role */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Settings</Text>
            <TouchableOpacity style={styles.pwdOption} onPress={() => { storage.delete('workmithra:auth'); router.replace('/login'); }}>
              <View style={[styles.pwdIcon, { backgroundColor: '#e0f2fe' }]}>
                <Ionicons name="swap-horizontal" size={18} color="#0284c7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pwdTitle}>Switch Role</Text>
                <Text style={styles.pwdSub}>Log out and switch between User and Worker</Text>
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
        </ScrollView>
      </View>
      <BottomNav currentRoute="profile" />
    </View>
  );
}

function Field({
  label, icon, value, onChange, placeholder, keyboardType, secure,
}: {
  label: string;
  icon: any;
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
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff' },

  headerBg: { backgroundColor: '#6F42C1', paddingTop: 24, paddingBottom: 20, alignItems: 'center', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  avatarWrap: { width: 144, height: 144, marginBottom: 12 },
  avatar: { width: 144, height: 144, borderRadius: 72, backgroundColor: '#fff', borderWidth: 4, borderColor: '#fff' },
  cameraBadge: { position: 'absolute', right: 2, bottom: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  headerName: { fontSize: 16, fontWeight: '800', color: '#fff', marginTop: 4 },
  headerSub: { fontSize: 12, color: '#e9d5ff', marginTop: 2 },

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
});
