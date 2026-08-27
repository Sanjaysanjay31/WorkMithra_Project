import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent key/value storage.
 *
 * On native (iOS/Android) this used to be a plain in-memory object, so the
 * auth token and every cache vanished on each app restart — users were logged
 * out every launch. Now:
 *   - credential-bearing keys go to the OS keychain/keystore (expo-secure-store)
 *   - everything else goes to AsyncStorage (persists across restarts)
 * On web:
 *   - credential-bearing keys go to sessionStorage (per-tab, cleared when the
 *     tab closes, not readable by other tabs/extensions like localStorage)
 *   - everything else goes to localStorage (caches may persist)
 */

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
const hasLocalStorage = isWeb && !!window.localStorage;
const hasSessionStorage = isWeb && !!window.sessionStorage;

// Keys that hold a JWT / credentials. Routed to SecureStore on native and
// sessionStorage on web.
const SECURE_KEYS = new Set(['workmithra:auth']);

// SecureStore rejects keys containing anything outside /^[\w.-]+$/ — the
// colon in 'workmithra:auth' made every native read/write throw, so login
// "succeeded" but the token was never persisted and the auth guard bounced
// users straight back to /login. Map namespaced keys to a SecureStore-safe
// form; web storage accepts any key, so it keeps the original name.
function secureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function webGet(key: string): string | null {
  try {
    if (SECURE_KEYS.has(key)) {
      return hasSessionStorage ? window.sessionStorage.getItem(key) : null;
    }
    return hasLocalStorage ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  try {
    if (SECURE_KEYS.has(key)) {
      if (hasSessionStorage) window.sessionStorage.setItem(key, value);
      return;
    }
    if (hasLocalStorage) window.localStorage.setItem(key, value);
  } catch {
    // storage full / blocked — nothing sensible to do here
  }
}

function webRemove(key: string): void {
  try {
    if (SECURE_KEYS.has(key)) {
      if (hasSessionStorage) window.sessionStorage.removeItem(key);
      // Also clear any legacy copy left in localStorage by older builds.
      if (hasLocalStorage) window.localStorage.removeItem(key);
      return;
    }
    if (hasLocalStorage) window.localStorage.removeItem(key);
  } catch {
    // ignore — removing a missing key is a no-op
  }
}

export const storage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) {
      return webGet(key);
    }
    try {
      if (SECURE_KEYS.has(key)) {
        return await SecureStore.getItemAsync(secureKey(key));
      }
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    if (isWeb) {
      webSet(key, value);
      return;
    }
    if (SECURE_KEYS.has(key)) {
      await SecureStore.setItemAsync(secureKey(key), value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    if (isWeb) {
      webRemove(key);
      return;
    }
    try {
      if (SECURE_KEYS.has(key)) {
        await SecureStore.deleteItemAsync(secureKey(key));
        return;
      }
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore — removing a missing key is a no-op
    }
  },
};

/**
 * Remove every cached `workmithra:*` key (auth + all screen caches). Used on
 * logout and when the server rejects the session, so no stale data from the
 * previous account leaks into the next login.
 */
export async function clearAllWorkMitraStorage(): Promise<void> {
  if (isWeb) {
    const stores: Storage[] = [];
    if (hasLocalStorage) stores.push(window.localStorage);
    if (hasSessionStorage) stores.push(window.sessionStorage);
    for (const store of stores) {
      try {
        const doomed: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith('workmithra:')) doomed.push(k);
        }
        doomed.forEach((k) => store.removeItem(k));
      } catch {
        // ignore
      }
    }
    return;
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter((k) => k.startsWith('workmithra:'));
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch {
    // ignore
  }
  try {
    await SecureStore.deleteItemAsync(secureKey('workmithra:auth'));
  } catch {
    // ignore — SecureStore key may not exist
  }
}
