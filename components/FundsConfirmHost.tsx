import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { checkPassword, checkPin, loadWrapFromBiometric } from '../services/appLock';
import { verifyAuthenticator } from '../services/authenticator';
import {
  getAuthMethods,
  isAuthEnabled,
  isMethodReady,
  type AuthMethod,
  type AuthPurpose,
} from '../services/authPrefs';
import { listSecurityConfirmMethods, type FundsConfirmPurpose } from '../services/fundsConfirm';
import {
  addressEdges,
  adminConfirmPlan,
  fundsConfirmPlan,
  fundsDetailsComplete,
  type FundsTxDetails,
} from '../utils/fundsConfirmGate';
import { SecretInput } from './SecretInput';
import { AppText } from './AppText';
import type { TranslationKey } from '../i18n/translations';

interface FundsConfirmValue {
  confirmFunds: (purpose?: FundsConfirmPurpose, details?: FundsTxDetails) => Promise<boolean>;
}

const FundsConfirmContext = createContext<FundsConfirmValue | null>(null);

export const FundsConfirmHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<AuthMethod>('password');
  const [purpose, setPurpose] = useState<FundsConfirmPurpose>('transfer');
  const [tx, setTx] = useState<FundsTxDetails | null>(null);
  const [ackOnly, setAckOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
    setPin('');
    setPassword('');
    setCode('');
    setBusy(false);
    setError('');
    setTx(null);
    setAckOnly(false);
  }, []);

  const askSecret = (next: AuthMethod) =>
    new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setMethod(next);
      setOpen(true);
    });

  const confirmFunds = useCallback(
    async (nextPurpose: FundsConfirmPurpose = 'transfer', details?: FundsTxDetails) => {
      if (inflight.current) return inflight.current;
      const run = (async () => {
        if (nextPurpose === 'admin') {
          setPurpose('admin');
          setTx(details ?? null);
          setAckOnly(true);
          if (!adminConfirmPlan(details).canApprove) return false;
          return askSecret('password');
        }
        if (nextPurpose === 'security') {
          setPurpose('security');
          setTx(null);
          setAckOnly(false);
          const queue = await listSecurityConfirmMethods();
          if (!queue.length) return false;
          for (const chosen of queue) {
            if (chosen === 'biometric') {
              if (await loadWrapFromBiometric()) return true;
              continue;
            }
            return askSecret(chosen);
          }
          return false;
        }
        const slot: AuthPurpose =
          nextPurpose === 'transfer' || nextPurpose === 'movement' ? 'funds' : nextPurpose;
        const protectionOn = await isAuthEnabled(slot);
        const plan = fundsConfirmPlan({ movesFunds: true, protectionOn, details });
        setPurpose(nextPurpose);
        setTx(details ?? null);
        setAckOnly(plan.mode === 'button');
        if (plan.mode === 'button') return askSecret('password');
        const preferred = await getAuthMethods(slot);
        const queue: AuthMethod[] = [];
        for (const method of preferred) {
          if (await isMethodReady(method)) queue.push(method);
        }
        if (!queue.length) return false;
        for (const chosen of queue) {
          const ok = await askSecret(chosen);
          if (!ok) return false;
        }
        return plan.canApprove;
      })();
      inflight.current = run;
      try {
        return await run;
      } finally {
        inflight.current = null;
      }
    },
    []
  );

  const submitSecret = async () => {
    if (busy) return;
    if (
      purpose !== 'security' &&
      purpose !== 'admin' &&
      !fundsConfirmPlan({
        movesFunds: true,
        protectionOn: !ackOnly,
        details: tx,
      }).canApprove
    ) {
      return;
    }
    if (ackOnly) {
      finish(true);
      return;
    }
    if (method === 'biometric') {
      setBusy(true);
      const wrap = await loadWrapFromBiometric();
      setBusy(false);
      if (!wrap) {
        setError(t('fundsConfirmBiometricFail'));
        return;
      }
      finish(true);
      return;
    }
    if (method === 'pin') {
      if (pin.length < 6 || pin.length > 12) return;
      setBusy(true);
      const checked = await checkPin(pin);
      if (!checked.ok) {
        setError(
          checked.locked
            ? t('lockCooldown', { seconds: Math.ceil(checked.remainingMs / 1000) })
            : t('lockPinWrong')
        );
        setPin('');
        setBusy(false);
        return;
      }
      finish(true);
      return;
    }
    if (method === 'authenticator') {
      if (code.length !== 6) return;
      setBusy(true);
      const ok = await verifyAuthenticator(code);
      if (!ok) {
        setError(t('authenticatorWrong'));
        setCode('');
        setBusy(false);
        return;
      }
      finish(true);
      return;
    }
    if (!password) return;
    setBusy(true);
    const checked = await checkPassword(password);
    if (!checked.ok) {
      setError(
        checked.locked
          ? t('lockCooldown', { seconds: Math.ceil(checked.remainingMs / 1000) })
          : t('lockPasswordWrong')
      );
      setPassword('');
      setBusy(false);
      return;
    }
    finish(true);
  };

  const value = useMemo(() => ({ confirmFunds }), [confirmFunds]);
  const titleKey: TranslationKey =
    purpose === 'loanRequest'
      ? 'loanConfirmRequestTitle'
      : purpose === 'loanPay'
        ? 'loanConfirmPayTitle'
        : purpose === 'security'
          ? 'securityConfirmTitle'
          : purpose === 'movement'
            ? 'fundsConfirmMovement'
            : purpose === 'admin'
              ? 'adminConfirmTitle'
              : 'fundsConfirmTitle';
  const prompt =
    method === 'pin'
      ? t('fundsConfirmPrompt')
      : method === 'authenticator'
        ? t('fundsConfirmPromptAuth')
        : t('fundsConfirmPromptPassword');
  const moneyOk =
    purpose === 'security' ||
    (purpose === 'admin' ? adminConfirmPlan(tx).canApprove : fundsDetailsComplete(tx));
  const edges = tx ? addressEdges(tx.destination) : null;
  const canSubmit = !moneyOk
    ? false
    : ackOnly || method === 'biometric'
      ? true
      : method === 'pin'
        ? pin.length >= 6 && pin.length <= 12
        : method === 'authenticator'
          ? code.length === 6
          : Boolean(password);

  return (
    <FundsConfirmContext.Provider value={value}>
      {children}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => finish(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <AppText style={[styles.title, { color: colors.text }]}>{t(titleKey)}</AppText>
            {purpose === 'admin' && tx ? (
              <View style={styles.tx}>
                <AppText style={{ color: colors.text }}>{tx.action}</AppText>
                <AppText style={{ color: colors.text }}>{tx.target}</AppText>
              </View>
            ) : tx ? (
              <View style={styles.tx}>
                <AppText style={{ color: colors.text }}>
                  {t('fundsTxAmount', { amount: tx.amount, symbol: tx.symbol })}
                </AppText>
                <AppText style={{ color: colors.text }}>
                  {t('fundsTxDestination')}{' '}
                  {edges ? (
                    <AppText style={{ color: colors.text }}>
                      <AppText style={styles.edge}>{edges.start}</AppText>
                      {edges.full.slice(6, -4)}
                      <AppText style={styles.edge}>{edges.end}</AppText>
                    </AppText>
                  ) : (
                    tx.destination || '—'
                  )}
                </AppText>
                <AppText style={{ color: colors.textMuted }}>
                  {t('fundsTxFee', { fee: tx.fee })}
                </AppText>
                {tx.twoSignatures ? (
                  <AppText style={{ color: colors.text }}>{t('fundsTwoSignatures')}</AppText>
                ) : null}
              </View>
            ) : null}
            <AppText style={[styles.lead, { color: colors.textMuted }]}>
              {ackOnly ? t('fundsConfirmAckLead') : prompt}
            </AppText>
            {ackOnly || method === 'biometric' ? null : method === 'pin' ? (
              <SecretInput
                value={pin}
                onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 12))}
                keyboardType="number-pad"
                maxLength={12}
                placeholder="••••••"
              />
            ) : method === 'authenticator' ? (
              <SecretInput
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder={t('authenticatorCode')}
              />
            ) : (
              <SecretInput
                value={password}
                onChangeText={setPassword}
                placeholder={t('lockCurrentPassword')}
              />
            )}
            {error ? (
              <AppText style={[styles.error, { color: colors.danger }]}>{error}</AppText>
            ) : null}
            <TouchableOpacity
              disabled={busy || !canSubmit}
              onPress={() => void submitSecret()}
              style={[styles.button, { backgroundColor: colors.connect }]}
            >
              {busy ? (
                <>
                  <ActivityIndicator color="#111" />
                  <AppText style={styles.buttonText}>{t('lockKdfWait')}</AppText>
                </>
              ) : (
                <AppText style={styles.buttonText}>
                  {ackOnly ? t('fundsConfirmAck') : t('ready')}
                </AppText>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => finish(false)}>
              <AppText style={[styles.cancel, { color: colors.textMuted }]}>
                {t('fundsConfirmCancel')}
              </AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </FundsConfirmContext.Provider>
  );
};

export function useFundsConfirm(): FundsConfirmValue {
  const ctx = useContext(FundsConfirmContext);
  if (!ctx) {
    throw new Error('useFundsConfirm must be used inside FundsConfirmHost');
  }
  return ctx;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  tx: {
    marginTop: 12,
    gap: 4,
  },
  edge: {
    fontWeight: '800',
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 14,
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  cancel: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});
