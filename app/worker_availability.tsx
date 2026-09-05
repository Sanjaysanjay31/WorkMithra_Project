import BottomNav from '@/components/bottom-nav';
import { getAuth } from '@/lib/api';
import { AvailabilitySlot, listAvailability, upsertAvailability } from '@/lib/availability';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// Canonical day keys — must match the backend's accepted values
// (backend/routers/availability.py normalizes to these full names).
const DAYS: { key: string; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

type DayState = {
  slot_id: number | null;
  is_available: boolean;
  start_time: string; // "HH:MM"
  end_time: string;
};

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function formatTimeLabel(value: string): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr); const m = Number(mStr);
  const hr12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hr12}:${pad(m)} ${ampm}`;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dateFromTime(t: string): Date {
  const [h, m] = t.split(':').map(Number);
  const dt = new Date();
  dt.setHours(h || 9, m || 0, 0, 0);
  return dt;
}

function emptyWeek(): Record<string, DayState> {
  return Object.fromEntries(
    DAYS.map((d) => [d.key, { slot_id: null, is_available: false, start_time: DEFAULT_START, end_time: DEFAULT_END }]),
  );
}

/** Fold server slots onto the 7-day grid (one slot per day by design). */
function mergeSlots(base: Record<string, DayState>, slots: AvailabilitySlot[]): Record<string, DayState> {
  const next = { ...base };
  slots.forEach((s) => {
    const key = (s.available_day || '').toLowerCase();
    if (!next[key]) return;
    next[key] = {
      slot_id: s.id,
      is_available: s.is_available,
      start_time: s.start_time || DEFAULT_START,
      end_time: s.end_time || DEFAULT_END,
    };
  });
  return next;
}

export default function WorkerAvailabilityPage() {
  const [workerId, setWorkerId] = useState(0);
  const [days, setDays] = useState<Record<string, DayState>>(emptyWeek);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ day: string; field: 'start_time' | 'end_time' } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError('');
      let wid = 0;
      try {
        const auth = await getAuth();
        if (auth?.id) wid = Number(auth.id);
      } catch {}
      if (!wid) {
        // Not logged in — never fall back to a guessed worker id.
        setLoading(false);
        return;
      }
      setWorkerId(wid);
      try {
        const slots = await listAvailability(wid);
        setDays((prev) => mergeSlots(emptyWeek(), slots));
      } catch (e: any) {
        // A failed load must not look like "all days switched off".
        console.warn('Failed to load availability', e);
        setLoadError(e?.message || 'Could not reach the server. Please try again.');
      }
      setLoading(false);
    })();
  }, [reloadTick]);

  /** Upsert one day. Optimistic update; on failure revert from the server. */
  async function saveDay(dayKey: string, patch: Partial<DayState>) {
    if (!workerId) return;
    const merged = { ...days[dayKey], ...patch };
    setDays((d) => ({ ...d, [dayKey]: merged }));
    setBusyDay(dayKey);
    const saved = await upsertAvailability({
      worker_id: workerId,
      available_day: dayKey,
      start_time: merged.start_time,
      end_time: merged.end_time,
      is_available: merged.is_available,
    });
    setBusyDay(null);
    if (saved) {
      setDays((d) => ({ ...d, [dayKey]: { ...merged, slot_id: saved.id } }));
    } else {
      Alert.alert('Not saved', 'Could not update your availability. Please try again.');
      try {
        const slots = await listAvailability(workerId);
        setDays(() => mergeSlots(emptyWeek(), slots));
      } catch {
        // Re-fetch failed too — keep the optimistic value rather than
        // blanking the week; the next save attempt will re-sync.
      }
    }
  }

  function onTimeChange(dayKey: string, field: 'start_time' | 'end_time', value: string) {
    if (!value) return;
    const cur = days[dayKey];
    const next = { ...cur, [field]: value, is_available: true };
    // The backend rejects start >= end with a 400 — catch it locally first.
    if (toMinutes(next.start_time) >= toMinutes(next.end_time)) {
      Alert.alert('Invalid time window', 'Start time must be before end time.');
      return;
    }
    void saveDay(dayKey, next);
  }

  const availableCount = DAYS.filter((d) => days[d.key]?.is_available).length;

  const renderDay = (d: { key: string; label: string }) => {
    const st = days[d.key];
    const busy = busyDay === d.key;
    return (
      <View key={d.key} style={[styles.dayCard, !st.is_available && styles.dayCardOff]}>
        <View style={styles.dayHead}>
          <Text style={[styles.dayName, !st.is_available && styles.dayNameOff]}>{d.label}</Text>
          <View style={styles.dayHeadRight}>
            {busy && <ActivityIndicator size="small" color="#6F42C1" />}
            <Switch
              value={st.is_available}
              onValueChange={(v) => void saveDay(d.key, { is_available: v })}
              disabled={busy}
              trackColor={{ false: '#e5e7eb', true: '#d4c3f2' }}
              thumbColor={st.is_available ? '#6F42C1' : '#f4f4f5'}
            />
          </View>
        </View>

        {st.is_available ? (
          Platform.OS === 'web' ? (
            <View style={styles.timeRow}>
              <View style={styles.webTimeWrap}>
                <Ionicons name="time-outline" size={14} color="#6F42C1" />
                {React.createElement('input', {
                  type: 'time',
                  value: st.start_time,
                  onChange: (e: { target: { value: string } }) => onTimeChange(d.key, 'start_time', e.target.value),
                  style: { flex: 1, padding: 6, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                })}
              </View>
              <Text style={styles.timeSep}>to</Text>
              <View style={styles.webTimeWrap}>
                <Ionicons name="time-outline" size={14} color="#6F42C1" />
                {React.createElement('input', {
                  type: 'time',
                  value: st.end_time,
                  onChange: (e: { target: { value: string } }) => onTimeChange(d.key, 'end_time', e.target.value),
                  style: { flex: 1, padding: 6, fontSize: 13, border: 'none', outline: 'none', background: 'transparent', color: '#333' },
                })}
              </View>
            </View>
          ) : (
            <View style={styles.timeRow}>
              <TouchableOpacity
                style={styles.timeChip}
                activeOpacity={0.7}
                disabled={busy}
                onPress={() => setPicker({ day: d.key, field: 'start_time' })}
              >
                <Ionicons name="time-outline" size={13} color="#6F42C1" />
                <Text style={styles.timeChipText}>{formatTimeLabel(st.start_time)}</Text>
              </TouchableOpacity>
              <Text style={styles.timeSep}>to</Text>
              <TouchableOpacity
                style={styles.timeChip}
                activeOpacity={0.7}
                disabled={busy}
                onPress={() => setPicker({ day: d.key, field: 'end_time' })}
              >
                <Ionicons name="time-outline" size={13} color="#6F42C1" />
                <Text style={styles.timeChipText}>{formatTimeLabel(st.end_time)}</Text>
              </TouchableOpacity>
            </View>
          )
        ) : (
          <Text style={styles.offText}>Not available — new bookings are blocked</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.frame}>
        <Text style={styles.title}>Working Hours</Text>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={16} color="#6F42C1" />
          <Text style={styles.infoText}>
            Clients can only book you during these hours. Days you switch off block new requests.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color="#6F42C1" style={{ marginTop: 30 }} />
        ) : loadError ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={28} color="#b91c1c" />
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => setReloadTick((t) => t + 1)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.summary}>
              Available {availableCount} of 7 days
            </Text>
            <ScrollView
              contentContainerStyle={{ paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={loading} onRefresh={() => setReloadTick((t) => t + 1)} tintColor="#6F42C1" />
              }
            >
              {DAYS.map(renderDay)}
            </ScrollView>
          </>
        )}
      </View>

      {Platform.OS !== 'web' && picker && (
        <DateTimePicker
          value={dateFromTime(days[picker.day][picker.field])}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          is24Hour={false}
          onChange={(event, selected) => {
            const p = picker;
            setPicker(null);
            if (event.type === 'set' && selected && p) {
              onTimeChange(p.day, p.field, `${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
            }
          }}
        />
      )}

      <BottomNav currentRoute="profile_worker" role="worker" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  frame: { flex: 1, width: '100%', backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 12, textAlign: 'center' },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#f5f0fb',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e6dbf5',
  },
  infoText: { flex: 1, fontSize: 12, color: '#4c1d95', lineHeight: 17 },
  summary: { fontSize: 12, fontWeight: '700', color: '#6F42C1', marginBottom: 10 },

  errorBox: { alignItems: 'center', paddingVertical: 40 },
  errorText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: '#b91c1c', textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: '#6F42C1' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  dayCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    ...platformShadow('0px 1px 4px rgba(0,0,0,0.06)', '#000', 0, 1, 0.06, 2, 1),
  },
  dayCardOff: { backgroundColor: '#fafafa' },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayName: { fontSize: 14, fontWeight: '800', color: '#222' },
  dayNameOff: { color: '#999' },
  offText: { fontSize: 11, color: '#999', marginTop: 6 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5f0fb',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#e6dbf5',
  },
  timeChipText: { fontSize: 12, fontWeight: '700', color: '#4c1d95' },
  timeSep: { fontSize: 12, color: '#888' },
  webTimeWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5f0fb',
    borderRadius: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e6dbf5',
  },
});
