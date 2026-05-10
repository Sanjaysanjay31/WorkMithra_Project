import WorkerBottomNav from '@/components/worker-bottom-nav';
import { storage } from '@/lib/storage';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const WORKER_PROFILE_KEY = 'workmithra:worker_profile';
const WORKER_PASTWORK_KEY = 'workmithra:worker_pastwork';

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
};

type PastWorkItem = {
  id: string;
  place: string;
  description: string;
  rating: number;
  review: string;
};

const SAMPLE_PASTWORK: PastWorkItem[] = [
  { id: '1', place: 'Banjara Hills, Hyderabad', description: 'Bathroom plumbing repair', rating: 4.8, review: 'Very professional and on time.' },
  { id: '2', place: 'Gachibowli, Hyderabad', description: 'Kitchen sink installation', rating: 4.5, review: 'Good work, fair pricing.' },
  { id: '3', place: 'Madhapur, Hyderabad', description: 'Water tank cleaning', rating: 5.0, review: 'Excellent service, highly recommend!' },
];

export default function WorkerDashboard() {
  const [tab, setTab] = useState<Tab>('details');
  const [profile, setProfile] = useState<WorkerProfile>({});
  const [pastWork, setPastWork] = useState<PastWorkItem[]>([]);

  useEffect(() => {
    (async () => {
      const p = await storage.get(WORKER_PROFILE_KEY);
      if (p) try { setProfile(JSON.parse(p)); } catch {}
      const pw = await storage.get(WORKER_PASTWORK_KEY);
      if (pw) {
        try { setPastWork(JSON.parse(pw)); } catch { setPastWork(SAMPLE_PASTWORK); }
      } else {
        setPastWork(SAMPLE_PASTWORK);
      }
    })();
  }, []);

  const Detail = ({ label, value }: { label: string; value?: string }) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>My Dashboard</Text>

        <View style={styles.imageWrap}>
          <Image
            source={{ uri: profile.profile_image || 'https://placehold.co/120x120' }}
            style={styles.workerImage}
          />
          <Text style={styles.workerName}>{profile.full_name || 'Worker'}</Text>
          {profile.skill ? <Text style={styles.workerSkill}>{profile.skill}</Text> : null}
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'details' && styles.tabBtnActive]}
            onPress={() => setTab('details')}
          >
            <Text style={[styles.tabText, tab === 'details' && styles.tabTextActive]}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'past' && styles.tabBtnActive]}
            onPress={() => setTab('past')}
          >
            <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>Past Work</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {tab === 'details' ? (
            <View style={styles.section}>
              <Detail label="Name" value={profile.full_name} />
              <Detail label="Age" value={profile.age} />
              <Detail label="Domain" value={profile.skill} />
              <Detail label="Wage" value={profile.hourly_rate ? `₹${profile.hourly_rate}/hr` : ''} />
              <Detail label="Experience" value={profile.experience_years ? `${profile.experience_years} years` : ''} />
              <Detail label="Phone Number" value={profile.phone} />
              <Detail label="Alternative Number" value={profile.alternate_phone} />
            </View>
          ) : (
            <View style={styles.section}>
              {pastWork.length === 0 ? (
                <Text style={styles.empty}>No past work yet</Text>
              ) : (
                pastWork.map((w) => (
                  <View key={w.id} style={styles.pastCard}>
                    <Text style={styles.pastPlace}>{w.place}</Text>
                    <Text style={styles.pastDesc}>{w.description}</Text>
                    <View style={styles.ratingRow}>
                      <Text style={styles.ratingText}>⭐ {w.rating.toFixed(1)}</Text>
                    </View>
                    <Text style={styles.reviewText}>"{w.review}"</Text>
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </View>
      <WorkerBottomNav currentRoute="dashboard" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 12, textAlign: 'center' },
  imageWrap: { alignItems: 'center', marginBottom: 16 },
  workerImage: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#e9ecef' },
  workerName: { fontSize: 16, fontWeight: '800', color: '#333', marginTop: 8 },
  workerSkill: { fontSize: 12, color: '#666', marginTop: 2 },
  btnRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 14 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },
  section: {},
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  detailLabel: { fontSize: 13, fontWeight: '700', color: '#666', flex: 1 },
  detailValue: { fontSize: 13, color: '#333', flex: 1.4, textAlign: 'right' },
  pastCard: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 12, marginBottom: 10 },
  pastPlace: { fontSize: 13, fontWeight: '800', color: '#333' },
  pastDesc: { fontSize: 12, color: '#666', marginTop: 4 },
  ratingRow: { marginTop: 6 },
  ratingText: { fontSize: 12, color: '#FFB800', fontWeight: '700' },
  reviewText: { fontSize: 12, color: '#555', fontStyle: 'italic', marginTop: 6 },
  empty: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 20 },
});
