// Jest setup: mock native modules that have no JS-only implementation.

// react-native-safe-area-context — screens call useSafeAreaInsets() directly.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => React.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
    initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 320, height: 640 } },
  };
});

// expo-status-bar — used by the root layout.
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// react-native-webview — map embeds render a WebView.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: (props) => React.createElement(View, { testID: 'webview', ...props }) };
});

// expo-av (TTS/recording) — screens import it transitively via lib/ai.ts.
jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: {
      createAsync: jest.fn().mockResolvedValue({
        sound: {
          playAsync: jest.fn().mockResolvedValue(undefined),
          pauseAsync: jest.fn().mockResolvedValue(undefined),
          stopAsync: jest.fn().mockResolvedValue(undefined),
          unloadAsync: jest.fn().mockResolvedValue(undefined),
          setOnPlaybackStatusUpdate: jest.fn(),
        },
        status: { isLoaded: true },
      }),
    },
    Recording: jest.fn().mockImplementation(() => ({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      startAsync: jest.fn().mockResolvedValue(undefined),
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue('file:///tmp/test.m4a'),
    })),
    AndroidOutputFormat: { M4A: 'm4a' },
    AndroidEncoder: { AAC: 'aac' },
    AndroidAudioSource: { MIC: 'mic' },
    IOSOutputFormat: { MPEG4AAC: 'aac' },
    IOSAudioQuality: { HIGH: 'high' },
    InterruptionModeIOS: { DoNotMix: 1 },
    InterruptionModeAndroid: { DoNotMix: 1 },
  },
}));

// Socket.IO — screens call ensureSocket() on mount; keep tests offline.
jest.mock('@/lib/socket', () => ({
  ensureSocket: jest.fn().mockResolvedValue(null),
  initializeSocket: jest.fn().mockReturnValue(null),
  getSocket: jest.fn().mockReturnValue(null),
  disconnectSocket: jest.fn(),
  isConnected: jest.fn().mockReturnValue(false),
  getSocketId: jest.fn().mockReturnValue(null),
  joinRoom: jest.fn(),
  leaveRoom: jest.fn(),
  onMessageReceived: jest.fn().mockReturnValue(() => {}),
  onBookingRequest: jest.fn().mockReturnValue(() => {}),
  onBookingStatusChanged: jest.fn().mockReturnValue(() => {}),
  onPaymentReceived: jest.fn().mockReturnValue(() => {}),
  onNotificationCreated: jest.fn().mockReturnValue(() => {}),
  onTypingIndicator: jest.fn().mockReturnValue(() => {}),
  onUserStatusChanged: jest.fn().mockReturnValue(() => {}),
  onOnlineUsers: jest.fn().mockReturnValue(() => {}),
  onUserStatusResponse: jest.fn().mockReturnValue(() => {}),
  onUserJoinedRoom: jest.fn().mockReturnValue(() => {}),
  onUserLeftRoom: jest.fn().mockReturnValue(() => {}),
  onPong: jest.fn().mockReturnValue(() => {}),
  onStats: jest.fn().mockReturnValue(() => {}),
  setUserStatus: jest.fn(),
  setTypingIndicator: jest.fn(),
}));

// expo-notifications — lib/push.ts is imported from the root layout; push is
// a native-only concern, so tests get a silent granted-permission stub.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExpoPushToken[test]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Global fetch — screens fire authFetch/fetch on mount. Return a benign empty
// JSON response by default so tests never hit the network; individual tests can
// override via global.fetch.mockResolvedValueOnce(...).
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve({}),
  }),
);
