import { Platform } from 'react-native';

/**
 * Returns the appropriate shadow style for the current platform.
 *
 * React-native-web >= 0.18 deprecated the `shadow*` style props and now
 * requires CSS `boxShadow`. Native (iOS / Android) still uses the old props.
 *
 * Usage (inside StyleSheet.create):
 *   card: {
 *     backgroundColor: '#fff',
 *     ...platformShadow('0px 2px 8px rgba(0,0,0,0.12)', '#000', 0, 2, 0.12, 4, 3),
 *   }
 */
export function platformShadow(
  /** CSS box-shadow string used on web. */
  cssBoxShadow: string,
  /** Native shadowColor hex string. */
  shadowColor: string,
  /** Native shadowOffset x (width). */
  offsetX: number,
  /** Native shadowOffset y (height). */
  offsetY: number,
  /** Native shadowOpacity. */
  shadowOpacity: number,
  /** Native shadowRadius. */
  shadowRadius: number,
  /** Android elevation. */
  elevation: number = 4,
): any {
  if (Platform.OS === 'web') {
    return { boxShadow: cssBoxShadow };
  }
  return {
    shadowColor,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowOpacity,
    shadowRadius,
    elevation,
  };
}

/**
 * Use this for "disabled" button states that must remove the shadow on web.
 * On native it zeroes shadowOpacity; on web it clears boxShadow.
 */
export const platformNoShadow: any =
  Platform.OS === 'web' ? { boxShadow: 'none' } : { shadowOpacity: 0 };
