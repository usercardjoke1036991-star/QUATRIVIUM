import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { passwordRuleFlags } from '../utils/passwordPolicy';
import { AppText } from './AppText';

interface PasswordRulesHintProps {
  value: string;
}

export function PasswordRulesHint({ value }: PasswordRulesHintProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const flags = passwordRuleFlags(value);
  const rows: Array<{ ok: boolean; label: string; info?: boolean }> = [
    { ok: flags.min, label: t('passwordRuleMin') },
    { ok: true, label: t('passwordRuleMax'), info: true },
    { ok: flags.upper, label: t('passwordRuleUpper') },
    { ok: flags.number, label: t('passwordRuleNumber') },
    { ok: flags.symbol, label: t('passwordRuleSymbol') },
  ];

  return (
    <View style={styles.box} accessibilityRole="summary" accessibilityLabel={t('lockPasswordMin')}>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('lockPasswordMin')}</AppText>
      {rows.map((row) => (
        <AppText
          key={row.label}
          style={[styles.row, { color: row.info || row.ok ? colors.success : colors.textMuted }]}
        >
          {row.info ? '·' : row.ok ? '✓' : '○'} {row.label}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 8,
    marginBottom: 4,
    alignSelf: 'stretch',
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  row: {
    fontSize: 13,
    lineHeight: 20,
  },
});
