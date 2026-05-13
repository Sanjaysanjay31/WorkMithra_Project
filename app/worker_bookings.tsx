import WorkerBottomNav from '@/components/worker-bottom-nav';
import Avatar from '@/components/avatar';
import { addNotification } from '@/lib/notifications';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState, useEffect } from 'react';
import { Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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

import { storage } from '@/lib/storage';
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export default function WorkerBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pending');
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoteFor, setQuoteFor] = useState<Request | null>(null);
  const [quoteAmount, setQuoteAmount] = useState('');

  useEffect(() => {
    (async () => {
      let uid = '1';
      try {
        const authRaw = await storage.get('workmithra:auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          if (auth.id) uid = String(auth.id);
        }
      } catch {}

      try {
        const res = await fetch(`${BASE_URL}/bookings?worker_id=${uid}`);
        if (res.ok) {
          const data = await res.json();

          // Fetch real client names for unique user_ids
          const uniqueUids = Array.from(new Set(data.map((b: any) => b.user_id).filter(Boolean)));
          const userMap: Record<string, { name: string; avatar?: string }> = {};
          await Promise.all(uniqueUids.map(async (uid: any) => {
            try {
              const r = await fetch(`${BASE_URL}/profiles/user/${uid}`);
              if (r.ok) {
                const u = await r.json();
                userMap[String(uid)] = {
                  name: u.full_name || `User ${uid}`,
                  avatar: u.profile_image,
                };
              }
            } catch {}
          }));

          const mapped: Request[] = data.map((b: any) => {
            const info = userMap[String(b.user_id)] || {};
            return {
              id: String(b.id),
              client_id: String(b.user_id),
              client: info.name || `User ${b.user_id}`,
              avatar: info.avatar || `https://i.pravatar.cc/150?u=${b.user_id}`,
              job: b.problem_description || 'General Service',
              date: b.booking_date ? `${b.booking_date} ${b.booking_time || ''}` : 'Unknown date',
              price: b.estimated_price || b.final_price || 0,
              status: b.status === 'accepted' || b.status === 'upcoming' || b.status === 'success' || b.status === 'completed' ? 'accepted' : 'pending',
            };
          });
          setRequests(mapped.filter(r => r.status === 'pending' || r.status === 'accepted'));
        }
      } catch (e) {
        console.warn('Failed to fetch requests', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = requests.filter((r) => r.status === tab);

  async function updateStatus(id: string, status: 'accepted' | 'pending') {
    const r = requests.find((x) => x.id === id);
    setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, status } : x)));
    if (!r) return;
    
    // Update on backend
    try {
      await fetch(`${BASE_URL}/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status === 'accepted' ? 'upcoming' : 'rejected' })
      });
    } catch {}

    // Notify the user about acceptance / decline.
    const accepted = status === 'accepted';
    addNotification({
      audience: 'user',
      recipient_id: r.client_id, 
      kind: accepted ? 'booking_accepted' : 'booking_declined',
      title: accepted ? 'Booking accepted ✓' : 'Booking declined',
      body: accepted
        ? `Your request for ${r.job} on ${r.date} was accepted by the worker. ₹${r.price}.`
        : `Your request for ${r.job} on ${r.date} was declined. Try another worker.`,
      data: { request_id: id, client_id: r.client_id },
    }).catch(() => {});
  }

  async function submitQuote() {
    if (!quoteFor) return;
    const amt = Number(quoteAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Quote', 'Please enter a valid amount in ₹');
      return;
    }
    const r = quoteFor;
    setRequests((rs) => rs.map((x) => (x.id === r.id ? { ...x, price: amt } : x)));
    try {
      await fetch(`${BASE_URL}/bookings/${r.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: Number(r.client_id), estimated_price: amt })
      });
    } catch {}

    addNotification({
      audience: 'user',
      recipient_id: r.client_id,
      kind: 'info',
      title: 'Worker shared a price quote',
      body: `${r.job} on ${r.date}: ₹${amt}. Open the booking to accept or discuss further.`,
      data: { request_id: r.id, client_id: r.client_id, price: amt },
    }).catch(() => {});

    setQuoteFor(null);
    setQuoteAmount('');
    Alert.alert('Quote sent', `₹${amt} sent to ${r.client}.`);
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
                  <Avatar uri={r.avatar} name={r.client} size={60} style={styles.avatar as any} />
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
                    <Text style={styles.price}>{r.price > 0 ? `₹${r.price}` : 'Quote pending'}</Text>
                  </View>

                  {r.status === 'pending' ? (
                    <>
                      <TouchableOpacity
                        style={styles.quoteBtn}
                        onPress={(e) => { e.stopPropagation?.(); setQuoteAmount(r.price > 0 ? String(r.price) : ''); setQuoteFor(r); }}
                      >
                        <Ionicons name="pricetag-outline" size={13} color="#6F42C1" />
                        <Text style={styles.quoteBtnText}>{r.price > 0 ? 'Update Quote' : 'Send Quote'}</Text>
                      </TouchableOpacity>
                      <View style={styles.actions}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.acceptBtn, r.price <= 0 && { opacity: 0.5 }]}
                          disabled={r.price <= 0}
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
                    </>
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
      <Modal visible={!!quoteFor} transparent animationType="fade" onRequestClose={() => setQuoteFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send price quote</Text>
            {quoteFor && (
              <Text style={styles.modalSub}>To {quoteFor.client} · {quoteFor.job}</Text>
            )}
            <View style={styles.amountRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={styles.amountInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
                value={quoteAmount}
                onChangeText={setQuoteAmount}
                autoFocus
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setQuoteFor(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSend]} onPress={submitQuote}>
                <Text style={styles.modalSendText}>Send Quote</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

  quoteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, marginTop: 8, borderWidth: 1, borderColor: '#6F42C1', backgroundColor: '#f5f0fb' },
  quoteBtnText: { color: '#6F42C1', fontWeight: '800', fontSize: 11 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#333', textAlign: 'center' },
  modalSub: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 10, paddingHorizontal: 12, marginTop: 14, borderWidth: 1, borderColor: '#eee' },
  rupee: { fontSize: 22, fontWeight: '800', color: '#10b981', marginRight: 6 },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '800', color: '#333', paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  modalCancel: { backgroundColor: '#f0f0f0' },
  modalCancelText: { color: '#666', fontWeight: '700', fontSize: 13 },
  modalSend: { backgroundColor: '#6F42C1' },
  modalSendText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
