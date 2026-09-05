import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { authFetch, getAuth } from '@/lib/api';

/**
 * expo-notifications / Expo Go: remote (push) notifications were removed from
 * Expo Go in SDK 53 — they require a development build. A static
 * `import * as Notifications from 'expo-notifications'` resolves the JS module
 * fine (just a console.warn), but every subsequent native call
 * (setNotificationHandler, getPermissionsAsync, …) throws a hard unrecoverable
 * error. So we only require + run those calls in a development build
 * (appOwnership !== 'expo') and otherwise no-op silently. Push features simply
 * no-op in Expo Go until you switch to a development build.
 */
const isExpoGo = Constants.appOwnership === 'expo';
let Notifications: any = null;

// Only load the module when we know the native bridge exists. In Expo Go the
// require itself succeeds but every native call throws, and calling
// setNotificationHandler at load time (outside the try below) used to crash
// the entire route loader. Guard both the require AND every native call.
if (!isExpoGo && Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
  } catch {
    // expo-notifications unavailable — push features disabled in this runtime.
  }
}

/** True when push notifications can be used (development build, not Expo Go). */
export function hasPush(): boolean {
  return !!Notifications;
}

let registeredToken: string | null = null;
let setupInFlight: Promise<void> | null = null;
// Permanent skip conditions (permission denied, device without push support).
// Registration failures do NOT set this — those retry on the next call.
let setupBlocked = false;

// Show the alert banner even when the app is foregrounded (user is on a
// different screen than the inbox). Wrap in try/catch because the native
// bridge call can throw even after a successful require in Expo Go.
if (Notifications) {
  try {
    if (typeof Notifications.setNotificationHandler === 'function') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    }
    if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance?.MAX ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6F42C1',
      }).catch(() => {});
    }
  } catch {
    // setNotificationHandler or channel creation not supported in this runtime — skip.
  }
}

/**
 * Idempotent push setup: permission -> token -> backend registration.
 * Safe to call from multiple places at once (single in-flight run), and a
 * failed registration retries on the next call instead of being stuck until
 * app restart. No-ops on web and on devices without push support.
 */
export function ensurePushSetup(): Promise<void> {
  if (!Notifications || Platform.OS === 'web' || setupBlocked || registeredToken) return Promise.resolve();
  if (!setupInFlight) {
    setupInFlight = runSetup().finally(() => {
      setupInFlight = null;
    });
  }
  return setupInFlight;
}

async function runSetup(): Promise<void> {
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const request = await Notifications.requestPermissionsAsync();
      status = request.status;
    }
    if (status !== 'granted') {
      // Denied in system settings — nothing we can do from here; the in-app
      // inbox still works.
      setupBlocked = true;
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse?.data;
    if (!token) {
      setupBlocked = true;
      return;
    }
    if (token === registeredToken) return;

    const auth = await getAuth();
    if (!auth?.token) return; // not logged in yet — a later call retries

    // The backend derives the role from the JWT — the client never sends it.
    const res = await authFetch('/notifications/push-token', {
      method: 'POST',
      json: { token },
    });
    if (res.ok) registeredToken = token;
    // On failure registeredToken stays null, so the next ensurePushSetup()
    // (e.g. the next navigation) retries the registration.
  } catch (error) {
    // Emulators and devices without push services throw here — push is an
    // enhancement, never a hard requirement for using the app.
    setupBlocked = true;
    console.warn('[workmithra] push setup skipped:', error);
  }
}

/** Drop the caller's token on logout/role switch so this device stops
 * receiving the old account's alerts. Best-effort. */
export async function unregisterPush(): Promise<void> {
  try {
    await authFetch('/notifications/push-token', { method: 'DELETE' });
  } catch {}
  registeredToken = null;
  setupBlocked = false;
}

/** Subscribe to notification taps (user tapped a system alert) — screens use
 * this to deep-link into the in-app inbox. Returns an unsubscribe fn. */
export function onNotificationTap(callback: () => void): () => void {
  if (Platform.OS === 'web' || !Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener(callback);
  return () => sub.remove();
}
