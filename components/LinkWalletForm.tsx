import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { formatUnits } from 'ethers';
import { useI18n } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useTheme } from '../theme/ThemeContext';
import * as linkedWallet from '../services/linkedWallet';
import {
  LINK_TTL_SECONDS,
  checkExternalAddress,
  checkLinkChallenge,
  clearLinkChallenge,
  createLinkChallenge,
  loadLinkChallenge,
  saveLinkChallenge,
  usedLinkAmounts,
  type LinkChallenge,
  type LinkCheck,
} from '../services/linkChallenge';
import { getSupportedTokens } from '../constants/tokens';
import { isDemoMode } from '../constants/rpcConfig';
import { copyText } from '../utils/copyText';
import { formatAddress } from '../utils/formatters';
import { useFundsConfirm } from './FundsConfirmHost';
import { AppText, AppTextInput } from './AppText';
interface LinkWalletFormProps {
  internalWallet: string;
  onLinked: (externalWallet: string) => void | Promise<void>;
  allowSkip?: boolean;
}
const STATUS_KEY: Record<Exclude<LinkCheck['status'], 'linked'>, TranslationKey> = {
  waiting: 'linkTestWaiting',
  unconfirmed: 'linkTestUnconfirmed',
  expired: 'linkTestExpired',
  offline: 'linkTestOffline',
};
/**
 * Vincula la billetera de retiro con una transferencia de prueba: un monto único de LUSD
 * desde esa billetera a la de la app. El monto se queda en la billetera de la app.
 */
export const LinkWalletForm: React.FC<LinkWalletFormProps> = ({
  internalWallet,
  onLinked,
  allowSkip = true,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const [typed, setTyped] = useState('');
  const [challenge, setChallenge] = useState<LinkChallenge | null>(null);
  const [status, setStatus] = useState<TranslationKey | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const token = getSupportedTokens()[0];
  const verify = async (current: LinkChallenge) => {
    setBusy(true);
    setError('');
    try {
      const result = await checkLinkChallenge(current);
      if (result.status !== 'linked') {
        setStatus(STATUS_KEY[result.status]);
        return;
      }
      setStatus('');
      // Vincular o cambiar la billetera de retiro también pide la clave de la app.
      if (!(await confirmFunds('security'))) return;
      const saved = await linkedWallet.saveLinkedExternalWallet(internalWallet, result.proof);
      await clearLinkChallenge(internalWallet);
      setChallenge(null);
      setTyped('');
      await onLinked(saved);
    } catch {
      setStatus('linkTestOffline');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!internalWallet) return undefined;
    let live = true;
    // Reanudar: si la app se cerró a mitad de la prueba, se retoma y se comprueba una vez.
    void loadLinkChallenge(internalWallet).then((stored) => {
      if (!live || !stored) return;
      setChallenge(stored);
      void verify(stored);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalWallet]);
  const start = async () => {
    if (busy) return;
    const check = checkExternalAddress(internalWallet, typed);
    if (!check.ok) {
      setError(t(check.error));
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const next = await createLinkChallenge({
        internal: internalWallet,
        external: check.address,
        token: token.address,
        decimals: token.decimals,
        used: await usedLinkAmounts(internalWallet),
      });
      await saveLinkChallenge(next);
      setChallenge(next);
    } catch {
      setError(t('linkTestOffline'));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (busy) return;
    await clearLinkChallenge(internalWallet);
    setChallenge(null);
    setStatus('');
    setError('');
  };
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
  const copy = (value: string) => {
    void copyText(value).then((result) => {
      if (result === 'copied') Alert.alert(t('ready'), value);
      else if (result === 'failed') Alert.alert(t('wallet'), value);
    });
  };
  const network = (
    <AppText style={[styles.meta, { color: colors.warnText }]}>
      {t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')}
    </AppText>
  );
  if (challenge) {
    const amount = formatUnits(BigInt(challenge.amountWei), challenge.decimals);
    const expired = status === 'linkTestExpired';
    return (
      <View>
        <AppText style={[styles.lead, { color: colors.text }]}>
          {t('linkTestSend', {
            from: formatAddress(challenge.external),
            amount,
            symbol: token.symbol,
            minutes: String(Math.round(LINK_TTL_SECONDS / 60)),
          })}
        </AppText>
        {network}
        <AppText selectable style={[styles.amount, { color: colors.text }]}>
          {amount} {token.symbol}
        </AppText>
        <TouchableOpacity
          onPress={() => copy(amount)}
          style={[styles.btn, { backgroundColor: colors.chip }]}
          accessibilityRole="button"
          accessibilityLabel={t('linkTestCopyAmount')}
        >
          <AppText style={[styles.btnText, { color: colors.text }]}>
            {t('linkTestCopyAmount')}
          </AppText>
        </TouchableOpacity>
        <AppText selectable style={[styles.address, { color: colors.text }]}>
          {challenge.internal}
        </AppText>
        <TouchableOpacity
          onPress={() => copy(challenge.internal)}
          style={[styles.btn, { backgroundColor: colors.chip }]}
          accessibilityRole="button"
          accessibilityLabel={t('copyAddress')}
        >
          <AppText style={[styles.btnText, { color: colors.text }]}>{t('copyAddress')}</AppText>
        </TouchableOpacity>
        <AppText style={[styles.meta, { color: colors.textMuted }]}>{t('linkTestKept')}</AppText>
        {status ? (
          <AppText style={[styles.error, { color: colors.warnText }]}>{t(status)}</AppText>
        ) : null}
        <TouchableOpacity
          disabled={busy}
          onPress={() => (expired ? void cancel() : void verify(challenge))}
          style={[
            styles.btn,
            { backgroundColor: busy ? colors.chip : colors.primary, marginTop: 12 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t(expired ? 'linkTestStart' : 'linkTestVerify')}
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <AppText style={[styles.btnText, { color: colors.onPrimary }]}>
              {t(expired ? 'linkTestStart' : 'linkTestVerify')}
            </AppText>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          disabled={busy}
          onPress={() => void cancel()}
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel={t('linkTestCancel')}
        >
          <AppText style={[styles.skipText, { color: colors.textMuted }]}>
            {t('linkTestCancel')}
          </AppText>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('linkTestLead')}</AppText>
      {network}
      <AppText style={[styles.label, { color: colors.text }]}>
        {t('linkWalletAddressLabel')}
      </AppText>
      <AppTextInput
        value={typed}
        onChangeText={(next) => {
          setError('');
          setTyped(next);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="0x…"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('linkWalletAddressLabel')}
        style={[
          styles.input,
          { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
        ]}
      />
      {error ? <AppText style={[styles.error, { color: colors.danger }]}>{error}</AppText> : null}
      <TouchableOpacity
        disabled={busy || !typed}
        onPress={() => void start()}
        style={[
          styles.btn,
          { backgroundColor: busy || !typed ? colors.chip : colors.primary, marginTop: 12 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('linkTestStart')}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <AppText
            style={[
              styles.btnText,
              { color: busy || !typed ? colors.textMuted : colors.onPrimary },
            ]}
          >
            {t('linkTestStart')}
          </AppText>
        )}
      </TouchableOpacity>
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
    marginTop: 8,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  amount: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
  },
  address: {
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 12,
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
