import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { isAltaConfigured } from '../constants/altaConfig';
import { accessPayUsdt, hasCreditAccess } from '../utils/creditGates';
import { AppText } from './AppText';
import { useAppMode } from '../wallet/AppModeContext';

interface CreditAccessBannerProps {
  paidUsd: number;
  altaPaid?: boolean;
  canPay: boolean;
  isLoading?: boolean;
  appWalletUsdt?: string;
  tokenSymbol?: string;
  needRegister?: boolean;
  canRegister?: boolean;
  onPay: () => void;
  onRegister?: () => void;
}

export const CreditAccessBanner: React.FC<CreditAccessBannerProps> = ({
  paidUsd,
  altaPaid = false,
  canPay,
  isLoading = false,
  appWalletUsdt = '0',
  needRegister = false,
  canRegister = false,
  onPay,
  onRegister,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { mode } = useAppMode();
  const paid = hasCreditAccess(paidUsd, altaPaid);
  const showPay = !((mode === 'demo' && !isAltaConfigured()) || paid);
  const showRegister = Boolean(needRegister && !showPay);
  const held = Number(appWalletUsdt);
  const alreadyInWallet =
    isAltaConfigured() && Number.isFinite(held) && held + 1e-9 >= accessPayUsdt();

  if (!showPay && !showRegister) {
    return null;
  }

  return (
    <View style={[styles.box, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
      <AppText style={[styles.title, { color: colors.text }]}>
        {showPay ? t('creditAccessTitle') : t('register')}
      </AppText>
      <AppText style={[styles.lead, { color: colors.text }]}>
        {showPay
          ? alreadyInWallet
            ? t('creditAccessAlreadyInWallet')
            : isAltaConfigured()
              ? t('creditAccessGateLead')
              : mode === 'live'
                ? t('liveCreditNotReady')
                : t('creditAccessPending')
          : altaPaid
            ? t('creditAccessRegisterLeft')
            : t('creditAccessRegisterNeed')}
      </AppText>
      {showPay && canPay ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={onPay}
          style={[styles.pay, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={t(alreadyInWallet ? 'creditAccessSign' : 'creditAccessPay')}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <AppText style={[styles.payText, { color: colors.onPrimary }]}>
              {t(alreadyInWallet ? 'creditAccessSign' : 'creditAccessPay')}
            </AppText>
          )}
        </TouchableOpacity>
      ) : null}
      {showRegister && onRegister ? (
        <TouchableOpacity
          disabled={isLoading || !canRegister}
          onPress={onRegister}
          style={[styles.pay, { backgroundColor: canRegister ? colors.primary : colors.chip }]}
          accessibilityRole="button"
          accessibilityLabel={t('register')}
        >
          {isLoading ? (
            <ActivityIndicator color={canRegister ? colors.onPrimary : colors.textMuted} />
          ) : (
            <AppText
              style={[styles.payText, { color: canRegister ? colors.onPrimary : colors.textMuted }]}
            >
              {t('register')}
            </AppText>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  lead: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    marginBottom: 12,
  },
  pay: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  payText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
