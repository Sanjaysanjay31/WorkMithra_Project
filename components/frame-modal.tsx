import React from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';

interface FrameModalProps {
  visible: boolean;
  onRequestClose?: () => void;
  animationType?: 'none' | 'slide' | 'fade';
  children: React.ReactNode;
}

/**
 * Modal that stays inside the phone frame on web.
 *
 * RN's Modal renders into a portal on document.body on web, which escapes the
 * device frame in app/_layout.tsx and fills the whole browser window on
 * laptops. On web we render an absolutely-positioned overlay inside the frame
 * instead; native keeps the real Modal (status-bar coverage + Android back
 * dismissal via onRequestClose).
 *
 * Children should provide their own backdrop (flex: 1, semi-transparent) — it
 * fills the frame either way.
 */
export default function FrameModal({
  visible,
  onRequestClose,
  animationType = 'fade',
  children,
}: FrameModalProps) {
  if (Platform.OS === 'web') {
    if (!visible) return null;
    return <View style={styles.webHost}>{children}</View>;
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  webHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
  },
});
