import WorkerBottomNav from '@/components/worker-bottom-nav';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const WORKER_PROFILE_KEY = 'workmithra:worker_profile';

type WorkerForm = {
  full_name: string;
  age: string;
  skill: string;
  hourly_rate: string;
  experience_years: string;
  phone: string;
  alternate_phone: string;
  location: string;
  pincode: string;
};

const EMPTY: WorkerForm = {
  full_name: '',
  age: '',
  skill: '',
  hourly_rate: '',
  experience_years: '',
  phone: '',
  alternate_phone: '',
  location: '',
  pincode: '',
};

export default function WorkerProfilePage() {
  const [profile, setProfile] = useState<WorkerForm>(EMPTY);
  const [exists, setExists] = useState(false);
  const [editMode, setEditMode] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const cached = await storage.get(WORKER_PROFILE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setProfile({ ...EMPTY, ...parsed });
        setExists(true);
        setEditMode(false);
      } catch {}
    }
  }

  function update<K extends keyof WorkerForm>(key: K, value: string) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    if (!profile.full_name.trim() || !profile.phone.trim()) {
      Alert.alert('Missing info', 'Name and phone are required.');
      return;
    }
    setSaving(true);
    try {
      await storage.set(WORKER_PROFILE_KEY, JSON.stringify(profile));
      setExists(true);
      setEditMode(false);
      Alert.alert('Saved', 'Profile saved.');
    } finally {
      setSaving(false);
    }
  }

  const renderField = (
    label: string,
    key: keyof WorkerForm,
    placeholder?: string,
    keyboardType: 'default' | 'phone-pad' | 'numeric' = 'default',
  ) => (
    <View style={styles.field} key={key}>
      <Text style={styles.label}>{label}</Text>
      {editMode ? (
        <TextInput
          style={styles.input}
          value={profile[key]}
          onChangeText={(t) => update(key, t)}
          placeholder={placeholder}
          placeholderTextColor="#999"
          keyboardType={keyboardType}
        />
      ) : (
        <Text style={styles.readOnly}>{profile[key] || '—'}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <View style={styles.header}>
          <Text style={styles.title}>My Profile</Text>
          {exists && !editMode && (
            <TouchableOpacity style={styles.editBtn} onPress={() => setEditMode(true)}>
              <Ionicons name="create-outline" size={16} color="#fff" />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {!exists && <Text style={styles.subtitle}>Create your worker profile</Text>}

        <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
          {renderField('Name', 'full_name', 'Full name')}
          {renderField('Age', 'age', 'Age', 'numeric')}
          {renderField('Domain / Skill', 'skill', 'e.g. Plumber')}
          {renderField('Wage (₹/hr)', 'hourly_rate', 'e.g. 500', 'numeric')}
          {renderField('Experience (years)', 'experience_years', 'e.g. 5', 'numeric')}
          {renderField('Phone Number', 'phone', '+91 XXXXXXXXXX', 'phone-pad')}
          {renderField('Alternative Number', 'alternate_phone', 'Optional', 'phone-pad')}
          {renderField('Location', 'location', 'City, Area')}
          {renderField('Pincode', 'pincode', '6-digit pincode', 'numeric')}

          {editMode && (
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : exists ? 'Save Changes' : 'Create Profile'}</Text>
            </TouchableOpacity>
          )}
          {editMode && exists && (
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setEditMode(false); load(); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
      <WorkerBottomNav currentRoute="profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#333' },
  subtitle: { fontSize: 12, color: '#666', marginBottom: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#6F42C1', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, gap: 4 },
  editBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  form: { paddingBottom: 100 },
  field: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#333', marginBottom: 6 },
  input: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#333' },
  readOnly: { fontSize: 14, color: '#333', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  saveBtn: { backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  cancelBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 6 },
  cancelBtnText: { color: '#666', fontWeight: '600', fontSize: 13 },
});
