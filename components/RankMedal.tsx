import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FilterImage } from 'react-native-svg/filter-image';
import {
  colorizeTextureFilters,
  getRankForLevel,
  RANK_MEDAL_ASSET,
  type RankStyle,
} from '../constants/ranks';
import { AppText } from './AppText';
import { RankGem } from './RankGem';

const RANK_LOGOS = {
  1: require('../assets/ranks/1.png'),
  2: require('../assets/ranks/2.png'),
  3: require('../assets/ranks/3.png'),
  4: require('../assets/ranks/4.png'),
  5: require('../assets/ranks/5.png'),
  6: require('../assets/ranks/6.png'),
  7: require('../assets/ranks/7.png'),
  8: require('../assets/ranks/8.png'),
  9: require('../assets/ranks/9.png'),
  10: require('../assets/ranks/10.png'),
} as const;

interface RankMedalProps {
  level: number;
  size?: number;
  rank?: RankStyle;
  dimmed?: boolean;
  showLabel?: boolean;
  label?: string;
}

export const RankMedal: React.FC<RankMedalProps> = ({
  level,
  size = 44,
  rank,
  dimmed = false,
  showLabel = false,
  label,
}) => {
  const style = rank || getRankForLevel(level);
  const sculpt = RANK_MEDAL_ASSET[style.family];
  const gem = Math.max(14, Math.round(size * 0.52));
  return (
    <View style={[styles.wrap, { opacity: dimmed ? 0.38 : 1 }]}>
      <View style={{ width: size, height: size }}>
        <FilterImage
          source={RANK_LOGOS[sculpt]}
          resizeMode="contain"
          width={size}
          height={size}
          style={{ width: size, height: size }}
          filters={colorizeTextureFilters(style.metal)}
        />
        <View
          style={[
            styles.gem,
            {
              width: gem,
              height: gem,
              left: (size - gem) / 2,
              top: (size - gem) / 2,
            },
          ]}
          pointerEvents="none"
        >
          <RankGem rank={style} size={gem} />
        </View>
      </View>
      {showLabel && label ? (
        <AppText style={[styles.label, { color: style.text }]} numberOfLines={1}>
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
  gem: {
    position: 'absolute',
  },
  label: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '800',
    maxWidth: 64,
    textAlign: 'center',
  },
});
