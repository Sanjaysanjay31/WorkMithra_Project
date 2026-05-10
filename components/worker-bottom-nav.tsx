import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  currentRoute: 'dashboard' | 'requests' | 'switch_role' | 'profile';
}

export default function WorkerBottomNav({ currentRoute }: Props) {
  const router = useRouter();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', route: '/worker_dashboard' },
    { id: 'requests', label: 'Requests', icon: 'mail-unread', route: '/worker_bookings' },
    { id: 'switch_role', label: 'Switch', icon: 'repeat', route: '/switch_role' },
    { id: 'profile', label: 'Profile', icon: 'person', route: '/worker_profile' },
  ];

  return (
    <View style={styles.navBar}>
      {navItems.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={styles.navItem}
          onPress={() => router.push(item.route as any)}
        >
          <Ionicons
            name={item.icon as any}
            size={22}
            color={currentRoute === item.id ? '#6F42C1' : '#ccc'}
          />
          <Text style={[styles.navLabel, { color: currentRoute === item.id ? '#6F42C1' : '#ccc' }]}>
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    height: 70,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e9ecef',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  navLabel: { fontSize: 10, marginTop: 4, fontWeight: '600' },
});
