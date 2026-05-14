import { Platform } from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export type NotifAudience = 'user' | 'worker';

export type Notification = {
  id: string;
  title: string;
  body: string;
  audience: NotifAudience;
  recipient_id: string;
  kind: 'booking_request' | 'booking_accepted' | 'booking_declined' | 'booking_completed' | 'info';
  data?: Record<string, any>;
  created_at: string;
  read: boolean;
};

function normalize(raw: any): Notification {
  return {
    id: String(raw.id),
    title: raw.title || '',
    body: raw.body || raw.message || '',
    audience: (raw.audience === 'worker' ? 'worker' : 'user') as NotifAudience,
    recipient_id: String(raw.recipient_id ?? ''),
    kind: (raw.kind || 'info') as Notification['kind'],
    data: raw.data,
    created_at: raw.created_at || new Date().toISOString(),
    read: Boolean(raw.read ?? raw.is_read),
  };
}

export async function listNotifications(audience: NotifAudience, recipientId: string): Promise<Notification[]> {
  if (!recipientId) return [];
  try {
    const res = await fetch(`${BASE_URL}/notifications/?audience=${audience}&recipient_id=${encodeURIComponent(recipientId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.map(normalize) : [];
  } catch {
    return [];
  }
}

export async function addNotification(n: Omit<Notification, 'id' | 'created_at' | 'read'>): Promise<Notification | null> {
  try {
    const res = await fetch(`${BASE_URL}/notifications/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: n.audience,
        recipient_id: n.recipient_id,
        title: n.title,
        body: n.body,
        kind: n.kind,
        data: n.data,
      }),
    });
    if (!res.ok) return null;
    return normalize(await res.json());
  } catch {
    return null;
  }
}

export async function unreadCount(audience: NotifAudience, recipientId: string): Promise<number> {
  if (!recipientId) return 0;
  try {
    const res = await fetch(`${BASE_URL}/notifications/unread-count?audience=${audience}&recipient_id=${encodeURIComponent(recipientId)}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data?.count || 0);
  } catch {
    return 0;
  }
}

export async function markAllRead(audience: NotifAudience, recipientId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/notifications/mark-all-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience, recipient_id: recipientId }),
    });
  } catch {}
}

export async function markRead(_audience: NotifAudience, _recipientId: string, id: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  } catch {}
}

export async function clearAll(audience: NotifAudience, recipientId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/notifications/?audience=${audience}&recipient_id=${encodeURIComponent(recipientId)}`, {
      method: 'DELETE',
    });
  } catch {}
}
