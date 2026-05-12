import WorkerBottomNav from '@/components/worker-bottom-nav';
import { unreadCount } from '@/lib/notifications';
import { storage } from '@/lib/storage';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
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

import { SAMPLE_PASTWORK, PastWorkItem } from './mock_data';

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

  useEffect(() => {
    let alive = true;
    const tick = () => unreadCount('worker', '1').then((n) => { if (alive) setUnread(n); }).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

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

  const avgRating = pastWork.length
    ? (pastWork.reduce((s, w) => s + w.rating, 0) / pastWork.length).toFixed(1)
    : '0.0';
  const totalEarn = pastWork.reduce((s, w) => s + w.payment, 0);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>

        {/* Top hero */}
        <View style={styles.hero}>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push({ pathname: '/notifications', params: { as: 'worker', id: '1' } })}
            activeOpacity={0.85}
          >
            <Ionicons name="notifications-outline" size={18} color="#fff" />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <Image
            source={{ uri: profile.profile_image || 'https://placehold.co/120x120/6F42C1/fff?text=Me' }}
            style={styles.heroAvatar}
          />
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

        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
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
              {pastWork.length === 0 ? (
                <Text style={styles.empty}>No past work yet</Text>
              ) : (
                pastWork.map((w) => (
                  <View key={w.id} style={styles.pastCard}>
                    {/* Cover photo of the completed work */}
                    <Image source={{ uri: w.photo }} style={styles.workPhoto} />

                    {/* Description + place + date */}
                    <View style={styles.workBody}>
                      <View style={styles.workHeaderRow}>
                        <Text style={styles.workPlace} numberOfLines={1}>{w.place}</Text>
                        <Text style={styles.workDate}>{w.date}</Text>
                      </View>
                      <Text style={styles.workDesc}>{w.description}</Text>

                      {/* Client row + payment + rating */}
                      <View style={styles.clientRow}>
                        <Image source={{ uri: w.client_avatar }} style={styles.clientAvatar} />
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

                      {/* Review */}
                      <View style={styles.reviewBox}>
                        <Ionicons name="chatbox-ellipses" size={14} color="#6F42C1" />
                        <Text style={styles.reviewText}>"{w.review}"</Text>
                      </View>
                    </View>
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

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.detailGroup}>
      <Text style={styles.detailGroupTitle}>{title}</Text>
      <View style={styles.detailGroupBody}>{children}</View>
    </View>
  );
}

function Detail({ icon, label, value }: { icon: any; label: string; value?: string }) {
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
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff' },

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
  reviewBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#faf7ff', borderRadius: 8, padding: 8, marginTop: 8 },
  reviewText: { fontSize: 11, color: '#444', flex: 1, fontStyle: 'italic', lineHeight: 16 },
});
