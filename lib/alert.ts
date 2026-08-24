/**
 * React Native's `Alert.alert` is a no-op on web, so every info/confirm dialog
 * silently disappears for browser users. This module patches `Alert.alert` with
 * the browser's native dialogs. Import it once from the root layout so it runs
 * before any screen can call Alert.alert.
 *
 * Mapping:
 *  - no buttons            -> window.alert (info)
 *  - one button            -> window.alert, then its onPress
 *  - cancel + action(s)    -> window.confirm; OK runs the non-cancel button,
 *                             dismissing runs the cancel button's onPress
 */
import { Alert, Platform } from 'react-native';

type AlertBtn = { text?: string; style?: string; onPress?: () => void };

if (Platform.OS === 'web') {
  const win = globalThis as unknown as {
    alert?: (msg: string) => void;
    confirm?: (msg: string) => boolean;
  };

  (Alert as unknown as { alert: (t: string, m?: string, b?: AlertBtn[]) => void }).alert = (
    title: string,
    message?: string,
    buttons?: AlertBtn[],
  ) => {
    const text = [title, message].filter(Boolean).join('\n');

    if (!buttons || buttons.length === 0) {
      win.alert?.(text);
      return;
    }
    if (buttons.length === 1) {
      win.alert?.(text);
      buttons[0].onPress?.();
      return;
    }

    const confirmed = win.confirm ? win.confirm(text) : true;
    if (confirmed) {
      const action = buttons.find((b) => b.style !== 'cancel') ?? buttons[buttons.length - 1];
      action.onPress?.();
    } else {
      buttons.find((b) => b.style === 'cancel')?.onPress?.();
    }
  };
}

export {};
