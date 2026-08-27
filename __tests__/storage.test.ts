/**
 * Regression test for the native login bug: expo-secure-store rejects keys
 * containing anything outside /^[\w.-]+$/, and the auth key 'workmithra:auth'
 * used to be passed through verbatim. On the APK every SecureStore read/write
 * threw, so login succeeded on the server but the token was never persisted
 * and the auth guard bounced users straight back to /login.
 *
 * The mocks below enforce the SAME key validation the native module performs,
 * so if a colon (or any other invalid character) ever reaches SecureStore
 * again, this suite fails instead of silently breaking native login.
 */

jest.mock('expo-secure-store', () => {
  const VALID_KEY = /^[\w.-]+$/;
  const store: Record<string, string> = {};
  const assertKey = (key: string) => {
    if (typeof key !== 'string' || key.length === 0 || !VALID_KEY.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
  };
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => {
      assertKey(key);
      return store[key] ?? null;
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      assertKey(key);
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      assertKey(key);
      delete store[key];
    }),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    __store: store,
    default: {
      __store: store,
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      multiRemove: jest.fn(async (keys: string[]) => {
        keys.forEach((k) => delete store[k]);
      }),
    },
  };
});

/* eslint-disable import/first -- jest.mock factories are hoisted above imports;
   keeping them visually first documents what each mock enforces. */
import { clearAllWorkMitraStorage, storage } from '@/lib/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const secureStore = (SecureStore as any).__store as Record<string, string>;
const asyncStore = (AsyncStorage as any).__store as Record<string, string>;

describe('storage — native SecureStore path', () => {
  beforeEach(() => {
    Object.keys(secureStore).forEach((k) => delete secureStore[k]);
    Object.keys(asyncStore).forEach((k) => delete asyncStore[k]);
  });

  it('persists and reads the auth key even though its public name contains ":"', async () => {
    await storage.set('workmithra:auth', JSON.stringify({ id: 1, token: 'jwt' }));
    const raw = await storage.get('workmithra:auth');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ id: 1, token: 'jwt' });
  });

  it('never passes an invalid key to SecureStore', async () => {
    await storage.set('workmithra:auth', 'x');
    const usedKeys = Object.keys(secureStore);
    expect(usedKeys.length).toBe(1);
    expect(usedKeys[0]).toMatch(/^[\w.-]+$/);
    expect(usedKeys[0]).not.toContain(':');
  });

  it('removes the auth key', async () => {
    await storage.set('workmithra:auth', 'x');
    await storage.remove('workmithra:auth');
    expect(await storage.get('workmithra:auth')).toBeNull();
  });

  it('routes non-secure keys to AsyncStorage, not SecureStore', async () => {
    await storage.set('workmithra:settings', 'on');
    expect(asyncStore['workmithra:settings']).toBe('on');
    expect(Object.keys(secureStore)).toHaveLength(0);
    expect(await storage.get('workmithra:settings')).toBe('on');
  });

  it('clearAllWorkMitraStorage wipes the auth token and every cache', async () => {
    await storage.set('workmithra:auth', 'x');
    await storage.set('workmithra:cache:home', 'y');
    await clearAllWorkMitraStorage();
    expect(await storage.get('workmithra:auth')).toBeNull();
    expect(await storage.get('workmithra:cache:home')).toBeNull();
  });
});
