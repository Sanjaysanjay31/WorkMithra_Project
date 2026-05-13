import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface BottomNavProps {
  currentRoute: 'home' | 'bookings' | 'switch_role' | 'profile';
}

const ACTIVE = '#fff';
const ACTIVE_BG = '#6F42C1';
const INACTIVE = '#e5e7eb';
const BAR_BG = '#2a1a4a';

export default function BottomNav({ currentRoute }: BottomNavProps) {
  const router = useRouter();

  const navItems = [
    { id: 'home', label: 'Home', icon: 'home', route: '/homePage' },
    { id: 'bookings', label: 'Bookings', icon: 'calendar', route: '/bookings' },
    { id: 'switch_role', label: 'Switch', icon: 'repeat', route: '/login' },
    { id: 'profile', label: 'Profile', icon: 'person', route: '/profile' },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.navBar}>
        {navItems.map((item) => {
          const active = currentRoute === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.navItem}
              activeOpacity={0.7}
              onPress={() => router.push(item.route as any)}
            >
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Ionicons
                  name={(active ? item.icon : `${item.icon}-outline`) as any}
                  size={22}
                  color={active ? ACTIVE : INACTIVE}
                />
              </View>
              <Text style={[styles.navLabel, { color: active ? ACTIVE : INACTIVE, fontWeight: active ? '800' : '600' }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: BAR_BG,
    borderTopWidth: 1,
    borderTopColor: '#1a0f30',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: -2 }, shadowRadius: 8 },
      android: { elevation: 12 },
      web: { boxShadow: '0 -2px 10px rgba(0,0,0,0.06)' as any },
    }),
  },
  navBar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: BAR_BG,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 2,
  },
  iconWrap: {
    width: 44,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapActive: {
    backgroundColor: ACTIVE_BG,
  },
  navLabel: {
    fontSize: 11,
    marginTop: 2,
  },
});
