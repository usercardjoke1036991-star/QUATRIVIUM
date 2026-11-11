import { formatUnits, isAddress } from 'ethers';
import React, { useEffect, useState } from 'react';
import { QuatriviumCreditService } from '../services/quatriviumCreditService';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon } from './icons';
import { formatAddress } from '../utils/formatters';
import type { OpenAdminProposal } from '../utils/adminProposal';
import { AppText, AppTextInput } from './AppText';
import { useFundsConfirm } from './FundsConfirmHost';

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
  onExecuteProposal?: (id: number) => void;
  onConfirmProposal?: (id: number) => void;
  onCancelProposal?: (id: number) => void;
  onProposeAddAdmin?: (address: string) => void;
  onProposeRemoveAdmin?: (address: string) => void;
  onProposeFundador?: (address: string) => void;
  onLiquidar?: (debtorAddress: string, tokenAddress: string) => void;
  onMarcarMoroso?: (debtorAddress: string) => void;
  onAportarReserva?: (amount: string) => void;
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
  onExecuteProposal,
  onConfirmProposal,
  onCancelProposal,
  onProposeAddAdmin,
  onProposeRemoveAdmin,
  onProposeFundador,
  onLiquidar,
  onMarcarMoroso,
  onAportarReserva,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const [draft, setDraft] = useState('');
  const [debtorDraft, setDebtorDraft] = useState('');
  const [reservaPot, setReservaPot] = useState('100');
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
  }, [isOwner, isAdmin, tokenAddress, isLoading]);
  if (!isOwner && !isAdmin) return null;

  const trimmed = draft.trim();

  const askAdmin = async (action: string, target: string) =>
    confirmFunds('admin', {
      amount: '',
      symbol: '',
      destination: target,
      fee: '',
      action,
      target,
    });

  const proposeWithAddress = async (action: string, fn?: (address: string) => void) => {
    if (!fn) return;
    if (!isAddress(trimmed)) {
      Alert.alert(t('admin'), t('adminInvalidAddress'));
      return;
    }
    if (!(await askAdmin(action, trimmed))) return;
    fn(trimmed);
    setDraft('');
  };

  const runProposal = async (action: string) => {
    if (!openProposal) return false;
    return askAdmin(action, `${openProposal.id} ${openProposal.selector}`);
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
          onPress={() => void proposeWithAddress(t('adminAdd'), onProposeAddAdmin)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>{t('adminAdd')}</AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeRemoveAdmin ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => void proposeWithAddress(t('adminRemove'), onProposeRemoveAdmin)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>{t('adminRemove')}</AppText>
        </TouchableOpacity>
      ) : null}
      {onProposeFundador ? (
        <TouchableOpacity
          disabled={isLoading}
          onPress={() => void proposeWithAddress(t('adminSetFundador'), onProposeFundador)}
          style={[styles.button, { backgroundColor: colors.chip }]}
        >
          <AppText style={[styles.buttonText, { color: colors.text }]}>
            {t('adminSetFundador')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {adminRoster.length >= 3 ? (
        <AppText style={[styles.note, { color: colors.textMuted }]}>{t('adminTwoOfThree')}</AppText>
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
          onPress={() =>
            void runProposal(t('confirmAdminProposal')).then((ok) => {
              if (ok) onConfirmProposal(openProposal.id);
            })
          }
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
          onPress={() =>
            void runProposal(t('executeAdminProposal')).then((ok) => {
              if (ok) onExecuteProposal(openProposal.id);
            })
          }
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
          onPress={() =>
            void runProposal(t('cancelAdminProposal')).then((ok) => {
              if (ok) onCancelProposal(openProposal.id);
            })
          }
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
