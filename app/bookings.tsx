import BottomNav from '@/components/bottom-nav';
import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function BookingsPage() {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Bookings', headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>My Bookings</Text>
        <Text style={styles.placeholder}>No bookings yet</Text>
      </View>
      <BottomNav currentRoute="bookings" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: 360, height: 803, alignSelf: 'center', backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 12 },
  placeholder: { fontSize: 14, color: '#999' },
});
