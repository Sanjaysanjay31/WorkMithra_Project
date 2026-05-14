import BottomNav from '@/components/bottom-nav';
import Avatar from '@/components/avatar';
import { addNotification } from '@/lib/notifications';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Linking,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;


type Tab = 'profile' | 'reviews' | 'chat' | 'booking' | 'map';

type HistoryItem = { id: string; date: string; time: string; price: number; status: 'completed' | 'cancelled' };

function toRad(d: number) { return (d * Math.PI) / 180; }

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function buildUpcomingDates(days = 30): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const today = new Date();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const prefix = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()];
    const label = `${prefix}, ${d.getDate()} ${monthNames[d.getMonth()]}`;
    out.push({ value, label });
  }
  return out;
}

function buildTimeSlots(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 8; h <= 20; h++) {
    for (const m of [0, 30]) {
      const value = `${pad(h)}:${pad(m)}:00`;
      const hr12 = ((h + 11) % 12) + 1;
      const ampm = h < 12 ? 'AM' : 'PM';
      const label = `${hr12}:${pad(m)} ${ampm}`;
      out.push({ value, label });
    }
  }
  return out;
}

function formatTimeLabel(value: string): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr); const m = Number(mStr);
  const hr12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hr12}:${pad(m)} ${ampm}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function WorkerInfoPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const workerId = String(id || '');
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Booking form state
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [bookNote, setBookNote] = useState('');
  const [bookPrice, setBookPrice] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Map state
  const [clientLoc, setClientLoc] = useState<{ lat: number; lng: number } | null>(null);

  // Feedback state — reviews loaded from backend
  type ReviewItem = { id: string | number; name: string; rating: number; date: string; text: string };
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(5);

  async function loadReviews() {
    const wid = Number(id);
    if (!wid) return;
    try {
      const res = await fetch(`${BASE_URL}/reviews/?worker_id=${wid}`);
      if (!res.ok) return;
      const data: any[] = await res.json();
      setReviews(
        data.map((r) => ({
          id: r.id,
          name: r.user_name || (r.user_id ? `User #${r.user_id}` : 'Client'),
          rating: Number(r.rating) || 0,
          date: r.created_at ? String(r.created_at).split('T')[0] : '',
          text: r.review_text || '',
        })),
      );
    } catch {}
  }

  async function handleSubmitFeedback() {
    if (!feedbackText.trim()) {
      Alert.alert('Feedback', 'Please write something before submitting.');
      return;
    }
    let uid = 0;
    try {
      const authRaw = await storage.get('workmithra:auth');
      if (authRaw) { const auth = JSON.parse(authRaw); if (auth.id) uid = auth.id; }
    } catch {}
    const wid = Number(id);
    if (!wid || Number.isNaN(wid)) {
      Alert.alert('Submit failed', `Invalid worker id: ${id}`);
      return;
    }
    const url = `${BASE_URL}/reviews/`;
    const body = { worker_id: wid, user_id: uid || null, rating: feedbackRating, review_text: feedbackText };
    console.log('[review] POST', url, body);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      console.log('[review] response', res.status, text.slice(0, 300));
      if (!res.ok) {
        Alert.alert('Submit failed', `HTTP ${res.status}\n${text.slice(0, 200)}\n\nURL: ${url}`);
        return;
      }
      setFeedbackText('');
      await loadReviews();
      Alert.alert('Success', 'Thank you for your feedback!');
    } catch (e: any) {
      Alert.alert('Submit failed', `${e?.message || 'Network error'}\n\nURL: ${url}`);
    }
  }

  useEffect(() => {
    fetchWorkerDetails();
    loadHistory();
    loadReviews();
  }, [id]);

  useEffect(() => {
    if (activeTab === 'map') tryGetLocation();
  }, [activeTab]);

  async function fetchWorkerDetails() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/workers/${id}`);
      const data = await res.json();
      setWorker(data);
    } catch (e) {
      console.warn('Failed to fetch worker', e);
      Alert.alert('Error', 'Failed to load worker details');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    const wid = Number(id);
    if (wid) {
      try {
        const res = await fetch(`${BASE_URL}/job-history/?worker_id=${wid}`);
        if (res.ok) {
          const rows: any[] = await res.json();
          if (Array.isArray(rows) && rows.length) {
            setHistory(
              rows.map((r) => ({
                id: String(r.id),
                date: r.completed_at ? String(r.completed_at).split('T')[0] : '',
                time: r.completed_at ? String(r.completed_at).split('T')[1]?.slice(0, 5) || '' : '',
                price: 0,
                status: 'completed' as const,
              })),
            );
            return;
          }
        }
      } catch {}
    }
    // Fall back to locally cached history if backend has nothing yet.
    try {
      const raw = await storage.get(`workmithra:history:${workerId}`);
      if (raw) { setHistory(JSON.parse(raw)); return; }
    } catch {}
    setHistory([]);
  }

  async function tryGetLocation() {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setClientLoc({ lat: 17.385, lng: 78.4867 });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => setClientLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setClientLoc({ lat: 17.385, lng: 78.4867 }),
        { enableHighAccuracy: false, timeout: 5000 },
      );
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setClientLoc({ lat: 17.385, lng: 78.4867 }); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setClientLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setClientLoc({ lat: 17.385, lng: 78.4867 });
    }
  }

  const distanceKm = useMemo(() => {
    if (!clientLoc || !worker?.latitude || !worker?.longitude) return null;
    return haversineKm(clientLoc.lat, clientLoc.lng, Number(worker.latitude), Number(worker.longitude));
  }, [clientLoc, worker]);

  const handleCall = () => worker?.phone && Linking.openURL(`tel:${worker.phone}`);

  useEffect(() => {
    (async () => {
      try {
        const authRaw = await storage.get('workmithra:auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          if (auth.id) {
            const { initializeSocket } = require('@/lib/socket');
            initializeSocket(auth.id);
          }
        }
      } catch {}
    })();
  }, []);

  async function handleBookNow() {
    if (!bookDate.trim() || !bookTime.trim()) {
      Alert.alert('Booking', 'Please enter both date and time.');
      return;
    }
    
    let currentUid = 0;
    try {
      const authRaw = await storage.get('workmithra:auth');
      if (authRaw) {
        const auth = JSON.parse(authRaw);
        if (auth.id) currentUid = auth.id;
      }
    } catch {}

    if (!currentUid) {
      Alert.alert('Authentication', 'Please login to book a worker');
      return;
    }

    setLoading(true);
    try {
      // 1. Create booking in DB
      const res = await fetch(`${BASE_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUid,
          worker_id: Number(workerId),
          booking_date: bookDate,
          booking_time: bookTime.length === 5 ? `${bookTime}:00` : bookTime,
          problem_description: bookNote,
          estimated_price: bookPrice && !isNaN(Number(bookPrice)) ? Number(bookPrice) : null,
          customer_address: 'Home Address (Default)', // In real app, get from user profile
          status: 'pending'
        })
      });
      
      if (!res.ok) throw new Error('Failed to create booking');
      const bookingData = await res.json();

      // 2. Send real-time notification via Socket.IO
      const { sendBookingRequest } = require('@/lib/socket');
      sendBookingRequest({
        booking_id: bookingData.id,
        worker_id: Number(workerId),
        client_id: currentUid,
        booking_date: bookDate,
        booking_time: bookTime,
        problem_description: bookNote,
      });

      // 3. Update local history
      const agreedPrice = bookPrice && !isNaN(Number(bookPrice)) ? Number(bookPrice) : 0;
      const newItem: HistoryItem = {
        id: String(bookingData.id),
        date: bookDate,
        time: bookTime,
        price: agreedPrice,
        status: 'completed', // For history tab, we show it as success/completed usually
      };
      const next = [newItem, ...history];
      setHistory(next);
      await storage.set(`workmithra:history:${workerId}`, JSON.stringify(next));

      // 4. Add push-style notifications (local lib)
      await addNotification({
        audience: 'worker',
        recipient_id: workerId,
        kind: 'booking_request',
        title: 'New booking request',
        body: `Booking for ${bookDate} at ${bookTime} · price to be quoted`,
        data: { booking_id: bookingData.id, ...newItem, note: bookNote },
      });

      Alert.alert(
        'Booked',
        agreedPrice > 0
          ? `Request sent for ${bookDate} at ${bookTime}. Agreed price ₹${agreedPrice}.`
          : `Request sent for ${bookDate} at ${bookTime}. You can set the agreed price later.`
      );
      setBookDate(''); setBookTime(''); setBookNote(''); setBookPrice('');
      setActiveTab('profile');
    } catch (e) {
      console.error('Booking failed', e);
      Alert.alert('Error', 'Failed to create booking. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#6F42C1" style={{ marginTop: 200 }} />
      </View>
    );
  }
  if (!worker) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Worker not found</Text>
      </View>
    );
  }

  const repeatBooking = history.length >= 2;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Worker Details', headerShown: false }} />
      <View style={styles.designFrame}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#6F42C1" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Worker Details</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.workerHeader}>
          <Avatar uri={worker.profile_image} name={worker.full_name} size={90} style={styles.largeAvatar as any} />
          <Text style={styles.workerNameLarge}>{worker.full_name}</Text>
          <Text style={styles.workerSkill}>{worker.skill || 'Professional'}</Text>
          <View style={styles.ratingRow}>
            <Text style={styles.ratingText}>⭐ {(worker.rating ?? 0).toFixed(1)}</Text>
            <Text style={styles.jobsText}>• {worker.completed_jobs ?? worker.total_jobs ?? 0} jobs</Text>
          </View>
        </View>

        <View style={styles.tabsContainer}>
          {(['profile', 'reviews', 'chat', 'booking', 'map'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.activeTab]} onPress={() => setActiveTab(t)}>
              <Text style={[styles.tabText, activeTab === t && styles.activeTabText]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          {activeTab === 'profile' && (
            <View style={styles.tabPane}>
              <Detail label="Name" value={worker.full_name} />
              <Detail label="Age" value={worker.age ? `${worker.age} years` : '—'} />
              <Detail label="Domain" value={worker.skill || 'General'} />
              <Detail label="Wage" value={`₹${worker.hourly_rate || '—'} / hour`} />
              <Detail label="Experience" value={`${worker.experience_years ?? 0} years`} />
              <Detail label="Completed Jobs" value={String(worker.completed_jobs ?? worker.total_jobs ?? 0)} />
              <Detail label="Phone" value={worker.phone} />
              <Detail label="Alt. Phone" value={worker.alternate_phone || worker.alt_phone || '—'} />
              <Detail label="City" value={worker.city || '—'} />
              <Detail label="Address" value={worker.address || worker.location || '—'} />
              <Detail label="Verified" value={worker.aadhaar_verified ? '✓ Aadhaar Verified' : 'Not verified'} />
            </View>
          )}

          {activeTab === 'reviews' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Leave Feedback</Text>
              <View style={styles.feedbackForm}>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <TouchableOpacity key={star} onPress={() => setFeedbackRating(star)} activeOpacity={0.7}>
                      <Ionicons 
                        name={star <= feedbackRating ? "star" : "star-outline"} 
                        size={26} 
                        color="#FFB800" 
                      />
                    </TouchableOpacity>
                  ))}
                  <Text style={styles.ratingLabel}>{feedbackRating}/5</Text>
                </View>
                <TextInput
                  style={styles.feedbackInput}
                  placeholder="Share your experience with this worker..."
                  placeholderTextColor="#999"
                  multiline
                  value={feedbackText}
                  onChangeText={setFeedbackText}
                />
                <TouchableOpacity style={styles.submitFeedbackBtn} onPress={handleSubmitFeedback} activeOpacity={0.85}>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={styles.submitFeedbackText}>Submit Review</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.sectionTitle, { marginTop: 24 }]}>What clients say</Text>
              {reviews.map((r) => (
                <View key={r.id} style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <Text style={styles.reviewName}>{r.name}</Text>
                    <Text style={styles.reviewRating}>⭐ {r.rating.toFixed(1)}</Text>
                  </View>
                  <Text style={styles.reviewDate}>{r.date}</Text>
                  <Text style={styles.reviewText}>"{r.text}"</Text>
                </View>
              ))}
            </View>
          )}

          {activeTab === 'chat' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Talk to the worker</Text>
              <View style={styles.contactInfo}>
                <Ionicons name="call-outline" size={24} color="#6F42C1" />
                <Text style={styles.phoneText}>{worker.phone || '+91 XXXX XXX XXX'}</Text>
              </View>
              <TouchableOpacity style={styles.callButton} onPress={handleCall}>
                <Ionicons name="call" size={20} color="white" />
                <Text style={styles.callButtonText}>Call Worker</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chatButton]}
                onPress={() => router.push({ pathname: '/chat', params: { workerId, workerName: worker.full_name || '' } })}
              >
                <Ionicons name="chatbubbles-outline" size={20} color="white" />
                <Text style={styles.chatButtonText}>Open AI Translation Chat</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeTab === 'booking' && (
            <View style={styles.tabPane}>
              {history.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>
                    {repeatBooking ? `You've booked ${worker.full_name} ${history.length} times` : 'Your history with this worker'}
                  </Text>
                  {history.map((h) => (
                    <View key={h.id} style={styles.historyCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyDate}>{h.date}  ·  {h.time}</Text>
                        <Text style={styles.historyStatus}>
                          {h.status === 'completed' ? '✓ Completed' : '✗ Cancelled'}
                        </Text>
                      </View>
                      <Text style={styles.historyPrice}>₹{h.price}</Text>
                    </View>
                  ))}
                </>
              )}

              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Book a new slot</Text>
              <View style={styles.bookForm}>
                {Platform.OS === 'web' ? (
                  <>
                    <View style={styles.formRow}>
                      <Ionicons name="calendar-outline" size={18} color="#6F42C1" />
                      {React.createElement('input', {
                        type: 'date',
                        value: bookDate,
                        min: new Date().toISOString().slice(0, 10),
                        onChange: (e: any) => setBookDate(e.target.value),
                        style: { flex: 1, padding: 10, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                      })}
                    </View>
                    <View style={styles.formRow}>
                      <Ionicons name="time-outline" size={18} color="#6F42C1" />
                      {React.createElement('input', {
                        type: 'time',
                        value: bookTime ? bookTime.slice(0, 5) : '',
                        onChange: (e: any) => setBookTime(e.target.value),
                        style: { flex: 1, padding: 10, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.formRow} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
                      <Ionicons name="calendar-outline" size={18} color="#6F42C1" />
                      <Text style={[styles.formInput, { paddingVertical: 12, color: bookDate ? '#333' : '#999' }]}>
                        {bookDate || 'Select date'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color="#999" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.formRow} onPress={() => setShowTimePicker(true)} activeOpacity={0.7}>
                      <Ionicons name="time-outline" size={18} color="#6F42C1" />
                      <Text style={[styles.formInput, { paddingVertical: 12, color: bookTime ? '#333' : '#999' }]}>
                        {bookTime ? formatTimeLabel(bookTime) : 'Select time'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color="#999" />
                    </TouchableOpacity>
                  </>
                )}
                <View style={styles.formRow}>
                  <Ionicons name="document-text-outline" size={18} color="#6F42C1" />
                  <TextInput
                    style={styles.formInput}
                    placeholder="Note (optional)"
                    placeholderTextColor="#999"
                    value={bookNote}
                    onChangeText={setBookNote}
                  />
                </View>
                <View style={styles.formRow}>
                  <Ionicons name="pricetag-outline" size={18} color="#6F42C1" />
                  <TextInput
                    style={styles.formInput}
                    placeholder="Agreed price ₹ (after chat with worker)"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    value={bookPrice}
                    onChangeText={setBookPrice}
                  />
                </View>

                <View style={styles.priceBox}>
                  <Text style={styles.priceLabel}>Agreed price</Text>
                  <Text style={[styles.priceValue, !bookPrice && { color: '#FF9800', fontSize: 13 }]}>
                    {bookPrice && !isNaN(Number(bookPrice)) ? `₹${Number(bookPrice)}` : 'Discuss with worker first'}
                  </Text>
                </View>

                <TouchableOpacity style={styles.bookNowButton} onPress={handleBookNow}>
                  <Text style={styles.bookNowButtonText}>Book Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {activeTab === 'map' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Route to worker</Text>
              <View style={styles.mapInfoCard}>
                <View style={styles.mapRow}>
                  <Ionicons name="navigate" size={18} color="#6F42C1" />
                  <Text style={styles.mapLabel}>You</Text>
                  <Text style={styles.mapValue}>{clientLoc ? `${clientLoc.lat.toFixed(3)}, ${clientLoc.lng.toFixed(3)}` : 'Locating…'}</Text>
                </View>
                <View style={styles.mapRow}>
                  <Ionicons name="location" size={18} color="#FF6B6B" />
                  <Text style={styles.mapLabel}>Worker</Text>
                  <Text style={styles.mapValue}>
                    {worker.latitude && worker.longitude
                      ? `${Number(worker.latitude).toFixed(3)}, ${Number(worker.longitude).toFixed(3)}`
                      : worker.city || worker.location || '—'}
                  </Text>
                </View>
                <View style={styles.distanceRow}>
                  <Text style={styles.distanceLabel}>Distance</Text>
                  <Text style={styles.distanceValue}>
                    {distanceKm != null ? `${distanceKm.toFixed(1)} km` : '—'}
                  </Text>
                </View>
              </View>

              {clientLoc && worker.latitude && worker.longitude && (() => {
                const bbox = `${Math.min(clientLoc.lng, worker.longitude) - 0.02},${Math.min(clientLoc.lat, worker.latitude) - 0.02},${Math.max(clientLoc.lng, worker.longitude) + 0.02},${Math.max(clientLoc.lat, worker.latitude) + 0.02}`;
                const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${worker.latitude},${worker.longitude}`;
                return (
                  <View style={styles.mapEmbedWrap}>
                    {Platform.OS === 'web' ? (
                      <iframe style={{ width: '100%', height: 260, border: 0, borderRadius: 12 } as any} src={src} />
                    ) : (
                      <WebView source={{ uri: src }} style={{ width: '100%', height: 260, borderRadius: 12 }} />
                    )}
                  </View>
                );
              })()}

              <TouchableOpacity
                style={styles.openMapsBtn}
                onPress={() => {
                  if (!worker.latitude || !worker.longitude) {
                    Alert.alert('Map', 'Worker location not available');
                    return;
                  }
                  const origin = clientLoc ? `${clientLoc.lat},${clientLoc.lng}` : '';
                  const dest = `${worker.latitude},${worker.longitude}`;
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`);
                }}
              >
                <Ionicons name="map" size={18} color="#fff" />
                <Text style={styles.openMapsBtnText}>Open Route in Google Maps</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>

      {Platform.OS !== 'web' && showDatePicker && (
        <DateTimePicker
          value={(() => {
            if (bookDate) {
              const [y, m, d] = bookDate.split('-').map(Number);
              return new Date(y, (m || 1) - 1, d || 1);
            }
            return new Date();
          })()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
          minimumDate={new Date()}
          onChange={(event, selected) => {
            setShowDatePicker(false);
            if (event.type === 'set' && selected) {
              const y = selected.getFullYear();
              const m = pad(selected.getMonth() + 1);
              const d = pad(selected.getDate());
              setBookDate(`${y}-${m}-${d}`);
            }
          }}
        />
      )}

      {Platform.OS !== 'web' && showTimePicker && (
        <DateTimePicker
          value={(() => {
            if (bookTime) {
              const [h, m] = bookTime.split(':').map(Number);
              const dt = new Date();
              dt.setHours(h || 9, m || 0, 0, 0);
              return dt;
            }
            const dt = new Date();
            dt.setHours(9, 0, 0, 0);
            return dt;
          })()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          is24Hour={false}
          onChange={(event, selected) => {
            setShowTimePicker(false);
            if (event.type === 'set' && selected) {
              const h = pad(selected.getHours());
              const m = pad(selected.getMinutes());
              setBookTime(`${h}:${m}:00`);
            }
          }}
        />
      )}

      <BottomNav currentRoute="home" />
    </View>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  designFrame: { flex: 1, width: '100%', backgroundColor: '#fff' },
  errorText: { fontSize: 16, color: '#999' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  workerHeader: { alignItems: 'center', paddingVertical: 16, backgroundColor: '#f8f8f8' },
  largeAvatar: { width: 90, height: 90, borderRadius: 45, marginBottom: 10, backgroundColor: '#e9ecef' },
  workerNameLarge: { fontSize: 18, fontWeight: '800', color: '#333' },
  workerSkill: { fontSize: 13, color: '#666', marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  ratingText: { fontSize: 13, fontWeight: '700', color: '#FFB800' },
  jobsText: { fontSize: 11, color: '#999', marginLeft: 4 },
  tabsContainer: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#6F42C1' },
  tabText: { fontSize: 11, fontWeight: '600', color: '#999' },
  activeTabText: { color: '#6F42C1' },
  tabContent: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  tabPane: { paddingBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#333', marginBottom: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  detailLabel: { fontSize: 13, fontWeight: '700', color: '#666', flex: 1 },
  detailValue: { fontSize: 13, color: '#333', flex: 1.4, textAlign: 'right' },

  reviewCard: { backgroundColor: '#fafafa', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewName: { fontSize: 13, fontWeight: '800', color: '#333' },
  reviewRating: { fontSize: 12, fontWeight: '800', color: '#FFB800' },
  reviewDate: { fontSize: 11, color: '#999', marginTop: 2 },
  reviewText: { fontSize: 12, color: '#444', lineHeight: 18, marginTop: 6, fontStyle: 'italic' },

  feedbackForm: { backgroundColor: '#fcfcfc', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#eee', marginBottom: 10 },
  starsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 4 },
  ratingLabel: { marginLeft: 8, fontSize: 14, fontWeight: '800', color: '#6F42C1' },
  feedbackInput: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', padding: 12, fontSize: 13, minHeight: 80, textAlignVertical: 'top', color: '#333' },
  submitFeedbackBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 6 },
  submitFeedbackText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  contactInfo: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', padding: 14, borderRadius: 12, marginBottom: 12 },
  phoneText: { fontSize: 14, fontWeight: '600', color: '#333', marginLeft: 10 },
  callButton: { flexDirection: 'row', backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  callButtonText: { color: '#fff', fontWeight: '700', marginLeft: 8, fontSize: 14 },
  chatButton: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chatButtonText: { color: '#fff', fontWeight: '700', marginLeft: 8, fontSize: 14 },

  historyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fafafa', padding: 10, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  historyDate: { fontSize: 12, fontWeight: '700', color: '#333' },
  historyStatus: { fontSize: 11, color: '#10b981', fontWeight: '700', marginTop: 2 },
  historyPrice: { fontSize: 14, fontWeight: '800', color: '#6F42C1' },

  bookForm: { backgroundColor: '#fafafa', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#eee' },
  formRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee', gap: 8 },
  formInput: { flex: 1, paddingVertical: 10, fontSize: 13, color: '#333' },
  priceBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 10, marginVertical: 6 },
  priceLabel: { fontSize: 12, color: '#666', fontWeight: '700' },
  priceValue: { fontSize: 16, color: '#10b981', fontWeight: '800' },
  bookNowButton: { backgroundColor: '#FF6B6B', paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  bookNowButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  mapInfoCard: { backgroundColor: '#fafafa', padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  mapRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  mapLabel: { fontSize: 12, fontWeight: '700', color: '#666', width: 60 },
  mapValue: { fontSize: 12, color: '#333', flex: 1 },
  distanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  distanceLabel: { fontSize: 13, fontWeight: '700', color: '#666' },
  distanceValue: { fontSize: 16, fontWeight: '800', color: '#6F42C1' },
  mapEmbedWrap: { borderRadius: 12, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  openMapsBtn: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
  openMapsBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: '#333', marginBottom: 10, textAlign: 'center' },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  pickerItemActive: { backgroundColor: '#6F42C1' },
  pickerItemText: { fontSize: 14, fontWeight: '600', color: '#333' },
  pickerItemTextActive: { color: '#fff' },
  pickerItemSub: { fontSize: 11, color: '#999', marginTop: 2 },
});
