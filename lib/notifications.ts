import { storage } from './storage';

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

function key(audience: NotifAudience, id: string) {
  return `workmithra:notifications:${audience}:${id}`;
}

export async function listNotifications(audience: NotifAudience, recipientId: string): Promise<Notification[]> {
  try {
    const raw = await storage.get(key(audience, recipientId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function addNotification(n: Omit<Notification, 'id' | 'created_at' | 'read'>): Promise<Notification> {
  const item: Notification = {
    ...n,
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
    read: false,
  };
  const cur = await listNotifications(n.audience, n.recipient_id);
  const next = [item, ...cur].slice(0, 100); // cap at 100
  await storage.set(key(n.audience, n.recipient_id), JSON.stringify(next));
  return item;
}

export async function unreadCount(audience: NotifAudience, recipientId: string): Promise<number> {
  const list = await listNotifications(audience, recipientId);
  return list.filter((n) => !n.read).length;
}

export async function markAllRead(audience: NotifAudience, recipientId: string): Promise<void> {
  const list = await listNotifications(audience, recipientId);
  const next = list.map((n) => ({ ...n, read: true }));
  await storage.set(key(audience, recipientId), JSON.stringify(next));
}

export async function markRead(audience: NotifAudience, recipientId: string, id: string): Promise<void> {
  const list = await listNotifications(audience, recipientId);
  const next = list.map((n) => (n.id === id ? { ...n, read: true } : n));
  await storage.set(key(audience, recipientId), JSON.stringify(next));
}

export async function clearAll(audience: NotifAudience, recipientId: string): Promise<void> {
  await storage.remove(key(audience, recipientId));
}
