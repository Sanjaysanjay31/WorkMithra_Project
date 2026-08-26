import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { authFetch, getAuth } from '@/lib/api';

/**
 * System push notifications via expo-notifications + the Expo push service.
 *
 * Flow: after login we request the OS permission, fetch the Expo push token
 * for this device, and register it with the backend (POST
 * /notifications/push-token). The backend then pushes every notification it
 * creates through the Expo push API, so alerts arrive even when the app is
 * closed or in the background. The in-app inbox + socket badge remain the
 * realtime path while the app is open.
 *
 * Before this module existed the app had no push integration at all —
 * Android showed "notifications off" for the app with no way to turn them
 * on, because nothing ever requested the permission or posted an alert.
 */

let registeredToken: string | null = null;
let setupInFlight: Promise<void> | null = null;
// Permanent skip conditions (permission denied, device without push support).
// Registration failures do NOT set this — those retry on the next call.
let setupBlocked = false;

// Show the alert banner even when the app is foregrounded (user is on a
// different screen than the inbox).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Idempotent push setup: permission -> token -> backend registration.
 * Safe to call from multiple places at once (single in-flight run), and a
 * failed registration retries on the next call instead of being stuck until
 * app restart. No-ops on web and on devices without push support.
 */
export function ensurePushSetup(): Promise<void> {
  if (Platform.OS === 'web' || setupBlocked || registeredToken) return Promise.resolve();
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
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener(callback);
  return () => sub.remove();
}
