import React from 'react';
import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DEMO_BANNER } from '../fixture/FixtureRepository';
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FAF9F5' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', color: '#203B36' },
  heading: { fontSize: 20, fontWeight: '600', color: '#203B36' },
  text: { fontSize: 17, lineHeight: 26, color: '#30443F' },
  muted: { fontSize: 15, color: '#52645E', lineHeight: 23 },
  card: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 14, gap: 12, borderWidth: 1, borderColor: '#D9E2DC' },
  button: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: '#245E50', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  disabled: { backgroundColor: '#667B74' },
  banner: { padding: 12, backgroundColor: '#E9EFE6' },
});
export function FixtureBanner() {
  return <View style={styles.banner}><Text style={styles.muted}>{DEMO_BANNER}</Text></View>;
}
export function Action({ label, onPress, disabled = false, busy = false }: {label: string; onPress: () => void; disabled?: boolean; busy?: boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy}
    onPress={onPress} style={({ pressed }) => [styles.button, (disabled || busy) && styles.disabled, pressed && { opacity: 0.8 }]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export function Page({ children }: PropsWithChildren) {
  return <View style={styles.page}><FixtureBanner /><ScrollView keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>{children}</ScrollView></View>;
}
export function Heading({ children }: PropsWithChildren) { return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>; }
export function Status({ children }: PropsWithChildren) { return <Text accessibilityLiveRegion="polite" style={styles.text}>{children}</Text>; }
