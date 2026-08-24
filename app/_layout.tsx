import '@/lib/alert'; // Patch RN Alert.alert for web — must load before any screen.
import { AIAssistant } from '@/components/ai-assistant';
import { getAuth, setOnUnauthorized } from '@/lib/api';
import { ensureSocket } from '@/lib/socket';
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
  anchor: '(tabs)',
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

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const router = useRouter();

  // Realtime channel: connect + authenticate once a session exists. No-op when
  // logged out; screens receive booking/chat events without polling.
  useEffect(() => {
    ensureSocket();
  }, []);

  // Stale-session recovery: if any authenticated request is rejected with 401,
  // lib/api clears the stored session and invokes this callback to return the
  // user to the login screen instead of leaving them in a broken state.
  useEffect(() => {
    setOnUnauthorized(() => {
      router.replace('/login');
    });
    return () => setOnUnauthorized(null);
  }, [router]);

  // Auth guard + session restore. Runs on every navigation:
  //  - protected route with no session  -> redirect to /login
  //  - landing page with a valid session -> jump straight to the right home
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
      if ((pathname === '/' || pathname === '') && auth?.token) {
        router.replace(auth.role === 'worker' ? '/worker_dashboard' : '/homePage');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const stack = (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
