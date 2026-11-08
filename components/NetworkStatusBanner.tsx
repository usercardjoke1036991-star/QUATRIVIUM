import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { getContractAddress } from '../constants/contractConfig';
import { NETWORK_CONFIG, isContractConfigured, isDemoMode } from '../constants/rpcConfig';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { formatAddress } from '../utils/formatters';

export const NetworkStatusBanner: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const live = isContractConfigured();
  const networkName =
    NETWORK_CONFIG.chainId === 42161
      ? t('networkMainnet')
      : NETWORK_CONFIG.chainId === 421614
        ? t('networkTestnet')
        : `${NETWORK_CONFIG.chainName} (${NETWORK_CONFIG.chainId})`;

  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText style={[styles.kicker, { color: colors.textMuted }]}>{t('networkLive')}</AppText>
      <AppText style={[styles.title, { color: colors.text }]}>{networkName}</AppText>
      {live ? (
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('networkContract', { address: formatAddress(getContractAddress()) })}
        </AppText>
      ) : isDemoMode() ? (
        <AppText style={[styles.meta, { color: colors.textMuted }]}>{t('configWarn')}</AppText>
      ) : null}
      {isDemoMode() ? (
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('networkNotMainnet')}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
});
