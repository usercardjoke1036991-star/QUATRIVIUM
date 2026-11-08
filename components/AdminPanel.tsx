import { formatUnits, isAddress } from 'ethers';
import React, { useEffect, useState } from 'react';
import { QuatriviumCreditService } from '../services/quatriviumCreditService';
import { leerPendienteRetiroBote, type RetiroBotePendiente } from '../services/reservaService';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon } from './icons';
import { formatAddress } from '../utils/formatters';
import type { OpenAdminProposal } from '../utils/adminProposal';
import type { ConfigurableStable } from '../constants/tokens';
import { AppText, AppTextInput } from './AppText';

interface AdminPanelProps {
  isOwner: boolean;
  isAdmin?: boolean;
  isLoading: boolean;
  paused?: boolean;
  tokenSymbol: string;
  tokenAddress?: string;
  adminRoster?: string[];
  requiredConfirmations?: number;
  proposalCount?: number;
  openProposal?: OpenAdminProposal | null;
  founderAddress?: string;
  ownerAddress?: string;
  extraStables?: ConfigurableStable[];
  onWithdrawFees: () => void;
  onWithdrawTokenFees: () => void;
  onExecuteProposal?: (id: number) => void;
  onConfirmProposal?: (id: number) => void;
  onCancelProposal?: (id: number) => void;
  onProposeAddAdmin?: (address: string) => void;
  onProposeRemoveAdmin?: (address: string) => void;
  onProposeFeeCollector?: (address: string) => void;
  onProposeConfirmations?: (required: number) => void;
  onProposeFundador?: (address: string) => void;
  onProposeOwner?: (address: string) => void;
  onProposeSetTokenConfig?: (token: string, feed: string, enabled: boolean) => void;
  onLiquidar?: (debtorAddress: string, tokenAddress: string) => void;
  onMarcarMoroso?: (debtorAddress: string) => void;
  onAportarReserva?: (amount: string) => void;
  onProponerRetiroReserva?: (amount: string, destino: string) => void;
  onAplicarRetiroReserva?: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  isOwner,
  isAdmin = false,
  isLoading,
  tokenSymbol,
  tokenAddress = '',
  adminRoster = [],
  requiredConfirmations = 1,
  proposalCount = 0,
  openProposal = null,
  founderAddress = '',
  extraStables = [],
  onWithdrawFees,
  onWithdrawTokenFees,
  onExecuteProposal,
  onConfirmProposal,
  onCancelProposal,
  onProposeAddAdmin,
  onProposeRemoveAdmin,
  onProposeFeeCollector,
  onProposeConfirmations,
  onProposeFundador,
  onProposeOwner,
  onProposeSetTokenConfig,
  onLiquidar,
  onMarcarMoroso,
  onAportarReserva,
  onProponerRetiroReserva,
  onAplicarRetiroReserva,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [debtorDraft, setDebtorDraft] = useState('');
  const [reservaPot, setReservaPot] = useState('100');
  const [retiroMonto, setRetiroMonto] = useState('');
  const [retiroDestino, setRetiroDestino] = useState('');
  const [retiroPendiente, setRetiroPendiente] = useState<RetiroBotePendiente | null>(null);
  const [retiroUnread, setRetiroUnread] = useState(false);
  const [salud, setSalud] = useState<{
    cash: bigint;
    outstanding: bigint;
    reservaBote: bigint | null;
    reservaLocked: bigint | null;
    reservaApyBps: number | null;
  } | null>(null);
  useEffect(() => {
    if ((!isOwner && !isAdmin) || !tokenAddress) return;
    void QuatriviumCreditService.obtenerSaludAdmin(tokenAddress)
      .then((row) => {
        if (!row) return;
        setSalud((prev) => ({
          cash: row.cash,
          outstanding: row.outstanding,
          reservaBote: row.reservaBote ?? prev?.reservaBote ?? null,
          reservaLocked: row.reservaLocked ?? prev?.reservaLocked ?? null,
          reservaApyBps: row.reservaApyBps ?? prev?.reservaApyBps ?? null,
        }));
      })
      .catch(() => {});
    void leerPendienteRetiroBote()
      .then((row) => {
        setRetiroPendiente(row);
        setRetiroUnread(false);
      })
      .catch(() => setRetiroUnread(true));
  }, [isOwner, isAdmin, tokenAddress, isLoading]);
  if (!isOwner && !isAdmin) return null;

  const confirmToggle = (next: boolean, apply: (value: boolean) => void) => {
    Alert.alert(t('admin'), t('adminTimelockConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('ready'), onPress: () => apply(next) },
    ]);
  };

  const confirmWithdrawBnb = () => {
    Alert.alert(t('withdrawBnb'), t('confirmWithdrawBnb'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('withdrawBnb'), style: 'destructive', onPress: onWithdrawFees },
    ]);
  };

  const confirmWithdrawToken = () => {
    Alert.alert(t('withdrawFees'), t('confirmWithdrawFees'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('withdrawFees'), style: 'destructive', onPress: onWithdrawTokenFees },
    ]);
  };

  const trimmed = draft.trim();

  const proposeWithAddress = (fn?: (address: string) => void) => {
    if (!fn) return;
    if (!isAddress(trimmed)) {
      Alert.alert(t('admin'), t('adminInvalidAddress'));
      return;
    }
    confirmToggle(true, () => {
      fn(trimmed);
      setDraft('');
    });
  };

  return (
    <View>
      <AppText style={[styles.note, { color: colors.textMuted }]}>{t('adminLead')}</AppText>
      {salud ? (
        <>
          <AppText style={[styles.meta, { color: colors.text }]}>
            {t('adminPoolHealth', {
              cash: formatUnits(salud.cash, 18),
              out: formatUnits(salud.outstanding, 18),
            })}
          </AppText>
          {salud.reservaBote !== null &&
          salud.reservaLocked !== null &&
          salud.reservaApyBps !== null ? (
            <AppText style={[styles.meta, { color: colors.text }]}>
              {t('adminReservaHealth', {
                bote: formatUnits(salud.reservaBote, 18),
                locked: formatUnits(salud.reservaLocked, 18),
                apy: (salud.reservaApyBps / 100).toFixed(2),
              })}
            </AppText>
          ) : null}
        </>
      ) : null}
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t('adminRoster', {
          count: adminRoster.length,
          confirms: requiredConfirmations,
          proposal: proposalCount,
        })}
      </AppText>
      {adminRoster.map((item) => {
        const isFounderWallet =
          founderAddress && item.toLowerCase() === founderAddress.toLowerCase();
        return (
          <AppText key={item} style={[styles.meta, { color: colors.text }]}>
            {formatAddress(item)} ·{' '}
            {isFounderWallet ? t('adminRoleFounder') : t('adminRoleCofounder')}
          </AppText>
        );
      })}

      <AppText style={[styles.note, { color: colors.textMuted }]}>
        {t('adminAddFoundersLead')}
      </AppText>
      <AppTextInput
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('adminAddressPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      {onProposeAddAdmin && adminRoster.length < 3 ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => proposeWithAddress(onProposeAddAdmin)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>{t('adminAdd')}</AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeRemoveAdmin ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => proposeWithAddress(onProposeRemoveAdmin)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>{t('adminRemove')}</AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeFundador ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => proposeWithAddress(onProposeFundador)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>
            {t('adminSetFundador')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeOwner ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => proposeWithAddress(onProposeOwner)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>
            {t('adminSetOwner')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeFeeCollector ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => proposeWithAddress(onProposeFeeCollector)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>
            {t('adminFeeCollector')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeConfirmations && adminRoster.length < 3 ? (
        <View style={styles.row}>
          <TouchableOpacity
            disabled={isLoading}
            onPress={() => confirmToggle(true, () => onProposeConfirmations(1))}
            style={[styles.button, styles.half, { backgroundColor: colors.chip }]}
          >
            <AppText style={[styles.buttonText, { color: colors.text }]}>
              {t('adminConfirms1')}
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={isLoading}
            onPress={() => confirmToggle(true, () => onProposeConfirmations(2))}
            style={[styles.button, styles.half, { backgroundColor: colors.chip }]}
          >
            <AppText style={[styles.buttonText, { color: colors.text }]}>
              {t('adminConfirms2')}
            </AppText>
          </TouchableOpacity>
        </View>
      ) : null}
      {adminRoster.length >= 3 ? (
        <AppText style={[styles.note, { color: colors.textMuted }]}>{t('adminTwoOfThree')}</AppText>
      ) : null}
      {onProposeSetTokenConfig && extraStables.length ? (
        <>
          <AppText style={[styles.note, { color: colors.textMuted }]}>
            {t('adminEnableTokenLead')}
          </AppText>
          {extraStables.map((stable) => (
            <TouchableOpacity
              key={stable.address}
              disabled={isLoading}
              onPress={() =>
                confirmToggle(true, () =>
                  onProposeSetTokenConfig(stable.address, stable.feed, true)
                )
              }
              style={[styles.button, { backgroundColor: colors.chip }]}
            >
              <AppText style={[styles.buttonText, { color: colors.text }]}>
                {t('adminEnableToken', { symbol: stable.symbol })}
              </AppText>
            </TouchableOpacity>
          ))}
        </>
      ) : null}
      {openProposal ? (
        <AppText style={[styles.meta, { color: colors.text }]}>
          {t('adminProposalMeta', {
            id: openProposal.id,
            selector: openProposal.selector,
            confirms: openProposal.confirms,
            when:
              openProposal.eta * 1000 <= Date.now()
                ? t('adminProposalReady')
                : new Date(openProposal.eta * 1000).toLocaleString(),
          })}
        </AppText>
      ) : (
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('adminProposalNone')}
        </AppText>
      )}
      {isAdmin && onConfirmProposal && openProposal ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => onConfirmProposal(openProposal.id)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>
            {t('confirmAdminProposal')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {isAdmin && onExecuteProposal && openProposal ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => onExecuteProposal(openProposal.id)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <AppText style={[styles.buttonText, { color: colors.text }]}>
              {t('executeAdminProposal')}
            </AppText>
          )}
        </TouchableOpacity>
      ) : null}
      {isAdmin && onCancelProposal && openProposal ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => onCancelProposal(openProposal.id)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>
            {t('cancelAdminProposal')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {onAportarReserva ? (
        <>
          <AppText style={[styles.note, { color: colors.textMuted, marginTop: 16 }]}>
            {t('reservaAdminPotTitle')}
          </AppText>
          <AppText style={[styles.meta, { color: colors.textMuted }]}>
            {t('reservaAdminPotHint')}
          </AppText>
          <AppTextInput
            value={reservaPot}
            onChangeText={setReservaPot}
            keyboardType="decimal-pad"
            placeholder="100"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          <TouchableOpacity
            disabled={isLoading}
            onPress={() => onAportarReserva(reservaPot)}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <AppText style={[styles.buttonText, { color: colors.onPrimary }]}>
                {t('reservaAdminPot')}
              </AppText>
            )}
          </TouchableOpacity>
          {onProponerRetiroReserva ? (
            <>
              <AppText style={[styles.note, { color: colors.textMuted, marginTop: 8 }]}>
                {t('reservaRetiroTitle')}
              </AppText>
              <AppText style={[styles.meta, { color: colors.textMuted }]}>
                {t('reservaRetiroHint')}
              </AppText>
              {retiroPendiente ? (
                <AppText style={[styles.meta, { color: colors.text }]}>
                  {t('reservaRetiroPending', {
                    amount: formatUnits(retiroPendiente.amountWei, 18),
                    address: formatAddress(retiroPendiente.to),
                    when: new Date((retiroPendiente.desde + 72 * 60 * 60) * 1000).toLocaleString(),
                  })}
                </AppText>
              ) : retiroUnread ? null : (
                <AppText style={[styles.meta, { color: colors.textMuted }]}>
                  {t('reservaRetiroNone')}
                </AppText>
              )}
              {retiroUnread ? (
                <AppText style={[styles.meta, { color: colors.warnText }]}>
                  {t('reservaPreviewFailed')}
                </AppText>
              ) : null}
              <AppTextInput
                value={retiroMonto}
                onChangeText={setRetiroMonto}
                keyboardType="decimal-pad"
                placeholder={t('amount')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              />
              <AppTextInput
                value={retiroDestino}
                onChangeText={setRetiroDestino}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('reservaRetiroDestino')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              />
              <TouchableOpacity
                disabled={isLoading}
                onPress={() => {
                  const amount = retiroMonto.trim();
                  const destino = retiroDestino.trim();
                  if (!amount || Number(amount) <= 0) {
                    Alert.alert(t('amount'), t('amountGreaterZero'));
                    return;
                  }
                  if (!isAddress(destino)) {
                    Alert.alert(t('admin'), t('adminInvalidAddress'));
                    return;
                  }
                  Alert.alert(
                    t('reservaRetiroTitle'),
                    t('reservaRetiroConfirm', { amount, address: destino }),
                    [
                      { text: t('cancel'), style: 'cancel' },
                      { text: t('ready'), onPress: () => onProponerRetiroReserva(amount, destino) },
                    ]
                  );
                }}
                style={[styles.button, { backgroundColor: colors.chip }]}
              >
                <AppText style={[styles.buttonText, { color: colors.text }]}>
                  {t('reservaRetiroPropose')}
                </AppText>
              </TouchableOpacity>
              {onAplicarRetiroReserva && retiroPendiente ? (
                <TouchableOpacity
                  disabled={isLoading}
                  onPress={() => {
                    Alert.alert(
                      t('reservaRetiroTitle'),
                      t('reservaRetiroApplyConfirm', {
                        amount: formatUnits(retiroPendiente.amountWei, 18),
                        address: retiroPendiente.to,
                      }),
                      [
                        { text: t('cancel'), style: 'cancel' },
                        { text: t('ready'), onPress: () => onAplicarRetiroReserva() },
                      ]
                    );
                  }}
                  style={[styles.button, { backgroundColor: colors.primary }]}
                >
                  <AppText style={[styles.buttonText, { color: colors.onPrimary }]}>
                    {t('reservaRetiroApply')}
                  </AppText>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {onLiquidar || onMarcarMoroso ? (
        <>
          <AppText style={[styles.note, { color: colors.textMuted, marginTop: 16 }]}>
            {t('liquidarTitle')}
          </AppText>
          <AppText style={[styles.meta, { color: colors.textMuted }]}>{t('liquidarLead')}</AppText>
          <AppTextInput
            value={debtorDraft}
            onChangeText={setDebtorDraft}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('liquidarAddressPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          {onMarcarMoroso ? (
            <TouchableOpacity
              disabled={isLoading}
              onPress={() => {
                const addr = debtorDraft.trim();
                if (!isAddress(addr)) {
                  Alert.alert(t('admin'), t('adminInvalidAddress'));
                  return;
                }
                Alert.alert(t('liquidarTitle'), t('marcarMorosoConfirm'), [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('ready'),
                    onPress: () => {
                      onMarcarMoroso(addr);
                      setDebtorDraft('');
                    },
                  },
                ]);
              }}
              style={[styles.button, { backgroundColor: colors.chip }]}
            >
              <AppText style={[styles.buttonText, { color: colors.text }]}>
                {t('marcarMorosoBtn')}
              </AppText>
            </TouchableOpacity>
          ) : null}
          {onLiquidar && tokenAddress ? (
            <TouchableOpacity
              disabled={isLoading}
              onPress={() => {
                const addr = debtorDraft.trim();
                if (!isAddress(addr)) {
                  Alert.alert(t('admin'), t('adminInvalidAddress'));
                  return;
                }
                Alert.alert(t('liquidarTitle'), t('liquidarConfirm'), [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('ready'),
                    style: 'destructive',
                    onPress: () => {
                      onLiquidar(addr, tokenAddress);
                      setDebtorDraft('');
                    },
                  },
                ]);
              }}
              style={[styles.button, { backgroundColor: '#B42318' }]}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={styles.btnRow}>
                  <AppIcon name="warning" size={16} color="#fff" />
                  <AppText style={styles.buttonText}>
                    {t('liquidarBtn')} ({tokenSymbol})
                  </AppText>
                </View>
              )}
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
      {isOwner ? (
        <>
          <TouchableOpacity
            disabled={isLoading}
            onPress={confirmWithdrawBnb}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <View style={styles.btnRow}>
                <AppIcon name="withdraw" size={16} color={colors.onPrimary} />
                <AppText style={[styles.buttonText, { color: colors.onPrimary }]}>
                  {t('withdrawBnb')}
                </AppText>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            disabled={isLoading}
            onPress={confirmWithdrawToken}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <View style={styles.btnRow}>
                <AppIcon name="withdraw" size={16} color={colors.onPrimary} />
                <AppText style={[styles.buttonText, { color: colors.onPrimary }]}>
                  {t('withdrawFees')} ({tokenSymbol})
                </AppText>
              </View>
            )}
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  note: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  meta: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 8,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  half: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
