import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { PODIUM_STYLE } from '../constants/podium';
import type { PodiumPlace } from '../utils/fameRankings';
import { AppText } from './AppText';

interface PodiumFrameProps {
  place: PodiumPlace;
  children: React.ReactNode;
  label?: string;
  showLabel?: boolean;
}

/** Medalla de ranking alrededor del marco de gema. No reutiliza RankFrame ni piedras. */
export const PodiumFrame: React.FC<PodiumFrameProps> = ({
  place,
  children,
  label,
  showLabel = false,
}) => {
  const style = PODIUM_STYLE[place];
  const pad = place === 1 ? 22 : 16;

  return (
    <View style={styles.wrap}>
      <View style={[styles.halo, { padding: pad }]}>
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100">
          {place === 1 ? (
            <>
              <Polygon
                points="50,2 56,20 76,12 68,30 92,38 70,48 78,70 50,58 22,70 30,48 8,38 32,30 24,12 44,20"
                fill={style.light}
              />
              <Circle cx="50" cy="52" r="40" fill={style.metal} />
              <Circle cx="50" cy="52" r="34" fill={style.dark} />
            </>
          ) : null}
          {place === 2 ? (
            <>
              <Path d="M18 10h64l10 24-42 52L8 34z" fill={style.metal} />
              <Path d="M26 18h48l6 18-30 36L20 36z" fill={style.dark} />
            </>
          ) : null}
          {place === 3 ? (
            <>
              <Polygon points="12,22 88,22 96,36 50,92 4,36" fill={style.metal} />
              <Polygon points="22,30 78,30 84,40 50,80 16,40" fill={style.dark} />
              <Path d="M30 14h40v12H30z" fill={style.light} />
            </>
          ) : null}
        </Svg>
        <View style={[styles.badge, { backgroundColor: style.metal, borderColor: style.light }]}>
          <AppText style={[styles.badgeText, { color: style.ink }]}>{place}</AppText>
        </View>
        <View style={styles.inner}>{children}</View>
      </View>
      {showLabel && label ? (
        <AppText style={[styles.label, { color: style.ink }]} numberOfLines={2}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    zIndex: 1,
  },
  badge: {
    position: 'absolute',
    top: 0,
    zIndex: 2,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  label: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: 120,
  },
});
