import { authFetch } from '@/lib/api';

export type AvailabilitySlot = {
  id: number;
  worker_id: number;
  available_day: string | null;
  start_time: string | null; // "HH:MM"
  end_time: string | null;
  is_available: boolean;
};

/**
 * Fetch a worker's weekly slots. Throws on network/HTTP failure so screens
 * can distinguish "load failed" from "no slots saved yet" — silently
 * returning [] made a failed load look like every day was switched off.
 */
export async function listAvailability(workerId: number): Promise<AvailabilitySlot[]> {
  const res = await authFetch(`/availability/?worker_id=${workerId}`);
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  return await res.json();
}

export async function upsertAvailability(slot: {
  worker_id: number;
  available_day: string;
  start_time?: string; // "HH:MM"
  end_time?: string;
  is_available?: boolean;
}): Promise<AvailabilitySlot | null> {
  try {
    const res = await authFetch('/availability/', {
      method: 'POST',
      json: slot,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function deleteAvailability(slotId: number): Promise<boolean> {
  try {
    const res = await authFetch(`/availability/${slotId}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
