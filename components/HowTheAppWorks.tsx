import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useTheme } from '../theme/ThemeContext';
import { AppText } from './AppText';

type GuideRow = {
  title: TranslationKey;
  body: TranslationKey;
  earn: TranslationKey;
};

type GuidePart = {
  title: TranslationKey;
  rows: GuideRow[];
};

const PARTS: GuidePart[] = [
  {
    title: 'guidePartStart',
    rows: [
      { title: 'guideWallet', body: 'guideWalletBody', earn: 'guideWalletEarn' },
      { title: 'guideIdentity', body: 'guideIdentityBody', earn: 'guideIdentityEarn' },
      { title: 'guideCredit', body: 'guideCreditBody', earn: 'guideCreditEarn' },
    ],
  },
  {
    title: 'guidePartEarn',
    rows: [
      { title: 'guideNetwork', body: 'guideNetworkBody', earn: 'guideNetworkEarn' },
      { title: 'guideRacha', body: 'guideRachaBody', earn: 'guideRachaEarn' },
      { title: 'guideCanje', body: 'guideCanjeBody', earn: 'guideCanjeEarn' },
      { title: 'guideBonuses', body: 'guideBonusesBody', earn: 'guideBonusesEarn' },
      { title: 'guideReserva', body: 'guideReservaBody', earn: 'guideReservaEarn' },
      { title: 'guideDonate', body: 'guideDonateBody', earn: 'guideDonateEarn' },
    ],
  },
  {
    title: 'guidePartTrack',
    rows: [
      { title: 'guideRanks', body: 'guideRanksBody', earn: 'guideRanksEarn' },
      { title: 'guideHistory', body: 'guideHistoryBody', earn: 'guideHistoryEarn' },
      { title: 'guidePool', body: 'guidePoolBody', earn: 'guidePoolEarn' },
    ],
  },
];

export function HowTheAppWorks() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      <AppText style={[styles.lead, { color: colors.text }]}>{t('settingsGuideLead')}</AppText>
      {PARTS.map((part) => (
        <View key={part.title} style={styles.part}>
          <AppText style={[styles.partTitle, { color: colors.primary }]}>{t(part.title)}</AppText>
          {part.rows.map((row) => (
            <View
              key={row.title}
              style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <AppText style={[styles.title, { color: colors.text }]}>{t(row.title)}</AppText>
              <AppText style={[styles.body, { color: colors.textMuted }]}>{t(row.body)}</AppText>
              <AppText style={[styles.earnLabel, { color: colors.text }]}>
                {t('guideHowYouEarn')}
              </AppText>
              <AppText style={[styles.earn, { color: colors.text }]}>{t(row.earn)}</AppText>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 18, paddingBottom: 16 },
  lead: { fontSize: 15, lineHeight: 22 },
  part: { gap: 10 },
  partTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  earnLabel: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  earn: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
});
