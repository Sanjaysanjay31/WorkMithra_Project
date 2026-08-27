import '@/lib/alert'; // Patch RN Alert.alert for web — must load before any screen.
import { AIAssistant } from '@/components/ai-assistant';
import { getAuth, setOnUnauthorized } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { ensurePushSetup, onNotificationTap } from '@/lib/push';
import { disconnectSocket, ensureSocket } from '@/lib/socket';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/use-color-scheme';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'wm-hide-native-password-reveal';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      input::-ms-reveal, input::-ms-clear { display: none !important; }
      input::-webkit-credentials-auto-fill-button,
      input::-webkit-strong-password-auto-fill-button { display: none !important; visibility: hidden !important; pointer-events: none !important; }
    `;
    document.head.appendChild(style);
  }
}

export const unstable_settings = {
  anchor: 'index',
};

const FRAME_WIDTH = 390;
const FRAME_HEIGHT = 803;

// Routes reachable without a session. Everything else requires login.
const PUBLIC_ROUTES = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
]);

// Role-restricted routes. Users and workers are separate account types — a
// logged-in user must not be able to open worker-only screens (and vice
// versa), which would otherwise fire requests that 403/401 and show broken UI.
//
// Deliberately NOT restricted (shared cross-role screens):
//   /worker_info  — the client-facing worker detail/booking page; users reach
//                   it from homePage/bookings to hire a worker.
//   /user_profile — the client profile page; workers reach it from
//                   worker_bookings to inspect who sent a request.
const WORKER_ROUTES = new Set([
  '/worker_dashboard',
  '/worker_bookings',
  '/worker_availability',
  '/worker_profile',
]);
const USER_ROUTES = new Set([
  '/homePage',
  '/bookings',
  // /profile is the CLIENT profile screen (its backend PUT is user-role-only,
  // and User/Worker ids overlap, so a worker opening it would load/save the
  // wrong person's data). Workers use /worker_profile instead.
  '/profile',
]);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const router = useRouter();

  // Realtime channel: connect + authenticate once a session exists. No-op when
  // logged out; screens receive booking/chat events without polling.
  useEffect(() => {
    ensureSocket();
    // Restore the persisted UI language before first paint of child screens.
    void initI18n();
  }, []);

  // Tapping a system push opens the in-app inbox.
  useEffect(() => onNotificationTap(() => router.push('/notifications')), [router]);

  // Stale-session recovery: if any authenticated request is rejected with 401,
  // lib/api clears the stored session and invokes this callback to return the
  // user to the login screen instead of leaving them in a broken state. The
  // realtime socket is torn down too so it stops authenticating with the dead
  // token; ensureSocket() rebuilds it after the next login.
  useEffect(() => {
    setOnUnauthorized(() => {
      disconnectSocket();
      router.replace('/login');
    });
    return () => setOnUnauthorized(null);
  }, [router]);

  // Auth guard + session restore. Runs on every navigation:
  //  - protected route with no session        -> redirect to /login
  //  - role-mismatched route for the session  -> redirect to that role's home
  //  - landing page with a valid session      -> jump straight to the right home
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getAuth();
      if (cancelled) return;
      const isPublic = PUBLIC_ROUTES.has(pathname);
      if (!isPublic && !auth?.token) {
        router.replace('/login');
        return;
      }
      if (auth?.token) {
        // System push: request permission + register the device token once a
        // session exists (idempotent — safe on every navigation).
        void ensurePushSetup();
        const home = auth.role === 'worker' ? '/worker_dashboard' : '/homePage';
        if ((pathname === '/' || pathname === '') ) {
          router.replace(home);
          return;
        }
        // Role guard: keep each account type on its own screens.
        const onWorkerRoute = WORKER_ROUTES.has(pathname);
        const onUserRoute = USER_ROUTES.has(pathname);
        if (auth.role === 'worker' && onUserRoute) {
          router.replace('/worker_dashboard');
          return;
        }
        if (auth.role !== 'worker' && onWorkerRoute) {
          router.replace('/homePage');
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const stack = (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="worker_dashboard" options={{ headerShown: false }} />
      <Stack.Screen name="worker_bookings" options={{ headerShown: false }} />
      <Stack.Screen name="worker_profile" options={{ headerShown: false }} />
      <Stack.Screen name="user_profile" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="chat" options={{ headerShown: false }} />
    </Stack>
  );

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {Platform.OS === 'web' ? (
          <View style={styles.webBackdrop}>
            <View style={styles.webFrame}>
              {stack}
              <AIAssistant />
            </View>
          </View>
        ) : (
          <SafeAreaView style={styles.nativeFrame} edges={['top', 'bottom']}>
            {stack}
            <AIAssistant />
          </SafeAreaView>
        )}
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  webBackdrop: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#e9ecef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webFrame: {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    maxWidth: '100%',
    maxHeight: '100%',
    backgroundColor: '#fff',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  } as any,
  nativeFrame: {
    flex: 1,
    width: '100%',
    backgroundColor: '#fff',
  },
});
