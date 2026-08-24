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
 * On web, localStorage is used (SecureStore/AsyncStorage are native-only).
 */

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.localStorage;

// Keys that hold a JWT / credentials. Routed to SecureStore on native.
const SECURE_KEYS = new Set(['workmithra:auth']);

export const storage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) {
      return window.localStorage.getItem(key);
    }
    try {
      if (SECURE_KEYS.has(key)) {
        return await SecureStore.getItemAsync(key);
      }
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    if (isWeb) {
      window.localStorage.setItem(key, value);
      return;
    }
    if (SECURE_KEYS.has(key)) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    if (isWeb) {
      window.localStorage.removeItem(key);
      return;
    }
    try {
      if (SECURE_KEYS.has(key)) {
        await SecureStore.deleteItemAsync(key);
        return;
      }
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore — removing a missing key is a no-op
    }
  },
};
