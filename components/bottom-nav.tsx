import { Ionicons } from '@expo/vector-icons';
import { Href, usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearAllWorkMitraStorage } from '@/lib/storage';
import { unregisterPush } from '@/lib/push';
import { disconnectSocket } from '@/lib/socket';
import { useI18n } from '@/lib/i18n';

import type { ShadowStyle } from '@/lib/shadow';

export type NavRoute =
  | 'home' | 'bookings' | 'switch_role' | 'profile'
  | 'dashboard' | 'requests' | 'payments' | 'profile_worker';

interface NavItem {
  id: NavRoute;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  route: Href;
}

const ACTIVE = '#fff';
const ACTIVE_BG = '#6F42C1';
const INACTIVE = '#e5e7eb';
const BAR_BG = '#2a1a4a';

const CLIENT_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', route: '/homePage' },
  { id: 'bookings', label: 'Bookings', icon: 'calendar', route: '/bookings' },
  { id: 'switch_role', label: 'Switch', icon: 'repeat', route: '/login' },
  { id: 'profile', label: 'Profile', icon: 'person', route: '/profile' },
];

const WORKER_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', route: '/worker_dashboard' },
  { id: 'requests', label: 'Requests', icon: 'mail', route: '/worker_bookings' },
  { id: 'payments', label: 'Payments', icon: 'wallet', route: '/worker_payments' },
  { id: 'switch_role', label: 'Switch', icon: 'repeat', route: '/login' },
  { id: 'profile_worker', label: 'Profile', icon: 'person', route: '/worker_profile' },
];

interface BottomNavProps {
  currentRoute: NavRoute;
  role?: 'user' | 'worker';
}

export default function BottomNav({ currentRoute, role = 'user' }: BottomNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const items = role === 'worker' ? WORKER_ITEMS : CLIENT_ITEMS;
  // System navigation area (Android edge-to-edge draws the 3-button bar /
  // gesture pill OVER the app, and its height varies per phone). The root
  // layout already pads the screen bottom by this inset with a light
  // background — so without compensation a light strip shows below this dark
  // bar (taller on 3-button phones, thin on gesture phones: the "doesn't fit
  // on some phones" complaint). Pull the dark background down over that strip
  // (marginBottom) and pad the buttons by at least 12px, so the tappable row
  // always floats above the system bar / screen edge on every phone.
  const bottomInset = useSafeAreaInsets().bottom;
  const bottomPad = Math.max(bottomInset, 12);

  // Switching role IS a logout: wipe the session, caches, and realtime
  // socket before heading to login — matching profile.tsx's switch flow.
  // A stray tap shouldn't do it instantly, so confirm first. (Web uses
  // window.confirm to match the profile screens' logout idiom.)
  const handlePress = async (item: NavItem) => {
    if (item.id !== 'switch_role') {
      // Already on this exact screen — pushing again would stack a duplicate
      // (repeated taps grew the stack unboundedly and back cycled through
      // identical copies). Compare the REAL pathname, not the `currentRoute`
      // highlight: detail screens reuse a tab id while sitting on their own
      // route, and tapping that tab there must still navigate.
      if (pathname === item.route) return;
      router.push(item.route);
      return;
    }
    const doSwitch = async () => {
      disconnectSocket();
      await unregisterPush();
      await clearAllWorkMitraStorage();
      router.replace('/login');
    };
    const message = t('auth.switchMessage');
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) await doSwitch();
      return;
    }
    Alert.alert(t('auth.switchTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.switch'), style: 'destructive', onPress: doSwitch },
    ]);
  };

  return (
    <View style={[styles.wrap, { marginBottom: -bottomInset, paddingBottom: bottomPad }]}>
      <View style={styles.navBar}>
        {items.map((item) => {
          const active = currentRoute === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.navItem}
              activeOpacity={0.7}
              onPress={() => handlePress(item)}
            >
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Ionicons
                  name={(active ? item.icon : `${item.icon}-outline`) as React.ComponentProps<typeof Ionicons>['name']}
                  size={22}
                  color={active ? ACTIVE : INACTIVE}
                />
              </View>
              <Text style={[styles.navLabel, { color: active ? ACTIVE : INACTIVE, fontWeight: active ? '800' : '600' }]}>
                {t(`nav.${item.id}`, undefined, item.label)}
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
      web: { boxShadow: '0 -2px 10px rgba(0,0,0,0.06)' } as ShadowStyle,
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