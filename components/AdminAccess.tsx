import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useWeb3Balances } from '../hooks/useWeb3Balances';
import { getSupportedTokens } from '../constants/tokens';
import { formatAddress } from '../utils/formatters';
import { useAppMode } from '../wallet/AppModeContext';
import { useUserProfile } from '../profile/ProfileContext';
import { isFounderWallet } from '../utils/founderWallet';
import { adminSeatOpen } from '../utils/creditGates';
import { getContractAddress, isDemoAccount } from '../constants/rpcConfig';
import { AppText } from './AppText';
/** Solo lectura: si la billetera de la app es fundadora o admin. Una Safe firma fuera de la app. */
export const AdminAccess: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { walletAddress: appWallet } = useUserProfile();
  const { mode } = useAppMode();
  const token = useMemo(() => getSupportedTokens(mode === 'demo')[0], [mode]);
  const { userInfo: appInfo } = useWeb3Balances(appWallet || '', token);
  const founder = isFounderWallet(appWallet, appInfo.founderAddress);
  const allowed = adminSeatOpen({
    demo: isDemoAccount(),
    connected: false,
    address: appWallet,
    isAdmin: Boolean(appInfo.isAdmin),
    isOwner: Boolean(appInfo.isOwner),
    roster: appInfo.adminRoster,
    founder,
  });
  const contract = getContractAddress();
  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('settingsAdminLead')}</AppText>
      {appWallet ? (
        <AppText style={[styles.meta, { color: colors.text }]}>{formatAddress(appWallet)}</AppText>
      ) : null}
      {allowed ? (
        <AppText style={[styles.ok, { color: colors.success }]}>{t('settingsAdminOk')}</AppText>
      ) : (
        <AppText style={[styles.warn, { color: colors.danger }]}>{t('settingsAdminNot')}</AppText>
      )}
      <AppText selectable style={[styles.lead, { color: colors.textMuted }]}>
        {t('settingsAdminSafe', { address: contract })}
      </AppText>
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
});
