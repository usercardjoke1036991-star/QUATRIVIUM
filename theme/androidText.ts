import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/**
 * En Xiaomi/MIUI, Inter o cualquier fontWeight pinta la letra otra vez, un poco al lado.
 * Solo caras nativas, sin peso.
 */
function androidFace(weight: TextStyle['fontWeight'] | undefined, family: string): string {
  if (family === 'monospace' || /mono|courier/i.test(family)) return 'monospace';
  const n =
    weight === 'bold' || weight === '700' || weight === '800' || weight === '900'
      ? 700
      : weight === '500' || weight === '600' || weight === 'medium'
        ? 600
        : 400;
  if (n >= 700) return 'sans-serif-black';
  if (n >= 500) return 'sans-serif-medium';
  return 'sans-serif';
}

export function remapAndroidTextStyle(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  if (Platform.OS !== 'android') return style;
  const flat = StyleSheet.flatten(style) || {};
  const next: TextStyle = { ...flat };
  next.fontFamily = androidFace(next.fontWeight, String(next.fontFamily || ''));
  delete next.fontWeight;
  delete next.fontStyle;
  next.textShadowColor = 'transparent';
  next.textShadowRadius = 0;
  next.textShadowOffset = { width: 0, height: 0 };
  if (typeof next.letterSpacing === 'number') next.letterSpacing = 0;
  if (next.textTransform === 'uppercase' || next.textTransform === 'lowercase') {
    next.textTransform = 'none';
  }
  return next;
}

/** @deprecated Las fuentes del sistema no esperan carga. */
export function setInterReady(_ready: boolean) {}
