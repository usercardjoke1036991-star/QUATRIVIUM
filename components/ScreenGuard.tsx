import { useEffect, useState, type ReactElement } from 'react';
import { AppState, NativeModules, StyleSheet, View } from 'react-native';

function hasNativeCapture(): boolean {
  const modules = NativeModules as Record<string, unknown>;
  return Boolean(modules.ExpoScreenCapture || modules.ExpoScreenCaptureModule);
}

type ScreenshotListener = () => void;
const screenshotListeners = new Set<ScreenshotListener>();

export function subscribeScreenshot(listener: ScreenshotListener): () => void {
  screenshotListeners.add(listener);
  return () => {
    screenshotListeners.delete(listener);
  };
}

function notifyScreenshot(): void {
  screenshotListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Un panel no debe tumbar el resto.
    }
  });
}

/** FLAG_SECURE / ReplayKit y cubierta al ir a segundo plano: ninguna otra app debe ver esta pantalla. */
export function ScreenGuard(): ReactElement | null {
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    let active = true;
    let restore: (() => Promise<unknown>) | undefined;
    let screenshot: { remove: () => void } | undefined;

    const arm = async () => {
      if (!hasNativeCapture()) return;
      try {
        screenshot?.remove();
        screenshot = undefined;
        const mod = await import('expo-screen-capture');
        if (!active) return;
        await mod.preventScreenCaptureAsync();
        restore = () => mod.allowScreenCaptureAsync();
        screenshot = mod.addScreenshotListener(() => {
          notifyScreenshot();
        });
      } catch {
        // Build sin el módulo nativo; la cubierta de segundo plano sigue activa.
      }
    };

    void arm();
    const sub = AppState.addEventListener('change', (state) => {
      setCovered(state !== 'active');
      if (state === 'active') void arm();
    });

    return () => {
      active = false;
      sub.remove();
      screenshot?.remove();
      void restore?.().catch(() => {});
    };
  }, []);

  if (!covered) return null;
  return <View pointerEvents="auto" style={styles.cover} />;
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#07150F',
    zIndex: 9999,
    elevation: 9999,
  },
});
