import BottomNav from '@/components/bottom-nav';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Tab = 'present' | 'completed';

export default function BookingsPage() {
  const [tab, setTab] = useState<Tab>('present');

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
            style={[styles.tabBtn, tab === 'completed' && styles.tabBtnActive]}
            onPress={() => setTab('completed')}
          >
            <Text style={[styles.tabText, tab === 'completed' && styles.tabTextActive]}>
              Completed Bookings
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {tab === 'present' ? (
            <Text style={styles.placeholder}>No present bookings</Text>
          ) : (
            <Text style={styles.placeholder}>No completed bookings</Text>
          )}
        </View>
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
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  placeholder: { fontSize: 14, color: '#999' },
});
