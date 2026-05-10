import { StyleSheet, View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

// Design frame constants requested by user
const DESIGN_WIDTH = 360; // pts
const DESIGN_HEIGHT = 803; // pts

export function ThemedView({ style, lightColor, darkColor, children, ...otherProps }: ThemedViewProps) {
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return (
    <View style={[styles.appBackground, { backgroundColor }]}> 
      <View style={[styles.frame, style]} {...otherProps}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appBackground: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // fixed design frame matching 360x803 pts
  frame: {
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    alignSelf: 'center',
  },
});
