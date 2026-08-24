/**
 * AI-assistant conversation persistence.
 *
 * Logged-in users get server-backed history (GET/POST/DELETE /assistant/) so
 * the conversation survives reinstalls and device changes. Logged-out users
 * fall back to local storage. Local storage is always mirrored as an offline
 * cache.
 */
import { authFetch, expectJson, getAuth } from '@/lib/api';
import { storage } from '@/lib/storage';

export type AssistantMsg = { who: 'ai' | 'me'; text: string };

const SESSION_KEY = 'workmithra:assistant_session';

async function loadLocal(): Promise<AssistantMsg[]> {
  try {
    const raw = await storage.get(SESSION_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as AssistantMsg[];
    }
  } catch {}
  return [];
}

/** Load the conversation: server when logged in, local storage otherwise. */
export async function loadHistory(): Promise<AssistantMsg[]> {
  const auth = await getAuth();
  if (auth?.token) {
    try {
      const rows = await expectJson<{ role: string; text: string }[]>(
        await authFetch('/assistant/'),
        'Could not load assistant history',
      );
      return rows.map((r) => ({ who: r.role === 'me' ? 'me' : 'ai', text: r.text }));
    } catch (e) {
      console.warn('Assistant history: server load failed, using local cache', e);
    }
  }
  return loadLocal();
}

/**
 * Persist one message. Mirrors to local storage immediately and syncs to the
 * server fire-and-forget when logged in — the UI never blocks on this.
 */
export async function appendHistory(m: AssistantMsg): Promise<void> {
  try {
    const local = await loadLocal();
    await storage.set(SESSION_KEY, JSON.stringify([...local, m]));
  } catch {}

  const auth = await getAuth();
  if (!auth?.token) return;
  try {
    await authFetch('/assistant/', { method: 'POST', json: { role: m.who, text: m.text } });
  } catch (e) {
    console.warn('Assistant history: server append failed (kept locally)', e);
  }
}

/** Clear the conversation locally and on the server (best-effort). */
export async function clearHistory(): Promise<void> {
  try {
    await storage.remove(SESSION_KEY);
  } catch {}

  const auth = await getAuth();
  if (!auth?.token) return;
  try {
    await authFetch('/assistant/', { method: 'DELETE' });
  } catch (e) {
    console.warn('Assistant history: server clear failed', e);
  }
}
