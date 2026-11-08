import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { ProfileAvatar } from './ProfileAvatar';
import { AppText } from './AppText';
import { labelForProfile } from '../services/userProfile';
import { useUserProfile } from '../profile/ProfileContext';
import { formatRankLabel, getRankForLevel } from '../constants/ranks';
import type { ReferralChild } from '../services/referralNetwork';
import { canExpandReferralDepth, isBranchOpen } from '../utils/referralTree';

interface ReferralBranchProps {
  people: ReferralChild[];
  depth: number;
  open: Record<string, boolean>;
  branches: Record<string, ReferralChild[]>;
  loading: Record<string, boolean>;
  onToggle: (address: string, depth: number) => void;
}

export const ReferralBranch: React.FC<ReferralBranchProps> = ({
  people,
  depth,
  open,
  branches,
  loading,
  onToggle,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { lookup } = useUserProfile();
  const canGoDeeper = canExpandReferralDepth(depth);

  if (!people.length) {
    return (
      <AppText style={[styles.empty, { color: colors.textMuted }]}>
        {t('referralGroupEmpty')}
      </AppText>
    );
  }

  return (
    <View>
      <AppText style={[styles.generation, { color: colors.textMuted }]}>
        {t('referralGeneration', { n: String(depth) })}
      </AppText>
      {people.map((person) => {
        const expanded = isBranchOpen(open, person.address);
        const kids = branches[person.address.toLowerCase()] || [];
        const busy = Boolean(loading[person.address.toLowerCase()]);
        const profile = lookup(person.address);
        const name = labelForProfile(profile, person.code);
        return (
          <View key={person.address} style={[styles.wrap, { borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => canGoDeeper && onToggle(person.address, depth)}
              accessibilityRole="button"
              accessibilityLabel={name}
            >
              <ProfileAvatar
                profile={profile}
                wallet={person.address}
                size={36}
                publicView
                level={person.level || 1}
                rankName={t(getRankForLevel(person.level || 1).nameKey)}
                showRankLabel={false}
              />
              <View style={styles.text}>
                <AppText style={[styles.name, { color: colors.text }]}>{name}</AppText>
                <AppText style={[styles.hint, { color: colors.textMuted }]}>
                  {formatRankLabel(
                    getRankForLevel(person.level || 1),
                    t(getRankForLevel(person.level || 1).nameKey)
                  )}
                </AppText>
                {canGoDeeper ? (
                  <AppText style={[styles.hint, { color: colors.primary }]}>
                    {t('referralGroupHint')}
                  </AppText>
                ) : null}
              </View>
            </TouchableOpacity>
            {expanded ? (
              <View style={[styles.nested, { borderColor: colors.border }]}>
                {busy ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <ReferralBranch
                    people={kids}
                    depth={depth + 1}
                    open={open}
                    branches={branches}
                    loading={loading}
                    onToggle={onToggle}
                  />
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  generation: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  wrap: {
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  text: {
    flex: 1,
  },
  name: {
    fontSize: 13,
    fontWeight: '700',
  },
  hint: {
    fontSize: 11,
    marginTop: 1,
  },
  nested: {
    marginLeft: 14,
    marginTop: 4,
    paddingLeft: 10,
    borderLeftWidth: 2,
  },
  empty: {
    fontSize: 12,
    marginBottom: 4,
  },
});
