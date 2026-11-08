import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { isAltaConfigured } from '../constants/altaConfig';
import { formatAddress } from '../utils/formatters';
import { expiredSponsorDebtors, settleExpiredSponsor } from '../services/padrinoSettle';
import { AppText } from './AppText';

interface SponsorPoolButtonProps {
  debtors: string[];
}

export function SponsorPoolButton({ debtors }: SponsorPoolButtonProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [due, setDue] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isAltaConfigured() || debtors.length === 0) {
      setDue([]);
      return undefined;
    }
    let live = true;
    expiredSponsorDebtors(debtors)
      .then((found) => {
        if (live) setDue(found);
      })
      .catch(() => {
        if (live) setDue([]);
      });
    return () => {
      live = false;
    };
  }, [debtors.join('|')]);

  if (!isAltaConfigured() || due.length === 0) return null;

  const settle = async (deudor: string) => {
    setBusy(deudor);
    setNote('');
    try {
      const result = await settleExpiredSponsor(deudor);
      if (result === 'no-seal') setNote(t('padrinoSettleNeedSeal'));
      else if (result === 'waiting') setNote(t('padrinoSettleWait'));
      else if (result === 'settled' || result === 'empty') {
        setDue((current) => current.filter((item) => item.toLowerCase() !== deudor.toLowerCase()));
      }
    } catch {
      setNote(t('padrinoSettleFailed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('padrinoSettleLead')}</AppText>
      {due.map((deudor) => (
        <TouchableOpacity
          key={deudor}
          disabled={busy !== ''}
          onPress={() => void settle(deudor)}
          style={[styles.btn, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={t('padrinoSettleButton')}
        >
          {busy === deudor ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <AppText style={[styles.btnText, { color: colors.onPrimary }]}>
              {t('padrinoSettleButton')} · {formatAddress(deudor)}
            </AppText>
          )}
        </TouchableOpacity>
      ))}
      {note ? <AppText style={[styles.lead, { color: colors.warnText }]}>{note}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    gap: 8,
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
