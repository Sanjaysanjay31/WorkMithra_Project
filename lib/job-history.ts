import { Platform } from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export type JobHistoryEntry = {
  id: number;
  booking_id: number | null;
  worker_id: number | null;
  user_id: number | null;
  completion_notes: string | null;
  completed_at: string | null;
};

export async function listJobHistory(filters: { worker_id?: number; user_id?: number; booking_id?: number } = {}): Promise<JobHistoryEntry[]> {
  const params = new URLSearchParams();
  if (filters.worker_id != null) params.set('worker_id', String(filters.worker_id));
  if (filters.user_id != null) params.set('user_id', String(filters.user_id));
  if (filters.booking_id != null) params.set('booking_id', String(filters.booking_id));
  try {
    const res = await fetch(`${BASE_URL}/job-history/?${params.toString()}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function recordJobCompletion(payload: {
  booking_id?: number;
  worker_id: number;
  user_id?: number;
  completion_notes?: string;
}): Promise<JobHistoryEntry | null> {
  try {
    const res = await fetch(`${BASE_URL}/job-history/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: payload.booking_id ?? null,
        worker_id: payload.worker_id,
        user_id: payload.user_id ?? null,
        completion_notes: payload.completion_notes ?? null,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
