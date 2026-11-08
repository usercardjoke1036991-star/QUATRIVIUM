import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { AppText } from './AppText';

const LOGO = require('../assets/logo.png');

/** Fondo del emblema y del arranque nativo (`app.json` splash). */
export const BRAND_SPLASH_BG = '#07150F';
const WORD = '#E8F0EA';
const LINE = '#8FCB9B';
const MUTED = '#8AA392';

export const BrandWordmark: React.FC<{
  compact?: boolean;
  titleColor?: string;
  lineColor?: string;
}> = ({ compact = false, titleColor = WORD, lineColor = LINE }) => (
  <View style={styles.wordBlock} accessible accessibilityLabel={APP_DISPLAY_NAME}>
    <AppText style={[styles.word, compact && styles.wordCompact, { color: titleColor }]}>
      QUATRIVIUM
    </AppText>
    <AppText style={[styles.finance, compact && styles.financeCompact, { color: lineColor }]}>
      FINANCE
    </AppText>
  </View>
);

export const BrandSplash: React.FC<{
  wordmark?: boolean;
  tagline?: string;
}> = ({ wordmark = true, tagline }) => (
  <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel={APP_DISPLAY_NAME}>
    <Image source={LOGO} style={styles.mark} resizeMode="contain" />
    {wordmark ? <BrandWordmark /> : null}
    {wordmark && tagline ? <AppText style={styles.tag}>{tagline}</AppText> : null}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND_SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  mark: {
    width: 196,
    height: 196,
  },
  wordBlock: {
    alignItems: 'center',
    marginTop: 28,
  },
  word: {
    fontSize: 22,
    letterSpacing: 5,
  },
  wordCompact: {
    fontSize: 18,
    letterSpacing: 4,
  },
  finance: {
    fontSize: 12,
    letterSpacing: 8,
    marginTop: 8,
  },
  financeCompact: {
    fontSize: 11,
    letterSpacing: 6,
    marginTop: 6,
  },
  tag: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 20,
    maxWidth: 280,
  },
});
