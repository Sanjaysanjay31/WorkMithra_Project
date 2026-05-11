import WorkerBottomNav from '@/components/worker-bottom-nav';
import { addNotification } from '@/lib/notifications';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Tab = 'pending' | 'accepted';

type Request = {
  id: string;
  client_id: string;
  client: string;
  avatar: string;
  job: string;
  date: string;
  price: number;
  status: 'pending' | 'accepted';
};

const SAMPLE: Request[] = [
  { id: '1', client_id: '1', client: 'Ravi Kumar', avatar: 'https://i.pravatar.cc/200?img=12', job: 'Pipe leak repair', date: 'Today, 4:00 PM', price: 600, status: 'pending' },
  { id: '2', client_id: '2', client: 'Priya Sharma', avatar: 'https://i.pravatar.cc/200?img=47', job: 'Tap installation', date: 'Tomorrow, 10:00 AM', price: 400, status: 'pending' },
  { id: '3', client_id: '3', client: 'Anil Reddy', avatar: 'https://i.pravatar.cc/200?img=33', job: 'Bathroom drainage', date: 'Yesterday', price: 1500, status: 'accepted' },
];

export default function WorkerBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pending');
  const [requests, setRequests] = useState<Request[]>(SAMPLE);

  const filtered = requests.filter((r) => r.status === tab);

  function updateStatus(id: string, status: 'accepted' | 'pending') {
    const r = requests.find((x) => x.id === id);
    setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, status } : x)));
    if (!r) return;
    // Notify the user about acceptance / decline.
    const accepted = status === 'accepted';
    addNotification({
      audience: 'user',
      recipient_id: '1', // demo user (Sanjay)
      kind: accepted ? 'booking_accepted' : 'booking_declined',
      title: accepted ? 'Booking accepted ✓' : 'Booking declined',
      body: accepted
        ? `Your request for ${r.job} on ${r.date} was accepted by the worker. ₹${r.price}.`
        : `Your request for ${r.job} on ${r.date} was declined. Try another worker.`,
      data: { request_id: id, client_id: r.client_id },
    }).catch(() => {});
  }

  function openClient(r: Request) {
    router.push({ pathname: '/user_profile', params: { clientId: r.client_id, clientName: r.client } });
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>Booking Requests</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'pending' && styles.tabBtnActive]} onPress={() => setTab('pending')}>
            <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>Pending</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'accepted' && styles.tabBtnActive]} onPress={() => setTab('accepted')}>
            <Text style={[styles.tabText, tab === 'accepted' && styles.tabTextActive]}>Accepted</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <Text style={styles.empty}>No {tab} requests</Text>
          ) : (
            filtered.map((r) => (
              <TouchableOpacity key={r.id} style={styles.card} activeOpacity={0.85} onPress={() => openClient(r)}>
                <View style={styles.leftCol}>
                  <Image source={{ uri: r.avatar }} style={styles.avatar} />
                </View>
                <View style={styles.rightCol}>
                  <View style={styles.headerRow}>
                    <Text style={styles.client} numberOfLines={1}>{r.client}</Text>
                    <Ionicons name="chevron-forward" size={16} color="#999" />
                  </View>
                  <Text style={styles.job} numberOfLines={1}>{r.job}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.dateRow}>
                      <Ionicons name="calendar-outline" size={11} color="#888" />
                      <Text style={styles.date}>{r.date}</Text>
                    </View>
                    <Text style={styles.price}>₹{r.price}</Text>
                  </View>

                  {r.status === 'pending' ? (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.acceptBtn]}
                        onPress={(e) => { e.stopPropagation?.(); updateStatus(r.id, 'accepted'); }}
                      >
                        <Ionicons name="checkmark" size={13} color="#fff" />
                        <Text style={styles.acceptText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.declineBtn]}
                        onPress={(e) => { e.stopPropagation?.(); updateStatus(r.id, 'pending'); }}
                      >
                        <Ionicons name="close" size={13} color="#666" />
                        <Text style={styles.declineText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.acceptedRow}>
                      <Ionicons name="checkmark-circle" size={13} color="#10b981" />
                      <Text style={styles.acceptedTag}>Accepted</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
      <WorkerBottomNav currentRoute="requests" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 14 },
  title: { fontSize: 19, fontWeight: '800', color: '#333', marginBottom: 12, textAlign: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 14 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },

  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#eee', ...platformShadow('0px 1px 4px rgba(0,0,0,0.06)', '#000', 0, 1, 0.06, 2, 1) },
  leftCol: { width: 64, alignItems: 'center', justifyContent: 'flex-start' },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#e9ecef' },
  rightCol: { flex: 1, paddingLeft: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  client: { fontSize: 14, fontWeight: '800', color: '#222', flex: 1 },
  job: { fontSize: 12, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  date: { fontSize: 11, color: '#888' },
  price: { fontSize: 13, fontWeight: '800', color: '#10b981' },

  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 8, gap: 4 },
  acceptBtn: { backgroundColor: '#10b981' },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  declineBtn: { backgroundColor: '#f0f0f0' },
  declineText: { color: '#666', fontWeight: '700', fontSize: 11 },
  acceptedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  acceptedTag: { color: '#10b981', fontWeight: '800', fontSize: 12 },
  empty: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 24 },
});
