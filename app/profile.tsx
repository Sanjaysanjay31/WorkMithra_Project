import BottomNav from '@/components/bottom-nav';
import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function ProfilePage() {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Profile', headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>My Profile</Text>
        <Text style={styles.placeholder}>Profile details coming soon</Text>
      </View>
      <BottomNav currentRoute="profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: 360, height: 803, alignSelf: 'center', backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 12 },
  placeholder: { fontSize: 14, color: '#999' },
});
