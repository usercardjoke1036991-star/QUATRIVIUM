import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { isAltaConfigured } from '../constants/altaConfig';
import { isDemoAccount } from '../constants/rpcConfig';
import { accessPayUsdt } from '../utils/creditGates';
import { BrandLogo } from './BrandLogo';
import { AppText } from './AppText';
import { LinkedWalletCard } from './LinkedWalletCard';

interface CreditAccessGateProps {
  canPay: boolean;
  isLoading?: boolean;
  walletAddress?: string;
  appWalletUsdt?: string;
  onPay: () => void;
}

export function CreditAccessGate({
  canPay,
  isLoading = false,
  walletAddress = '',
  appWalletUsdt = '0',
  onPay,
}: CreditAccessGateProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const held = Number(appWalletUsdt);
  const alreadyInWallet =
    isAltaConfigured() && Number.isFinite(held) && held + 1e-9 >= accessPayUsdt();

  return (
    <View style={styles.body}>
      <BrandLogo size={64} style={styles.logo} />
      <AppText style={[styles.title, { color: colors.text }]}>{t('creditAccessTitle')}</AppText>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>
        {t(alreadyInWallet ? 'creditAccessAlreadyInWallet' : 'creditAccessGateLead')}
      </AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>{t('creditAccessLead')}</AppText>
      {walletAddress ? <LinkedWalletCard internalWallet={walletAddress} compact /> : null}
      {!canPay ? (
        <AppText style={[styles.pending, { color: colors.warnText }]}>
          {!isDemoAccount() && !isAltaConfigured()
            ? t('liveCreditNotReady')
            : t('creditAccessPending')}
        </AppText>
      ) : null}
      <TouchableOpacity
        disabled={isLoading || !canPay}
        onPress={onPay}
        style={[styles.pay, { backgroundColor: canPay ? colors.primary : colors.chip }]}
        accessibilityRole="button"
        accessibilityLabel={t(alreadyInWallet ? 'creditAccessSign' : 'creditAccessPay')}
      >
        {isLoading ? (
          <ActivityIndicator color={canPay ? colors.onPrimary : colors.textMuted} />
        ) : (
          <AppText
            style={[styles.payText, { color: canPay ? colors.onPrimary : colors.textMuted }]}
          >
            {t(alreadyInWallet ? 'creditAccessSign' : 'creditAccessPay')}
          </AppText>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  logo: {
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  lead: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  meta: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  pending: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  pay: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  payText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
