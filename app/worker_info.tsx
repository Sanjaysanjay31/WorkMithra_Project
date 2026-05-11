import BottomNav from '@/components/bottom-nav';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export default function WorkerInfoPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [activeTab, setActiveTab] = useState<'profile' | 'reviews' | 'chat' | 'booking'>('profile');
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkerDetails();
  }, [id]);

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

  const handleCall = () => {
    if (worker?.phone) {
      Linking.openURL(`tel:${worker.phone}`);
    }
  };

  const handleChat = () => {
    if (worker?.phone) {
      Linking.openURL(`sms:${worker.phone}`);
    }
  };

  const handleBooking = () => {
    router.push({ pathname: '/bookings', params: { workerId: String(id) } });
  };

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

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Worker Details', headerShown: false }} />
      <View style={styles.designFrame}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#6F42C1" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Worker Details</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Worker Header Card */}
        <View style={styles.workerHeader}>
          <Image
            source={{ uri: worker.profile_image || 'https://placehold.co/100x100' }}
            style={styles.largeAvatar}
          />
          <Text style={styles.workerNameLarge}>{worker.full_name}</Text>
          <Text style={styles.workerSkill}>{worker.skill || 'Professional'}</Text>
          <View style={styles.ratingRow}>
            <Text style={styles.ratingText}>⭐ {(worker.rating ?? 0).toFixed(1)}</Text>
            <Text style={styles.jobsText}>• {worker.completed_jobs} completed jobs</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabsContainer}>
          {['profile', 'reviews', 'chat', 'booking'].map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab as any)}
            >
              <Text
                style={[styles.tabText, activeTab === tab && styles.activeTabText]}
              >
                {tab === 'profile' && 'Profile'}
                {tab === 'reviews' && 'Reviews'}
                {tab === 'chat' && 'Chat'}
                {tab === 'booking' && 'Booking'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'profile' && (
            <View style={styles.tabPane}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Name</Text>
                <Text style={styles.detailValue}>{worker.full_name || '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Age</Text>
                <Text style={styles.detailValue}>{worker.age ? `${worker.age} years` : '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Domain</Text>
                <Text style={styles.detailValue}>{worker.skill || 'General'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Wage</Text>
                <Text style={styles.detailValue}>₹{worker.hourly_rate || '—'} / hour</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Experience</Text>
                <Text style={styles.detailValue}>{worker.experience_years ?? 0} years</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Previous Jobs</Text>
                <Text style={styles.detailValue}>{worker.completed_jobs ?? worker.total_jobs ?? 0}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Phone</Text>
                <Text style={styles.detailValue}>{worker.phone || '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Alt. Phone</Text>
                <Text style={styles.detailValue}>{worker.alternate_phone || worker.alt_phone || '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Address</Text>
                <Text style={styles.detailValue}>{worker.address || worker.location || worker.city || '—'}</Text>
              </View>
            </View>
          )}

          {activeTab === 'reviews' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Reviews & Ratings</Text>
              <View style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <Text style={styles.reviewRating}>⭐ {(worker.rating ?? 0).toFixed(1)}</Text>
                  <Text style={styles.reviewCount}>Based on {worker.completed_jobs} reviews</Text>
                </View>
                <Text style={styles.reviewText}>
                  Great work! Highly recommended professional with excellent skills and reliability.
                </Text>
              </View>
              <View style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <Text style={styles.reviewRating}>⭐⭐⭐⭐⭐</Text>
                  <Text style={styles.reviewCount}>Recent feedback</Text>
                </View>
                <Text style={styles.reviewText}>
                  Very professional and completed the work on time. Perfect!
                </Text>
              </View>
            </View>
          )}

          {activeTab === 'chat' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Contact Worker</Text>
              <View style={styles.contactInfo}>
                <Ionicons name="call-outline" size={24} color="#6F42C1" />
                <Text style={styles.phoneText}>{worker.phone || '+91 XXXX XXX XXX'}</Text>
              </View>

              <TouchableOpacity style={styles.callButton} onPress={handleCall}>
                <Ionicons name="call" size={20} color="white" />
                <Text style={styles.callButtonText}>Call Worker</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.chatButton}
                onPress={() => router.push({ pathname: '/chat', params: { workerId: String(id), workerName: worker.full_name || '' } })}
              >
                <Ionicons name="chatbubbles-outline" size={20} color="white" />
                <Text style={styles.chatButtonText}>Open AI Translation Chat</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.chatButton, { backgroundColor: '#10b981', marginTop: 8 }]} onPress={handleChat}>
                <Ionicons name="chatbubble-outline" size={20} color="white" />
                <Text style={styles.chatButtonText}>Send SMS</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeTab === 'booking' && (
            <View style={styles.tabPane}>
              <Text style={styles.sectionTitle}>Booking Status</Text>
              <View style={styles.bookingCard}>
                <View style={styles.bookingRow}>
                  <Text style={styles.bookingLabel}>Current Status</Text>
                  <Text style={styles.bookingStatus}>{worker.current_status || 'Available'}</Text>
                </View>
                <View style={styles.bookingRow}>
                  <Text style={styles.bookingLabel}>Available Hours</Text>
                  <Text style={styles.bookingValue}>9 AM - 6 PM</Text>
                </View>
                <View style={styles.bookingRow}>
                  <Text style={styles.bookingLabel}>Response Time</Text>
                  <Text style={styles.bookingValue}>Usually within 1 hour</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.bookNowButton} onPress={handleBooking}>
                <Text style={styles.bookNowButtonText}>Book Now</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
      <BottomNav currentRoute="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  designFrame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff' },
  errorText: { fontSize: 16, color: '#999' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  workerHeader: { alignItems: 'center', paddingVertical: 20, backgroundColor: '#f8f8f8' },
  largeAvatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 12, backgroundColor: '#e9ecef' },
  workerNameLarge: { fontSize: 20, fontWeight: '800', color: '#333' },
  workerSkill: { fontSize: 14, color: '#666', marginTop: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  ratingText: { fontSize: 14, fontWeight: '700', color: '#FFB800' },
  jobsText: { fontSize: 12, color: '#999', marginLeft: 4 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#6F42C1' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#999' },
  activeTabText: { color: '#6F42C1' },
  tabContent: { flex: 1, paddingHorizontal: 16, paddingTop: 16, marginBottom: 80 },
  tabPane: { paddingBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#333', marginVertical: 12 },
  sectionText: { fontSize: 13, color: '#666', lineHeight: 20 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  detailLabel: { fontSize: 13, fontWeight: '700', color: '#666', flex: 1 },
  detailValue: { fontSize: 13, color: '#333', flex: 1.4, textAlign: 'right' },
  reviewCard: { backgroundColor: '#f8f8f8', padding: 12, borderRadius: 12, marginBottom: 12 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reviewRating: { fontSize: 14, fontWeight: '800', color: '#FFB800' },
  reviewCount: { fontSize: 11, color: '#999' },
  reviewText: { fontSize: 12, color: '#666', lineHeight: 18 },
  contactInfo: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', padding: 16, borderRadius: 12, marginBottom: 16 },
  phoneText: { fontSize: 14, fontWeight: '600', color: '#333', marginLeft: 12 },
  callButton: { flexDirection: 'row', backgroundColor: '#10b981', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  callButtonText: { color: 'white', fontWeight: '700', marginLeft: 8, fontSize: 14 },
  chatButton: { flexDirection: 'row', backgroundColor: '#6F42C1', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chatButtonText: { color: 'white', fontWeight: '700', marginLeft: 8, fontSize: 14 },
  bookingCard: { backgroundColor: '#f8f8f8', padding: 16, borderRadius: 12, marginBottom: 16 },
  bookingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  bookingLabel: { fontSize: 13, fontWeight: '600', color: '#666' },
  bookingStatus: { fontSize: 13, fontWeight: '700', color: '#10b981' },
  bookingValue: { fontSize: 13, fontWeight: '600', color: '#333' },
  bookNowButton: { backgroundColor: '#FF6B6B', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  bookNowButtonText: { color: 'white', fontWeight: '800', fontSize: 16 },
});
