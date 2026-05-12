import BottomNav from '@/components/bottom-nav';
import WorkerBottomNav from '@/components/worker-bottom-nav';
import { clearAll, listNotifications, markAllRead, markRead, Notification, NotifAudience } from '@/lib/notifications';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const ICON: Record<Notification['kind'], { name: any; color: string; bg: string }> = {
  booking_request:   { name: 'mail-unread',     color: '#6F42C1', bg: '#f0e6ff' },
  booking_accepted:  { name: 'checkmark-circle', color: '#10b981', bg: '#dcfce7' },
  booking_declined:  { name: 'close-circle',    color: '#FF6B6B', bg: '#fee2e2' },
  booking_completed: { name: 'trophy',          color: '#FFB800', bg: '#fef3c7' },
  info:              { name: 'information-circle', color: '#3b82f6', bg: '#dbeafe' },
};

function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPage() {
  const router = useRouter();
  const { as, id } = useLocalSearchParams<{ as?: string; id?: string }>();
  const audience: NotifAudience = (as === 'worker' ? 'worker' : 'user');
  const recipientId = String(id || '');

  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => { reload(); }, [audience, recipientId]);

  async function reload() {
    setItems(await listNotifications(audience, recipientId));
  }

  async function onItemPress(n: Notification) {
    if (!n.read) {
      await markRead(audience, recipientId, n.id);
      reload();
    }
    // Optional deep link based on kind
    if (n.kind === 'booking_request' && audience === 'worker') {
      router.push('/worker_bookings');
    } else if ((n.kind === 'booking_accepted' || n.kind === 'booking_declined') && audience === 'user') {
      router.push('/bookings');
    }
  }

  async function onMarkAll() {
    await markAllRead(audience, recipientId);
    reload();
  }

  async function onClear() {
    Alert.alert('Clear notifications', 'Remove all notifications?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearAll(audience, recipientId); reload(); } },
    ]);
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Notifications</Text>
          <TouchableOpacity onPress={onMarkAll}>
            <Ionicons name="checkmark-done" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {items.length > 0 && (
          <TouchableOpacity onPress={onClear} style={styles.clearLink}>
            <Text style={styles.clearLinkText}>Clear all</Text>
          </TouchableOpacity>
        )}

        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={42} color="#ccc" />
              <Text style={styles.emptyText}>No notifications yet</Text>
              <Text style={styles.emptySub}>You'll see booking updates and messages here.</Text>
            </View>
          ) : (
            items.map((n) => {
              const ic = ICON[n.kind] || ICON.info;
              return (
                <TouchableOpacity key={n.id} style={[styles.card, !n.read && styles.cardUnread]} activeOpacity={0.85} onPress={() => onItemPress(n)}>
                  <View style={[styles.iconBox, { backgroundColor: ic.bg }]}>
                    <Ionicons name={ic.name} size={18} color={ic.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.headerRow}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{n.title}</Text>
                      {!n.read && <View style={styles.dot} />}
                    </View>
                    <Text style={styles.cardBody} numberOfLines={2}>{n.body}</Text>
                    <Text style={styles.cardTime}>{timeAgo(n.created_at)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
      {audience === 'worker'
        ? <WorkerBottomNav currentRoute="requests" />
        : <BottomNav currentRoute="home" />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', maxWidth: 360, alignSelf: 'center', backgroundColor: '#fff' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#6F42C1', paddingHorizontal: 14, paddingVertical: 12 },
  title: { fontSize: 16, fontWeight: '800', color: '#fff' },
  clearLink: { alignSelf: 'flex-end', padding: 10, paddingRight: 16 },
  clearLinkText: { color: '#FF6B6B', fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { marginTop: 10, fontSize: 14, fontWeight: '700', color: '#666' },
  emptySub: { marginTop: 4, fontSize: 12, color: '#999' },

  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  cardUnread: { backgroundColor: '#fafaff' },
  iconBox: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#333', flex: 1 },
  cardBody: { fontSize: 12, color: '#555', marginTop: 2, lineHeight: 17 },
  cardTime: { fontSize: 10, color: '#999', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6F42C1' },
});
