import WorkerBottomNav from '@/components/worker-bottom-nav';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

type Tab = 'profile' | 'chat' | 'map' | 'requests';

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
  status: 'pending' | 'accepted' | 'declined' | 'completed';
};

function toRad(d: number) { return (d * Math.PI) / 180; }
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Demo client lookup — in a real app this comes from /users/{id}
function getSampleClient(id: string, name?: string): ClientProfile {
  const seed = id || '0';
  const variants: ClientProfile[] = [
    {
      id: '1', full_name: name || 'Ravi Kumar', age: 34, email: 'ravi.kumar@gmail.com',
      phone: '+91 98765 43210', alternate_phone: '+91 98765 43200',
      address: 'H.No. 8-3-228, Banjara Hills, Road No.12', city: 'Hyderabad',
      location: 'Banjara Hills', pincode: '500034', joined: '2025-12-04',
      avatar: 'https://i.pravatar.cc/200?img=12', latitude: 17.4156, longitude: 78.4347,
    },
    {
      id: '2', full_name: name || 'Priya Sharma', age: 29, email: 'priya.sharma@outlook.com',
      phone: '+91 98311 22336', alternate_phone: '—',
      address: 'Plot 24, Hi-Tech Layout, Gachibowli', city: 'Hyderabad',
      location: 'Gachibowli', pincode: '500032', joined: '2026-01-18',
      avatar: 'https://i.pravatar.cc/200?img=47', latitude: 17.4401, longitude: 78.3489,
    },
    {
      id: '3', full_name: name || 'Anil Reddy', age: 41, email: 'anil.reddy@yahoo.com',
      phone: '+91 90100 24578',
      address: '5-7-44, Madhapur Main Road', city: 'Hyderabad',
      location: 'Madhapur', pincode: '500081', joined: '2025-09-22',
      avatar: 'https://i.pravatar.cc/200?img=33', latitude: 17.4483, longitude: 78.3915,
    },
  ];
  const i = (parseInt(seed, 10) || 0) % variants.length;
  return variants[i];
}

const SAMPLE_REQUESTS = (clientId: string): RequestItem[] => [
  { id: `${clientId}-r1`, date: '2026-05-14', time: '10:00 AM', service: 'Pipe leak repair', note: 'Main bathroom — leak under sink', price: 600, status: 'pending' },
  { id: `${clientId}-r2`, date: '2026-04-22', time: '11:00 AM', service: 'Bathroom plumbing', price: 1500, status: 'completed' },
  { id: `${clientId}-r3`, date: '2026-03-08', time: '5:30 PM', service: 'Tap replacement', price: 400, status: 'completed' },
];

function statusColor(s: RequestItem['status']) {
  if (s === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (s === 'accepted') return { bg: '#dbeafe', fg: '#1e40af', label: '✓ Accepted' };
  if (s === 'declined') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Declined' };
  return { bg: '#fef3c7', fg: '#92400e', label: '⏳ Pending' };
}

export default function UserProfilePage() {
  const router = useRouter();
  const { clientId, clientName } = useLocalSearchParams<{ clientId?: string; clientName?: string }>();
  const [tab, setTab] = useState<Tab>('profile');
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [workerLoc, setWorkerLoc] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const c = getSampleClient(String(clientId || '1'), clientName ? String(clientName) : undefined);
    setClient(c);
    setRequests(SAMPLE_REQUESTS(String(clientId || '1')));
  }, [clientId, clientName]);

  useEffect(() => {
    if (tab === 'map') tryGetLocation();
  }, [tab]);

  function tryGetLocation() {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setWorkerLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setWorkerLoc({ lat: 17.385, lng: 78.4867 }),
      { enableHighAccuracy: false, timeout: 5000 },
    );
  }

  const distanceKm = useMemo(() => {
    if (!workerLoc || !client?.latitude || !client?.longitude) return null;
    return haversineKm(workerLoc.lat, workerLoc.lng, client.latitude, client.longitude);
  }, [workerLoc, client]);

  function updateRequest(id: string, status: RequestItem['status']) {
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  if (!client) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6F42C1" />
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
          <Image source={{ uri: client.avatar }} style={styles.heroAvatar} />
          <Text style={styles.heroName}>{client.full_name}</Text>
          <Text style={styles.heroSub}>{client.city || client.location || '—'}{client.joined ? ` · joined ${client.joined}` : ''}</Text>
          <View style={styles.heroBadges}>
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
          {(['profile', 'chat', 'map', 'requests'] as Tab[]).map((t) => (
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
                <Text style={styles.phoneText}>{client.phone || '+91 XXXX XXX XXX'}</Text>
              </View>
              <TouchableOpacity style={styles.callBtn} onPress={() => client.phone && Linking.openURL(`tel:${client.phone}`)}>
                <Ionicons name="call" size={18} color="#fff" />
                <Text style={styles.callBtnText}>  Call Client</Text>
              </TouchableOpacity>
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
                  <Text style={styles.mapValue}>{workerLoc ? `${workerLoc.lat.toFixed(3)}, ${workerLoc.lng.toFixed(3)}` : 'Locating…'}</Text>
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
                  <Text style={styles.distanceValue}>{distanceKm != null ? `${distanceKm.toFixed(1)} km` : '—'}</Text>
                </View>
              </View>

              {Platform.OS === 'web' && workerLoc && client.latitude && client.longitude && (
                <View style={styles.mapEmbedWrap}>
                  <iframe
                    style={{ width: '100%', height: 240, border: 0, borderRadius: 12 } as any}
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(workerLoc.lng, client.longitude) - 0.02},${Math.min(workerLoc.lat, client.latitude) - 0.02},${Math.max(workerLoc.lng, client.longitude) + 0.02},${Math.max(workerLoc.lat, client.latitude) + 0.02}&layer=mapnik&marker=${client.latitude},${client.longitude}`}
                  />
                </View>
              )}

              <TouchableOpacity
                style={styles.openMapsBtn}
                onPress={() => {
                  if (!client.latitude || !client.longitude) return Alert.alert('Map', 'Client location not available');
                  const origin = workerLoc ? `${workerLoc.lat},${workerLoc.lng}` : '';
                  const dest = `${client.latitude},${client.longitude}`;
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`);
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
        </ScrollView>
      </View>
      <WorkerBottomNav currentRoute="requests" />
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

function Detail({ icon, label, value }: { icon: any; label: string; value?: string }) {
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
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

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

  reqCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee', elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2 },
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
});
