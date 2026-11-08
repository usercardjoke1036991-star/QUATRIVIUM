import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

const LOGO = require('../assets/logo.png');

let depth = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function useBusy(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    depth += 1;
    emit();
    return () => {
      depth = Math.max(0, depth - 1);
      emit();
    };
  }, [active]);
}

export const BusyMark: React.FC = () => {
  const [on, setOn] = useState(() => depth > 0);

  useEffect(() => {
    const fn = () => setOn(depth > 0);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);

  if (!on) return null;

  return (
    <View pointerEvents="none" style={styles.veil}>
      <Image source={LOGO} style={styles.logo} resizeMode="contain" />
      <ActivityIndicator color="#1B6B3A" />
    </View>
  );
};

const styles = StyleSheet.create({
  veil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  logo: {
    width: 84,
    height: 84,
    opacity: 0.4,
    marginBottom: 12,
  },
});
