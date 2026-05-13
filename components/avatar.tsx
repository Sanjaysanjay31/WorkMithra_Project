import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';

const PALETTE = ['#6F42C1', '#10b981', '#FF6B6B', '#0284c7', '#FF9800', '#0ea5e9', '#e11d48', '#7c3aed'];

function initials(name?: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function colorFor(name?: string): string {
  const s = name || '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({
  uri,
  name,
  size = 48,
  style,
  textColor = '#fff',
}: {
  uri?: string | null;
  name?: string;
  size?: number;
  style?: ViewStyle;
  textColor?: string;
}) {
  const radius = size / 2;
  const fontSize = Math.max(10, Math.round(size * 0.42));

  if (uri && uri.trim()) {
    return (
      <Image
        source={{ uri }}
        style={[{ width: size, height: size, borderRadius: radius, backgroundColor: '#e9ecef' }, style as any]}
      />
    );
  }

  return (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius: radius, backgroundColor: colorFor(name) },
        style,
      ]}
    >
      <Text style={{ color: textColor, fontWeight: '800', fontSize }}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { justifyContent: 'center', alignItems: 'center' },
});
