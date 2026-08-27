import BottomNav from '@/components/bottom-nav';
import { getAuth } from '@/lib/api';
import { clearAll, listNotifications, markAllRead, markRead, Notification, NotifAudience } from '@/lib/notifications';
import { ensureSocket, onNotificationCreated } from '@/lib/socket';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
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

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load is NOT the same as an empty inbox — render it distinctly.
  const [loadError, setLoadError] = useState('');
  // Ticks every 30s so "just now"/"5m ago" labels stay truthful instead of
  // freezing at whatever they read on the render that fetched the list.
  const [, setTick] = useState(0);
  // Identity comes from the session, never from URL params — a crafted
  // ?as=...&id=... must not be able to point this screen at someone else's
  // inbox (the backend enforces it too, but the UI shouldn't ask for it).
  const [audience, setAudience] = useState<NotifAudience>('user');
  const [recipientId, setRecipientId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getAuth();
      if (cancelled) return;
      setAudience(auth?.role === 'worker' ? 'worker' : 'user');
      setRecipientId(auth?.id ? String(auth.id) : '');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, audience, recipientId]);

  // New notifications arrive over the socket while this screen is open —
  // prepend them instead of making the user pull-to-refresh.
  useEffect(() => {
    if (!ready || !recipientId) return;
    let alive = true;
    let off: () => void = () => {};
    (async () => {
      await ensureSocket();
      if (!alive) return;
      off = onNotificationCreated((data) => {
        if (data.audience !== audience || String(data.recipient_id) !== recipientId) return;
        const item: Notification = {
          id: String(data.id),
          title: data.title || '',
          body: data.body || '',
          audience: data.audience,
          recipient_id: String(data.recipient_id),
          kind: (data.kind || 'info') as Notification['kind'],
          created_at: data.created_at || new Date().toISOString(),
          read: false,
        };
        setItems((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev]));
      });
    })();
    return () => { alive = false; off(); };
  }, [ready, audience, recipientId]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  async function reload() {
    setLoading(true);
    setLoadError('');
    try {
      setItems(await listNotifications(audience, recipientId));
    } catch {
      setLoadError('Could not load notifications. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function onItemPress(n: Notification) {
    if (!n.read) {
      await markRead(audience, recipientId, n.id);
      reload();
    }
    // Optional deep link based on kind
    if (n.kind === 'booking_request' && audience === 'worker') {
      router.push('/worker_bookings');
    } else if ((n.kind === 'booking_accepted' || n.kind === 'booking_declined' || n.kind === 'booking_completed') && audience === 'user') {
      // Completed bookings surface the "Rate worker" button on the Past tab.
      router.push('/bookings');
    } else if (n.kind === 'booking_completed' && audience === 'worker') {
      router.push('/worker_bookings');
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
          {loading ? (
            <ActivityIndicator color="#6F42C1" style={{ marginTop: 40 }} />
          ) : loadError ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={42} color="#ccc" />
              <Text style={[styles.emptyText, { color: '#b91c1c' }]}>{loadError}</Text>
              <TouchableOpacity
                accessibilityLabel="Retry loading notifications"
                onPress={() => void reload()}
                style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#6F42C1' }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={42} color="#ccc" />
              <Text style={styles.emptyText}>No notifications yet</Text>
              <Text style={styles.emptySub}>You&apos;ll see booking updates and messages here.</Text>
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
        ? <BottomNav currentRoute="requests" role="worker" />
        : <BottomNav currentRoute="home" role="user" />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#fff' },
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
