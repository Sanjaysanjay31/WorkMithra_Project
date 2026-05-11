import BottomNav from '@/components/bottom-nav';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Tab = 'present' | 'past';
type Status = 'upcoming' | 'success' | 'rejected';

type Booking = {
  id: string;
  worker_name: string;
  worker_image: string;
  role: string;
  rating: number;
  status: Status;
  amount: number;
  date: string;
};

// Sample data for user_id = 6 (Sanjay)
const PRESENT_BOOKINGS: Booking[] = [
  {
    id: 'p1',
    worker_name: 'Ravi Kumar',
    worker_image: 'https://i.pravatar.cc/100?img=12',
    role: 'Plumber',
    rating: 4.7,
    status: 'upcoming',
    amount: 600,
    date: '2026-05-14 · 10:00 AM',
  },
  {
    id: 'p2',
    worker_name: 'Anita Sharma',
    worker_image: 'https://i.pravatar.cc/100?img=47',
    role: 'Electrician',
    rating: 4.9,
    status: 'upcoming',
    amount: 800,
    date: '2026-05-16 · 3:30 PM',
  },
];

const PAST_BOOKINGS: Booking[] = [
  {
    id: 'h1',
    worker_name: 'Mohan Reddy',
    worker_image: 'https://i.pravatar.cc/100?img=33',
    role: 'Carpenter',
    rating: 4.8,
    status: 'success',
    amount: 1500,
    date: '2026-04-22 · 11:00 AM',
  },
  {
    id: 'h2',
    worker_name: 'Priya Singh',
    worker_image: 'https://i.pravatar.cc/100?img=25',
    role: 'Painter',
    rating: 4.6,
    status: 'success',
    amount: 2200,
    date: '2026-03-15 · 9:30 AM',
  },
  {
    id: 'h3',
    worker_name: 'Karthik Iyer',
    worker_image: 'https://i.pravatar.cc/100?img=8',
    role: 'AC Repair',
    rating: 4.2,
    status: 'rejected',
    amount: 0,
    date: '2026-02-28 · 4:00 PM',
  },
];

function statusColor(s: Status) {
  if (s === 'success') return { bg: '#dcfce7', fg: '#166534', label: '✓ Success' };
  if (s === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  return { bg: '#dbeafe', fg: '#1e40af', label: '⏳ Upcoming' };
}

export default function BookingsPage() {
  const [tab, setTab] = useState<Tab>('present');
  const data = tab === 'present' ? PRESENT_BOOKINGS : PAST_BOOKINGS;

  const renderCard = (b: Booking) => {
    const sc = statusColor(b.status);
    return (
      <View key={b.id} style={styles.card}>
        <View style={styles.leftCol}>
          <Image source={{ uri: b.worker_image }} style={styles.avatar} />
        </View>
        <View style={styles.rightCol}>
          <Text style={styles.name} numberOfLines={1}>{b.worker_name}</Text>
          <Text style={styles.role}>{b.role}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.rating}>⭐ {b.rating.toFixed(1)}</Text>
            <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusText, { color: sc.fg }]}>{sc.label}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.date}>{b.date}</Text>
            <Text style={styles.amount}>
              {b.status === 'rejected' ? '—' : `₹${b.amount}`}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Bookings', headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>My Bookings</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'present' && styles.tabBtnActive]}
            onPress={() => setTab('present')}
          >
            <Text style={[styles.tabText, tab === 'present' && styles.tabTextActive]}>
              Present Bookings
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'past' && styles.tabBtnActive]}
            onPress={() => setTab('past')}
          >
            <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>
              Past Bookings
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {data.length === 0 ? (
            <Text style={styles.placeholder}>No bookings here yet</Text>
          ) : (
            data.map(renderCard)
          )}
        </ScrollView>
      </View>
      <BottomNav currentRoute="bookings" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 16, textAlign: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },
  placeholder: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 30 },

  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  leftCol: { width: '30%', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#e9ecef' },
  rightCol: { flex: 1, paddingLeft: 10, justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '800', color: '#222' },
  role: { fontSize: 12, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  rating: { fontSize: 12, color: '#FFB800', fontWeight: '700' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 10, fontWeight: '800' },
  date: { fontSize: 11, color: '#888' },
  amount: { fontSize: 13, fontWeight: '800', color: '#10b981' },
});
