import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { RankFamily, RankStyle } from '../constants/ranks';

const GEMS: Record<RankFamily, number> = {
  bronze: require('../assets/gems/garnet.png'),
  silver: require('../assets/gems/aquamarine.png'),
  gold: require('../assets/gems/citrine.png'),
  amber: require('../assets/gems/topaz.png'),
  pearl: require('../assets/gems/tourmaline.png'),
  jade: require('../assets/gems/peridot.png'),
  emerald: require('../assets/gems/emerald.png'),
  sapphire: require('../assets/gems/sapphire.png'),
  ruby: require('../assets/gems/ruby.png'),
  platinum: require('../assets/gems/onyx.png'),
  diamond: require('../assets/gems/diamond.png'),
  master: require('../assets/gems/amethyst.png'),
};

interface RankGemProps {
  rank: RankStyle;
  size: number;
  mark?: string;
}

export const RankGem: React.FC<RankGemProps> = ({ rank, size }) => {
  const scale = 0.9 + rank.division * 0.06;
  const side = Math.max(8, Math.round(size * scale));
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Image
        source={GEMS[rank.family]}
        resizeMode="contain"
        style={{ width: side, height: side }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
