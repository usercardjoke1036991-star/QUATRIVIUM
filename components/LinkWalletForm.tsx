import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAccount, useAppKit, useProvider } from '@reown/appkit-react-native';
import type { Eip1193Provider } from 'ethers';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { formatAddress } from '../utils/formatters';
import * as linkedWallet from '../services/linkedWallet';
import { openWalletConnect, withWalletSignTimeout } from '../utils/openWalletConnect';
import { isDemoMode } from '../constants/rpcConfig';
import { AppText } from './AppText';

interface LinkWalletFormProps {
  internalWallet: string;
  onLinked: (externalWallet: string) => void | Promise<void>;
  allowSkip?: boolean;
}

export const LinkWalletForm: React.FC<LinkWalletFormProps> = ({
  internalWallet,
  onLinked,
  allowSkip = true,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { provider } = useProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = Boolean(isConnected && linkedWallet.hasLinkedExternalWallet(address || ''));

  const submit = async () => {
    if (!connected || !address) {
      setError(t('linkWalletNeed'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await withWalletSignTimeout(
        linkedWallet.proveAndSaveLinkedWallet(provider as Eip1193Provider, internalWallet, address),
        45000
      );
      await onLinked(saved);
    } catch (caught) {
      const message = String((caught as Error)?.message || '');
      setError(
        message.includes('wrong-network')
          ? t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')
          : t('linkWalletSignNeed')
      );
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
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
      <AppText style={[styles.meta, { color: colors.textMuted, marginBottom: 10 }]}>
        {t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')}
      </AppText>
      <TouchableOpacity
        onPress={() => {
          setError('');
          void openWalletConnect(open);
        }}
        style={[styles.btn, { backgroundColor: colors.chip }]}
        accessibilityRole="button"
        accessibilityLabel={t('connectWallet')}
      >
        <AppText style={[styles.btnText, { color: colors.text }]}>{t('connectWallet')}</AppText>
      </TouchableOpacity>
      {connected && address ? (
        <>
          <AppText style={[styles.meta, { color: colors.text }]}>{formatAddress(address)}</AppText>
          <AppText style={[styles.meta, { color: colors.textMuted }]}>
            {t('linkWalletSignNeed')}
          </AppText>
        </>
      ) : null}
      {error ? <AppText style={[styles.error, { color: colors.danger }]}>{error}</AppText> : null}
      {connected ? (
        <TouchableOpacity
          disabled={busy}
          onPress={() => void submit()}
          style={[
            styles.btn,
            { backgroundColor: connected ? colors.primary : colors.chip, marginTop: 12 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('linkWalletBind')}
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <AppText
              style={[styles.btnText, { color: connected ? colors.onPrimary : colors.textMuted }]}
            >
              {t('linkWalletBind')}
            </AppText>
          )}
        </TouchableOpacity>
      ) : null}
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
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
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
