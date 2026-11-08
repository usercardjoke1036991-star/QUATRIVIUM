import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAccount, useAppKit } from '@reown/appkit-react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useWeb3Balances } from '../hooks/useWeb3Balances';
import { getSupportedTokens } from '../constants/tokens';
import { formatAddress } from '../utils/formatters';
import { useAppMode } from '../wallet/AppModeContext';
import { openWalletConnect } from '../utils/openWalletConnect';
import { useUserProfile } from '../profile/ProfileContext';
import { isFounderWallet } from '../utils/founderWallet';
import { adminSeatOpen } from '../utils/creditGates';
import { isDemoAccount } from '../constants/rpcConfig';
import { AppText } from './AppText';

export const AdminAccess: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { walletAddress: appWallet } = useUserProfile();
  const { mode } = useAppMode();
  const token = useMemo(() => getSupportedTokens()[0], [mode]);
  const connected = Boolean(isConnected && address);
  const { userInfo: externalInfo } = useWeb3Balances(
    connected && address ? address.toLowerCase() : '',
    token
  );
  const { userInfo: appInfo } = useWeb3Balances(appWallet || '', token);
  const founder =
    isFounderWallet(appWallet, appInfo.founderAddress) ||
    isFounderWallet(address, externalInfo.founderAddress);
  const allowed = adminSeatOpen({
    demo: isDemoAccount(),
    connected,
    address: address || appWallet,
    isAdmin: Boolean(externalInfo.isAdmin || appInfo.isAdmin),
    isOwner: Boolean(externalInfo.isOwner || appInfo.isOwner),
    roster: externalInfo.adminRoster.length ? externalInfo.adminRoster : appInfo.adminRoster,
    founder,
  });
  const shownAddress = allowed && !connected ? appWallet : address;

  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('settingsAdminLead')}</AppText>
      {shownAddress ? (
        <AppText style={[styles.meta, { color: colors.text }]}>
          {formatAddress(shownAddress)}
        </AppText>
      ) : null}
      {allowed ? (
        <AppText style={[styles.ok, { color: colors.success }]}>{t('settingsAdminOk')}</AppText>
      ) : null}
      {connected && !allowed ? (
        <AppText style={[styles.warn, { color: colors.danger }]}>{t('settingsAdminNot')}</AppText>
      ) : null}
      <TouchableOpacity
        onPress={() => void openWalletConnect(open)}
        style={[styles.btn, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel={t('settingsAdminConnect')}
      >
        <AppText style={[styles.btnText, { color: colors.onPrimary }]}>
          {t('settingsAdminConnect')}
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  meta: {
    fontSize: 13,
    marginBottom: 8,
  },
  ok: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  warn: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
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
