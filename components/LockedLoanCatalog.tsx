import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MAX_LOAN_LEVEL, type LoanTier } from '../constants/loanTiers';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppText } from './AppText';
import { LoanTierCard } from './LoanTierCard';

const PREVIEW = 12;
const BAND = 50;

type CardProps = Omit<React.ComponentProps<typeof LoanTierCard>, 'tier' | 'isActiveTier'>;

interface LockedLoanCatalogProps extends CardProps {
  tiers: LoanTier[];
  labelTier: (tier: LoanTier) => LoanTier;
}

export function LockedLoanCatalog({ tiers, labelTier, ...cardProps }: LockedLoanCatalogProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [openBand, setOpenBand] = useState<string | null>(null);

  const preview = tiers.slice(0, PREVIEW);
  const bands = useMemo(() => {
    const rest = tiers.slice(PREVIEW);
    const groups: { key: string; from: number; to: number; items: LoanTier[] }[] = [];
    for (const tier of rest) {
      const from = Math.floor((tier.id - 1) / BAND) * BAND + 1;
      const to = Math.min(from + BAND - 1, MAX_LOAN_LEVEL);
      const key = `${from}-${to}`;
      const last = groups[groups.length - 1];
      if (last?.key === key) last.items.push(tier);
      else groups.push({ key, from, to, items: [tier] });
    }
    return groups;
  }, [tiers]);

  if (!tiers.length) return null;

  return (
    <View>
      {preview.map((tier) => (
        <LoanTierCard key={tier.id} tier={labelTier(tier)} isActiveTier={false} {...cardProps} />
      ))}
      {bands.map((band) => {
        const open = openBand === band.key;
        return (
          <View key={band.key} style={[styles.band, { borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setOpenBand(open ? null : band.key)}
              style={styles.bandHead}
            >
              <AppText style={[styles.bandTitle, { color: colors.text }]}>
                {t('level')} {band.from}–{band.to}
              </AppText>
              <AppText style={[styles.bandMeta, { color: colors.textMuted }]}>
                {band.items.length} · {open ? '–' : '+'}
              </AppText>
            </TouchableOpacity>
            {open
              ? band.items.map((tier) => (
                  <LoanTierCard
                    key={tier.id}
                    tier={labelTier(tier)}
                    isActiveTier={false}
                    {...cardProps}
                  />
                ))
              : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  bandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bandTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  bandMeta: {
    fontSize: 12,
  },
});
