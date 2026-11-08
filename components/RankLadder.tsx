import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  clampLoanLevel,
  FAMILY_BANDS,
  formatRankLabel,
  getRankForLevel,
  rankGalleryRow,
  romanDivision,
  type RankFamily,
} from '../constants/ranks';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AnonymousFace } from './ProfileAvatar';
import { RankFrame } from './RankFrame';
import { RankMedal } from './RankMedal';
import { AppText } from './AppText';

interface RankLadderProps {
  userLevel: number;
  isFounder?: boolean;
  equippedLevel?: number;
  onWearFrame?: (level: number) => void;
}

export const RankLadder: React.FC<RankLadderProps> = ({
  userLevel,
  isFounder = false,
  equippedLevel = 0,
  onWearFrame,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const current = getRankForLevel(clampLoanLevel(userLevel || 1));
  const [family, setFamily] = useState<RankFamily>(current.family);
  const row = useMemo(() => rankGalleryRow(family), [family]);

  return (
    <View style={styles.wrap}>
      {isFounder ? (
        <AppText style={[styles.founderHint, { color: colors.textMuted }]}>
          {t('founderFramesHint')}
        </AppText>
      ) : null}
      <ScrollView
        horizontal
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {FAMILY_BANDS.map((band) => {
          const sample = getRankForLevel(band.from);
          const active = band.family === family;
          const reached = band.from <= current.level;
          return (
            <Pressable
              key={band.family}
              onPress={() => setFamily(band.family)}
              style={[
                styles.chip,
                {
                  borderColor: active ? sample.metal : colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(sample.nameKey)}
            >
              <RankMedal level={band.from} rank={sample} size={28} dimmed={!reached} />
              <AppText
                style={[styles.chipText, { color: reached ? sample.text : colors.textMuted }]}
                numberOfLines={1}
              >
                {t(sample.nameKey)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.stage}>
        {row.map((rank) => {
          const reached = isFounder || rank.level <= current.level;
          const worn = isFounder && equippedLevel > 0 ? getRankForLevel(equippedLevel) : current;
          const mine = rank.family === worn.family && rank.division === worn.division;
          const caption = formatRankLabel(rank, t(rank.nameKey));
          return (
            <Pressable
              key={`${rank.family}-${rank.division}`}
              onPress={isFounder && onWearFrame ? () => onWearFrame(rank.level) : undefined}
              disabled={!isFounder || !onWearFrame}
              accessibilityRole={isFounder && onWearFrame ? 'button' : undefined}
              accessibilityLabel={isFounder ? t(mine ? 'wearingFrame' : 'wearFrame') : caption}
              style={[
                styles.card,
                { borderColor: mine ? rank.metal : colors.border, backgroundColor: colors.surface },
                !reached && styles.dim,
              ]}
            >
              <RankFrame level={rank.level} size={42} label={caption} showLabel>
                <AnonymousFace size={42} square />
              </RankFrame>
              <AppText style={[styles.roman, { color: rank.text }]}>
                {romanDivision(rank.division)}
              </AppText>
              {isFounder ? (
                <AppText style={[styles.wear, { color: mine ? rank.text : colors.textMuted }]}>
                  {mine ? t('wearingFrame') : t('wearFrame')}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 4,
    gap: 10,
  },
  chips: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    width: 72,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 4,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  stage: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 4,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 2,
    minHeight: 188,
  },
  dim: {
    opacity: 0.46,
  },
  roman: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '800',
  },
  founderHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  wear: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
});
