import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import type { Signer } from 'ethers';
import { formatUnits, Interface, parseUnits } from 'ethers';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import {
  formatCountdownClock,
  formatDueDate,
  formatUSD,
  parsePositiveDecimal,
} from '../utils/formatters';
import { showNotice } from '../utils/appNotice';
import {
  RESERVA_LOCK_BUTTONS,
  RESERVA_MIN_LEVEL,
  RESERVA_MIN_LOCK_USDT,
  reservaBoostRedBp,
  reservaTramoUsd,
} from '../constants/reserva';
import {
  bloquearReserva,
  desbloquearReserva,
  loadReservaPreview,
  renovarReserva,
  reservaErrorKey,
  type ReservaPreview,
} from '../services/reservaService';
import { useFundsConfirm } from './FundsConfirmHost';
import { fundsTx, quoteNetworkFee, reservaConfirmAmount } from '../utils/fundsConfirmGate';
import { getProviderWithFallback } from '../constants/rpcConfig';
import { getReservaAddress, RESERVA_ABI } from '../constants/reservaConfig';
import { AppSubsection } from './AppSection';
import { AppText, AppTextInput } from './AppText';
import { AppIcon } from './icons';

interface ReservaSectionProps {
  walletAddress: string;
  signer: Signer | null;
  tokenSymbol: string;
  identityBlocked: boolean;
  delinquent: boolean;
  paused: boolean;
  hasPadre: boolean;
  userLevel: number;
  isLoading?: boolean;
}

export function ReservaSection({
  walletAddress,
  signer,
  tokenSymbol,
  identityBlocked,
  delinquent,
  paused,
  hasPadre,
  userLevel,
  isLoading = false,
}: ReservaSectionProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const [amount, setAmount] = useState(String(RESERVA_MIN_LOCK_USDT));
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ReservaPreview | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(() => {
    if (!walletAddress) {
      setPreview(null);
      setPreviewState('ready');
      return;
    }
    loadReservaPreview(walletAddress, hasPadre)
      .then((next) => {
        setPreview(next);
        setPreviewState('ready');
      })
      .catch(() => setPreviewState('failed'));
  }, [walletAddress, hasPadre]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const lockRemain =
    preview?.activa && preview.unlockAt ? Math.max(0, preview.unlockAt - nowSec) : 0;
  const waitingUnlock = Boolean(preview?.activa && !preview.ready && lockRemain > 0);

  useEffect(() => {
    if (!waitingUnlock) return undefined;
    const tick = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, [waitingUnlock]);

  useEffect(() => {
    if (preview?.activa && !preview.ready && lockRemain === 0) refresh();
  }, [lockRemain, preview?.activa, preview?.ready, refresh]);

  const reservaPaused = Boolean(preview?.pausedOnChain);
  const creditPaused = paused;
  const levelOk = userLevel >= RESERVA_MIN_LEVEL;
  const parsed = parsePositiveDecimal(amount);
  const lockUsd = parsed ? Number(parsed) : 0;
  const amountOk = Number.isFinite(lockUsd) && lockUsd >= RESERVA_MIN_LOCK_USDT;
  const canLock =
    Boolean(walletAddress) &&
    !busy &&
    !isLoading &&
    !identityBlocked &&
    !delinquent &&
    !creditPaused &&
    !reservaPaused &&
    levelOk &&
    acked &&
    !preview?.activa &&
    amountOk &&
    Boolean(preview?.practice || preview?.configured);
  const canUnlock =
    Boolean(walletAddress) && !busy && !isLoading && Boolean(preview?.activa && preview.ready);
  const canRenew =
    canUnlock && levelOk && !delinquent && !creditPaused && !identityBlocked && !reservaPaused;
  const amountEditable = Boolean(
    walletAddress &&
      !busy &&
      !isLoading &&
      !identityBlocked &&
      !delinquent &&
      !creditPaused &&
      !reservaPaused &&
      levelOk &&
      !preview?.activa &&
      (preview?.practice || preview?.configured)
  );

  const boostPreview = useMemo(() => {
    const usd = preview?.activa
      ? Number(formatUnits(preview.principalWei, 18))
      : amountOk
        ? lockUsd
        : 0;
    if (!Number.isFinite(usd) || usd <= 0) return null;
    const tramo = reservaTramoUsd(usd);
    const pct = reservaBoostRedBp(tramo) / 100;
    return { usd, tramo, pct };
  }, [amountOk, lockUsd, preview?.activa, preview?.principalWei]);

  async function confirmMove(
    kind: 'lock' | 'unlock' | 'renew',
    method: 'bloquear' | 'desbloquear' | 'renovar',
    args: unknown[],
    destination: string
  ) {
    const principal = preview ? formatUnits(preview.principalWei, 18) : null;
    const amount = reservaConfirmAmount(kind, parsed, principal);
    if (!amount) return false;
    let fee = 'no disponible';
    try {
      const data = new Interface(RESERVA_ABI).encodeFunctionData(method, args);
      fee = await quoteNetworkFee(getProviderWithFallback(), {
        to: getReservaAddress(),
        data,
      });
    } catch {
      fee = 'no disponible';
    }
    return confirmFunds('movement', fundsTx(amount, destination, fee));
  }

  async function run(
    action: () => Promise<void>,
    okKey: 'reservaBlockedOk' | 'reservaUnlockedOk' | 'reservaRenewedOk'
  ) {
    if (!signer) {
      showNotice(t('connect'), t('connectFirst'));
      return;
    }
    setBusy(true);
    try {
      await action();
      showNotice(t('ready'), t(okKey));
      refresh();
    } catch (error) {
      showNotice(t('error'), t(reservaErrorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.stack}>
      <AppSubsection title={t('reservaTitle')} defaultOpen icon="lock">
        <AppText style={[styles.lead, { color: colors.text }]}>{t('reservaLead')}</AppText>
        <AppText style={[styles.lead, { color: colors.text }]}>{t('reservaPotDepends')}</AppText>
        <AppText style={[styles.meta, { color: colors.textMuted }]}>{t('reservaLockOnce')}</AppText>
        <AppText style={[styles.lead, { color: colors.text }]}>
          {t('reservaCommissionLead')}
        </AppText>
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('reservaBoostComision')}
        </AppText>
        {preview?.configured ? (
          <AppText style={[styles.meta, { color: colors.textMuted }]}>
            {t('reservaBoteLabel')}: {formatUSD(Number(formatUnits(preview.boteWei, 18)))}{' '}
            {tokenSymbol}
          </AppText>
        ) : null}
        {preview?.configured && preview.apyKnown ? (
          <AppText style={[styles.meta, { color: colors.textMuted }]}>
            {t('reservaApyNow', { apy: ((preview.apyBps || 0) / 100).toFixed(2) })}
          </AppText>
        ) : null}
        {boostPreview ? (
          <AppText style={[styles.meta, { color: colors.primary }]}>
            {t('reservaYourBoost', {
              amount: formatUSD(boostPreview.usd),
              tier: String(boostPreview.tramo),
              pct: String(boostPreview.pct),
            })}
          </AppText>
        ) : null}
        {preview?.practice ? (
          <AppText style={[styles.meta, { color: colors.warnText }]}>
            {t('reservaDemoPractice')}
          </AppText>
        ) : null}
        {identityBlocked ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('reservaNeedIdentity')}
          </AppText>
        ) : null}
        {delinquent ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('reservaDelinquent')}
          </AppText>
        ) : null}
        {!levelOk && !preview?.activa ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('reservaNeedLevel')}
          </AppText>
        ) : null}
        {creditPaused || reservaPaused ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('securityPausedBanner')}
          </AppText>
        ) : null}
        {previewState === 'loading' && !preview ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        {previewState === 'failed' ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('reservaPreviewFailed')}
          </AppText>
        ) : null}
        {previewState === 'ready' &&
        !preview?.practice &&
        !preview?.configured &&
        !identityBlocked ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('reservaNoContract')}
          </AppText>
        ) : null}
        {preview?.activa ? (
          <>
            <AppText style={[styles.meta, { color: colors.primary }]}>
              {t('reservaLocked')}: {formatUSD(Number(formatUnits(preview.principalWei, 18)))}{' '}
              {tokenSymbol}
            </AppText>
            <AppText style={[styles.meta, { color: colors.textMuted }]}>
              {t('reservaUntil')}: {formatDueDate(preview.unlockAt)}
            </AppText>
            <AppText style={[styles.meta, { color: colors.textMuted }]}>
              {t('reservaYieldEst')}: {formatUSD(Number(formatUnits(preview.techoWei, 18)))}{' '}
              {tokenSymbol}
            </AppText>
          </>
        ) : null}
        {!preview?.activa ? (
          <>
            <View style={styles.row}>
              {RESERVA_LOCK_BUTTONS.map((usd) => (
                <TouchableOpacity
                  key={usd}
                  disabled={!amountEditable}
                  onPress={() => setAmount(String(usd))}
                  style={[
                    styles.chip,
                    {
                      borderColor: colors.border,
                      backgroundColor: lockUsd === usd ? colors.primary : colors.surface,
                    },
                  ]}
                >
                  <AppText
                    style={{
                      color:
                        lockUsd === usd
                          ? colors.onPrimary
                          : amountEditable
                            ? colors.text
                            : colors.textMuted,
                    }}
                  >
                    {formatUSD(usd)}
                  </AppText>
                </TouchableOpacity>
              ))}
            </View>
            <AppText style={[styles.label, { color: colors.primary }]}>
              {t('reservaAmount')} ({tokenSymbol})
            </AppText>
            <AppTextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={String(RESERVA_MIN_LOCK_USDT)}
              editable={amountEditable}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBg,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
            {parsed && !amountOk ? (
              <AppText style={[styles.warn, { color: colors.warnText }]}>
                {t('reservaMonto')}
              </AppText>
            ) : null}
          </>
        ) : null}
        {!preview?.activa ? (
          <TouchableOpacity
            onPress={() => setAcked((value) => !value)}
            style={styles.ackRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acked }}
          >
            <View
              style={[
                styles.box,
                {
                  borderColor: colors.border,
                  backgroundColor: acked ? colors.primary : colors.inputBg,
                },
              ]}
            />
            <AppText style={[styles.ack, { color: colors.text }]}>{t('reservaAck')}</AppText>
          </TouchableOpacity>
        ) : null}
        {!preview?.activa ? (
          <TouchableOpacity
            disabled={!canLock}
            onPress={() =>
              void (async () => {
                const ok = await confirmMove(
                  'lock',
                  'bloquear',
                  [parseUnits(parsed || '0', 18)],
                  getReservaAddress()
                );
                if (!ok) return;
                await run(
                  () => bloquearReserva(signer as Signer, parsed || '0', hasPadre),
                  'reservaBlockedOk'
                );
              })()
            }
            style={[styles.button, { backgroundColor: canLock ? colors.primary : colors.chip }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <View style={styles.buttonRow}>
                <AppIcon
                  name="lock"
                  size={18}
                  color={canLock ? colors.onPrimary : colors.textMuted}
                />
                <AppText
                  style={[
                    styles.buttonText,
                    { color: canLock ? colors.onPrimary : colors.textMuted },
                  ]}
                >
                  {t('reservaBlock')}
                </AppText>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              disabled={!canUnlock}
              onPress={() =>
                void (async () => {
                  const ok = await confirmMove('unlock', 'desbloquear', [], walletAddress);
                  if (!ok) return;
                  await run(() => desbloquearReserva(signer as Signer), 'reservaUnlockedOk');
                })()
              }
              style={[styles.button, { backgroundColor: canUnlock ? colors.primary : colors.chip }]}
            >
              <AppText
                style={[
                  styles.buttonText,
                  { color: canUnlock ? colors.onPrimary : colors.textMuted },
                ]}
              >
                {waitingUnlock
                  ? t('reservaUnlockWait', { clock: formatCountdownClock(lockRemain) })
                  : t('reservaUnlock')}
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!canRenew}
              onPress={() =>
                void (async () => {
                  const ok = await confirmMove('renew', 'renovar', [], getReservaAddress());
                  if (!ok) return;
                  await run(() => renovarReserva(signer as Signer, hasPadre), 'reservaRenewedOk');
                })()
              }
              style={[styles.button, { backgroundColor: canRenew ? colors.primary : colors.chip }]}
            >
              <AppText
                style={[
                  styles.buttonText,
                  { color: canRenew ? colors.onPrimary : colors.textMuted },
                ]}
              >
                {t('reservaRenew')}
              </AppText>
            </TouchableOpacity>
          </View>
        )}
      </AppSubsection>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  lead: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  meta: { fontSize: 12, lineHeight: 18, marginBottom: 6 },
  warn: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginVertical: 10 },
  box: { width: 18, height: 18, borderWidth: 1, borderRadius: 4, marginTop: 2 },
  ack: { flex: 1, fontSize: 12, lineHeight: 18 },
  button: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  actions: { gap: 8 },
});
