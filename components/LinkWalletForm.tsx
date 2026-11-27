import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import * as linkedWallet from '../services/linkedWallet';
import { isDemoMode } from '../constants/rpcConfig';
import { AppText } from './AppText';
interface LinkWalletFormProps {
  internalWallet: string;
  onLinked: (externalWallet: string) => void | Promise<void>;
  allowSkip?: boolean;
}
/**
 * Vincular la billetera de retiro. La prueba por transferencia llega en la tanda B2.
 * Mientras tanto no se vincula nada nuevo; los vínculos viejos se siguen leyendo.
 */
export const LinkWalletForm: React.FC<LinkWalletFormProps> = ({
  internalWallet,
  onLinked,
  allowSkip = true,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const skip = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await linkedWallet.skipLinkedExternalWallet(internalWallet);
      await onLinked(saved);
    } catch {
      setError(t('linkWalletNeed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')}
      </AppText>
      {error ? <AppText style={[styles.error, { color: colors.danger }]}>{error}</AppText> : null}
      {allowSkip ? (
        <TouchableOpacity
          disabled={busy}
          onPress={() => void skip()}
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel={t('linkWalletSkip')}
        >
          <AppText style={[styles.skipText, { color: colors.textMuted }]}>
            {t('linkWalletSkip')}
          </AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};
const styles = StyleSheet.create({
  meta: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  skip: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  skipText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
