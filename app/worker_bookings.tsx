import WorkerBottomNav from '@/components/worker-bottom-nav';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Tab = 'pending' | 'accepted';

type Request = { id: string; client: string; job: string; date: string; status: 'pending' | 'accepted' };

const SAMPLE: Request[] = [
  { id: '1', client: 'Ravi Kumar', job: 'Pipe leak repair', date: 'Today, 4:00 PM', status: 'pending' },
  { id: '2', client: 'Priya Sharma', job: 'Tap installation', date: 'Tomorrow, 10:00 AM', status: 'pending' },
  { id: '3', client: 'Anil Reddy', job: 'Bathroom drainage', date: 'Yesterday', status: 'accepted' },
];

export default function WorkerBookings() {
  const [tab, setTab] = useState<Tab>('pending');
  const [requests, setRequests] = useState<Request[]>(SAMPLE);

  const filtered = requests.filter((r) => r.status === tab);

  function updateStatus(id: string, status: 'accepted' | 'pending') {
    setRequests((r) => r.map((x) => (x.id === id ? { ...x, status } : x)));
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
              <View key={r.id} style={styles.card}>
                <Text style={styles.client}>{r.client}</Text>
                <Text style={styles.job}>{r.job}</Text>
                <Text style={styles.date}>{r.date}</Text>
                {r.status === 'pending' ? (
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={() => updateStatus(r.id, 'accepted')}>
                      <Text style={styles.acceptText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.declineBtn]}>
                      <Text style={styles.declineText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.acceptedTag}>✓ Accepted</Text>
                )}
              </View>
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
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 12, textAlign: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 14 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },
  card: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 12, marginBottom: 10 },
  client: { fontSize: 14, fontWeight: '800', color: '#333' },
  job: { fontSize: 13, color: '#666', marginTop: 4 },
  date: { fontSize: 11, color: '#999', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  acceptBtn: { backgroundColor: '#10b981' },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  declineBtn: { backgroundColor: '#f0f0f0' },
  declineText: { color: '#666', fontWeight: '700', fontSize: 12 },
  acceptedTag: { marginTop: 8, color: '#10b981', fontWeight: '700', fontSize: 12 },
  empty: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 24 },
});
