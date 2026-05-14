import { Platform } from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export type ServiceItem = {
  id: number;
  service_name: string;
  description?: string | null;
  icon?: string | null;
  base_price?: number | null;
  created_at?: string | null;
};

export async function listServices(q?: string): Promise<ServiceItem[]> {
  try {
    const url = q ? `${BASE_URL}/services/?q=${encodeURIComponent(q)}` : `${BASE_URL}/services/`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function getService(id: number): Promise<ServiceItem | null> {
  try {
    const res = await fetch(`${BASE_URL}/services/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
