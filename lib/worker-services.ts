import { Platform } from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export type WorkerService = {
  id: number;
  worker_id: number;
  service_id: number;
  experience_level?: string | null;
  service_price?: number | null;
  service_name?: string | null;
  service_icon?: string | null;
};

export async function listWorkerServices(workerId: number): Promise<WorkerService[]> {
  try {
    const res = await fetch(`${BASE_URL}/worker-services/?worker_id=${workerId}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function attachService(
  workerId: number,
  serviceId: number,
  opts: { experience_level?: string; service_price?: number } = {},
): Promise<WorkerService | null> {
  try {
    const res = await fetch(`${BASE_URL}/worker-services/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worker_id: workerId,
        service_id: serviceId,
        experience_level: opts.experience_level ?? null,
        service_price: opts.service_price ?? null,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function detachService(workerId: number, serviceId: number): Promise<boolean> {
  try {
    const res = await fetch(
      `${BASE_URL}/worker-services/?worker_id=${workerId}&service_id=${serviceId}`,
      { method: 'DELETE' },
    );
    return res.ok;
  } catch {
    return false;
  }
}
