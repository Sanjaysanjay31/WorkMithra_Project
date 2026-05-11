import { AIAssistant } from '@/components/ai-assistant';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

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

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

const FRAME_WIDTH = 360;
const FRAME_HEIGHT = 803;

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const stack = (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="switch_role" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="worker_dashboard" options={{ headerShown: false }} />
      <Stack.Screen name="worker_bookings" options={{ headerShown: false }} />
      <Stack.Screen name="worker_profile" options={{ headerShown: false }} />
      <Stack.Screen name="chat" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {Platform.OS === 'web' ? (
        <View style={styles.webBackdrop}>
          <View style={styles.webFrame}>
            {stack}
            <AIAssistant />
          </View>
        </View>
      ) : (
        <View style={styles.nativeFrame}>
          {stack}
          <AIAssistant />
        </View>
      )}
      <StatusBar style="auto" />
    </ThemeProvider>
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
