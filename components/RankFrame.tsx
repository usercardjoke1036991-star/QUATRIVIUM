import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { FilterImage } from 'react-native-svg/filter-image';
import {
  colorizeTextureFilters,
  getRankForLevel,
  rankDivisionTint,
  rankFamilyIndex,
  type RankStyle,
} from '../constants/ranks';
import { AppText } from './AppText';
import { RankGem } from './RankGem';

const APP_LOGO = require('../assets/logo.png');

interface RankFrameProps {
  level: number;
  size: number;
  children: React.ReactNode;
  label?: string;
  showLabel?: boolean;
}

/** El metal es más ancho que la foto para que se vean las incrustaciones. */
function framePad(size: number, rank: RankStyle, idx: number): number {
  const ratio = 0.5 + rank.division * 0.08 + Math.min(idx, 9) * 0.012;
  return Math.max(16, Math.round(size * ratio));
}

export function rankFramePadFor(size: number, level: number): number {
  const rank = getRankForLevel(level);
  return framePad(size, rank, rankFamilyIndex(rank.family));
}

/** Caja completa del marco (foto + metal + piedras). El hueco del avatar debe reservar esto. */
export function rankFrameOuterSize(size: number, level: number): number {
  return size + rankFramePadFor(size, level) * 2;
}

function jewelCount(rank: RankStyle): number {
  return 4 + rank.division * 4;
}

function inlaySeats(box: number, pad: number, count: number): Array<{ x: number; y: number }> {
  const outer = pad * 0.48;
  const seats = [
    { x: outer, y: outer },
    { x: box - outer, y: outer },
    { x: outer, y: box - outer },
    { x: box - outer, y: box - outer },
  ];
  if (count >= 8) {
    seats.push(
      { x: box / 2, y: outer },
      { x: box / 2, y: box - outer },
      { x: outer, y: box / 2 },
      { x: box - outer, y: box / 2 }
    );
  }
  if (count >= 12) {
    const inner = pad * 0.82;
    seats.push(
      { x: inner, y: inner },
      { x: box - inner, y: inner },
      { x: inner, y: box - inner },
      { x: box - inner, y: box - inner }
    );
  }
  return seats;
}

const Emblem: React.FC<{
  box: number;
  filters?: ReturnType<typeof colorizeTextureFilters>;
  opacity?: number;
  style?: object;
}> = ({ box, filters, opacity = 1, style }) => (
  <FilterImage
    source={APP_LOGO}
    filters={filters}
    resizeMode="contain"
    style={[{ width: box, height: box, opacity }, style]}
  />
);

/** Puntas del logo por encima de la foto: el metal entrelaza el retrato. */
function LogoWeave({
  box,
  pad,
  rank,
  filters,
}: {
  box: number;
  pad: number;
  rank: RankStyle;
  filters: ReturnType<typeof colorizeTextureFilters>;
}) {
  const corner = Math.round(pad * (1.02 + rank.division * 0.12));
  const edge = rank.division >= 1 ? Math.round(pad * (0.34 + rank.division * 0.16)) : 0;
  const clips: Array<{ key: string; wrap: object; img: object }> = [
    {
      key: 'tl',
      wrap: { top: 0, left: 0, width: corner, height: corner },
      img: { top: 0, left: 0 },
    },
    {
      key: 'tr',
      wrap: { top: 0, right: 0, width: corner, height: corner },
      img: { top: 0, right: 0 },
    },
    {
      key: 'bl',
      wrap: { bottom: 0, left: 0, width: corner, height: corner },
      img: { bottom: 0, left: 0 },
    },
    {
      key: 'br',
      wrap: { bottom: 0, right: 0, width: corner, height: corner },
      img: { bottom: 0, right: 0 },
    },
  ];
  if (edge > 0) {
    const span = box - corner * 2;
    clips.push(
      {
        key: 'top',
        wrap: { top: 0, left: corner, width: span, height: edge },
        img: { top: 0, left: -corner },
      },
      {
        key: 'bot',
        wrap: { bottom: 0, left: corner, width: span, height: edge },
        img: { bottom: 0, left: -corner },
      },
      {
        key: 'left',
        wrap: { top: corner, left: 0, width: edge, height: span },
        img: { top: -corner, left: 0 },
      },
      {
        key: 'right',
        wrap: { top: corner, right: 0, width: edge, height: span },
        img: { top: -corner, right: 0 },
      }
    );
  }
  return (
    <>
      {clips.map((clip) => (
        <View key={clip.key} style={[styles.clip, clip.wrap]} pointerEvents="none">
          <Emblem box={box} filters={filters} style={[styles.clipImg, clip.img]} />
        </View>
      ))}
    </>
  );
}

function StoneInlays({ box, pad, rank }: { box: number; pad: number; rank: RankStyle }) {
  const n = jewelCount(rank);
  const gem = Math.max(20, Math.round(pad * (0.82 + rank.division * 0.08)));
  const half = gem / 2;
  return (
    <>
      {inlaySeats(box, pad, n).map((seat, i) => (
        <View
          key={`inlay-${i}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: gem,
            height: gem,
            left: Math.min(box - half, Math.max(0, seat.x - half)),
            top: Math.min(box - half, Math.max(0, seat.y - half)),
          }}
        >
          <RankGem rank={rank} size={gem} mark={String(i)} />
        </View>
      ))}
    </>
  );
}

function MetalBezel({
  box,
  pad,
  size,
  rank,
  tint,
}: {
  box: number;
  pad: number;
  size: number;
  rank: RankStyle;
  tint: string;
}) {
  const gid = `bezel-${rank.family}-${rank.division}-${rank.level}`;
  const metalId = `${gid}-metal`;
  const inset = 0.8 + rank.division * 0.45;
  return (
    <Svg width={box} height={box} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={metalId} x1="18%" y1="0%" x2="82%" y2="100%">
          <Stop offset="0%" stopColor={rank.light} />
          <Stop offset="38%" stopColor={tint} />
          <Stop offset="100%" stopColor={rank.dark} />
        </LinearGradient>
      </Defs>
      <Rect
        x={pad - inset}
        y={pad - inset}
        width={size + inset * 2}
        height={size + inset * 2}
        rx={3}
        fill="none"
        stroke={`url(#${metalId})`}
        strokeWidth={1.15 + rank.division * 0.35}
      />
      {rank.division >= 1 ? (
        <Rect
          x={pad + 1.2}
          y={pad + 1.2}
          width={size - 2.4}
          height={size - 2.4}
          rx={2}
          fill="none"
          stroke={rank.light}
          strokeWidth={0.55}
          opacity={0.55}
        />
      ) : null}
      {rank.division >= 2 ? (
        <Rect
          x={pad - inset - 1.6}
          y={pad - inset - 1.6}
          width={size + (inset + 1.6) * 2}
          height={size + (inset + 1.6) * 2}
          rx={4}
          fill="none"
          stroke={tint}
          strokeWidth={0.7}
          opacity={0.7}
        />
      ) : null}
    </Svg>
  );
}

export const RankFrame: React.FC<RankFrameProps> = ({
  level,
  size,
  children,
  label,
  showLabel = size >= 36,
}) => {
  const rank = getRankForLevel(level);
  const idx = rankFamilyIndex(rank.family);
  const tint = rankDivisionTint(rank);
  const filters = colorizeTextureFilters(tint);
  const pad = framePad(size, rank, idx);
  const box = size + pad * 2;
  const caption = label || '';
  const captionH = showLabel && caption ? 14 : 0;

  return (
    <View style={[styles.wrap, { width: box, height: box + captionH }]}>
      <View style={{ width: box, height: box }}>
        <Emblem box={box} filters={filters} style={styles.back} />
        <View
          style={[
            styles.photo,
            {
              width: size,
              height: size,
              marginTop: pad,
              marginLeft: pad,
              borderColor: tint,
            },
          ]}
        >
          {children}
        </View>
        <MetalBezel box={box} pad={pad} size={size} rank={rank} tint={tint} />
        <LogoWeave box={box} pad={pad} rank={rank} filters={filters} />
        <StoneInlays box={box} pad={pad} rank={rank} />
      </View>
      {showLabel && caption ? (
        <AppText style={[styles.caption, { color: rank.text }]} numberOfLines={1}>
          {caption}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    overflow: 'visible',
  },
  back: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  clip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  clipImg: {
    position: 'absolute',
  },
  photo: {
    overflow: 'hidden',
    backgroundColor: '#111',
    borderRadius: 3,
    borderWidth: 0.8,
  },
  caption: {
    marginTop: 3,
    fontSize: 8,
    fontWeight: '800',
    textAlign: 'center',
    maxWidth: '100%',
  },
});
