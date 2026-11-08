import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAccount, useAppKit, useProvider } from '@reown/appkit-react-native';
import type { Eip1193Provider } from 'ethers';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { formatAddress } from '../utils/formatters';
import {
  hasLinkedExternalWallet,
  loadRequiredExternalWallet,
  proveAndSaveLinkedWallet,
} from '../services/linkedWallet';
import { openWalletConnect, withWalletSignTimeout } from '../utils/openWalletConnect';
import { isDemoMode } from '../constants/rpcConfig';
import { useAppMode } from '../wallet/AppModeContext';
import { AppText } from './AppText';

interface LinkedWalletCardProps {
  internalWallet: string;
  compact?: boolean;
}

export function LinkedWalletCard({ internalWallet, compact = false }: LinkedWalletCardProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { provider } = useProvider();
  const { mode } = useAppMode();
  const [linked, setLinked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!internalWallet) return undefined;
    let live = true;
    loadRequiredExternalWallet(internalWallet)
      .then((stored) => {
        if (live) setLinked(stored);
      })
      .catch(() => {
        if (live) setLinked('');
      });
    return () => {
      live = false;
    };
  }, [internalWallet, address, isConnected, mode]);

  const saveConnected = async () => {
    if (!hasLinkedExternalWallet(address || '')) {
      await openWalletConnect(open);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await withWalletSignTimeout(
        proveAndSaveLinkedWallet(provider as Eip1193Provider, internalWallet, address || ''),
        45000
      );
      setLinked(saved);
    } catch (caught) {
      const message = String((caught as Error)?.message || '');
      const wrongNetwork = message.includes('wrong-network') || message.includes('chainId');
      setError(
        wrongNetwork
          ? t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')
          : t('linkWalletSignNeed')
      );
    } finally {
      setBusy(false);
    }
  };

  const connectedReady = hasLinkedExternalWallet(address || '');
  const sessionLive = Boolean(isConnected && connectedReady);
  const mismatch = Boolean(
    linked && sessionLive && String(address).toLowerCase() !== linked.toLowerCase()
  );
  const looksBound = Boolean(linked && sessionLive && !mismatch);
  const boundLabel = looksBound
    ? 'linkWalletBound'
    : linked
      ? 'linkWalletReconnect'
      : 'linkWalletBind';

  return (
    <View
      style={[
        styles.box,
        compact ? styles.compact : null,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      <AppText style={[styles.title, { color: colors.text }]}>{t('wallet')}</AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')}
      </AppText>
      {linked ? (
        <AppText selectable style={[styles.lead, { color: colors.textMuted }]}>
          {formatAddress(linked)}
        </AppText>
      ) : null}
      {linked && !sessionLive ? (
        <AppText style={[styles.meta, { color: colors.warnText }]}>
          {t('linkWalletSessionOff')}
        </AppText>
      ) : null}
      {mismatch ? (
        <AppText style={[styles.meta, { color: colors.warnText }]}>
          {t('linkWalletMismatch')}
        </AppText>
      ) : null}
      {error ? <AppText style={[styles.meta, { color: colors.warnText }]}>{error}</AppText> : null}
      <TouchableOpacity
        disabled={busy}
        onPress={() => (looksBound ? void openWalletConnect(open) : void saveConnected())}
        style={[styles.btn, { backgroundColor: looksBound ? colors.chip : colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel={t(boundLabel)}
      >
        {busy ? (
          <ActivityIndicator color={looksBound ? colors.text : colors.onPrimary} />
        ) : (
          <AppText style={[styles.btnText, { color: looksBound ? colors.text : colors.onPrimary }]}>
            {t(boundLabel)}
          </AppText>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  compact: {
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    fontSize: 12,
    lineHeight: 17,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
