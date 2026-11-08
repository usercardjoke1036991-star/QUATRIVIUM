import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { formatUnits } from 'ethers';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import type { TranslationKey } from '../i18n/translations';
import { getRuntimeMode, subscribeRuntimeMode } from '../constants/rpcConfig';
import { movementBelongsToWorld } from '../utils/historyWorld';
import {
  loadMoraHistory,
  loadMovementHistory,
  type Movement,
  type MovementKind,
} from '../services/movementHistory';
import {
  isLoanMovement,
  isSupportMovement,
  isTransferMovement,
  type MoraSpell,
} from '../utils/moraHistory';
import { formatAddress } from '../utils/formatters';
import { AppSubsection } from './AppSection';
import { AppText } from './AppText';

const KIND_KEY: Record<MovementKind, TranslationKey> = {
  loan: 'historyLoan',
  payment: 'historyPayment',
  transfer_out: 'historyTransferOut',
  transfer_in: 'historyTransferIn',
  bonus: 'historyBonus',
  donation: 'historyDonation',
  access: 'historyAccess',
};

function formatWhen(timestamp: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString();
}

function poolLabel(wei: bigint): string {
  return `${Number(formatUnits(wei, 18)).toFixed(4)} USDT`;
}

const MovementCard: React.FC<{ item: Movement }> = ({ item }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const hidePeer = item.kind === 'access' || item.kind === 'donation';
  const peer = hidePeer
    ? ''
    : item.kind === 'transfer_out' || item.kind === 'payment'
      ? item.to
      : item.from;
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <AppText style={[styles.kind, { color: colors.primary }]}>{t(KIND_KEY[item.kind])}</AppText>
      <AppText style={[styles.amount, { color: colors.text }]}>{item.amountLabel}</AppText>
      {peer ? (
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {item.kind === 'transfer_out' || item.kind === 'payment'
            ? t('historyTo')
            : t('historyFrom')}
          {': '}
          {formatAddress(peer)}
        </AppText>
      ) : null}
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {formatWhen(item.timestamp)}
      </AppText>
      {item.dueAt ? (
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('historyDue')}: {formatWhen(item.dueAt)}
        </AppText>
      ) : null}
    </View>
  );
};

const MoraCard: React.FC<{ item: MoraSpell }> = ({ item }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <AppText style={[styles.kind, { color: colors.danger }]}>{t('historyMora')}</AppText>
      <AppText style={[styles.meta, { color: colors.text }]}>
        {formatWhen(item.startedAt)}
        {' · '}
        {item.endedAt ? formatWhen(item.endedAt) : t('historyMoraOpenNow')}
      </AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t('historyMoraDays', { days: String(item.days) })}
      </AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t('historyMoraFame', { points: String(item.fameLost) })}
      </AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {item.benefitsBlocked ? t('historyMoraBlocked') : t('historyMoraOpen')}
      </AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t('historyMoraPool', { amount: poolLabel(item.poolWei) })}
      </AppText>
    </View>
  );
};

export const MovementHistory: React.FC<{
  walletAddress: string;
  enabled: boolean;
  level?: number;
}> = ({ walletAddress, enabled, level = 1 }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [items, setItems] = useState<Movement[]>([]);
  const [mora, setMora] = useState<MoraSpell[]>([]);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled || !walletAddress) return;
    let cancelled = false;
    const load = () => {
      setLoading(true);
      setError(false);
      Promise.all([loadMovementHistory(walletAddress), loadMoraHistory(walletAddress, level)])
        .then(([snapshot, moraSnap]) => {
          if (cancelled) return;
          setItems(snapshot.items);
          setMora(moraSnap.items);
          setPartial(snapshot.partial || moraSnap.partial);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const unsub = subscribeRuntimeMode(() => {
      setItems([]);
      setMora([]);
      load();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [enabled, walletAddress, level]);

  const world = getRuntimeMode();
  const transfers = useMemo(
    () =>
      items.filter((item) => isTransferMovement(item.kind) && movementBelongsToWorld(item, world)),
    [items, world]
  );
  const loans = useMemo(
    () => items.filter((item) => isLoanMovement(item.kind) && movementBelongsToWorld(item, world)),
    [items, world]
  );
  const support = useMemo(
    () =>
      items.filter((item) => isSupportMovement(item.kind) && movementBelongsToWorld(item, world)),
    [items, world]
  );

  return (
    <View>
      {loading ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
      {error ? (
        <AppText style={[styles.warn, { color: colors.danger }]}>{t('referralLoadError')}</AppText>
      ) : null}
      {partial ? (
        <AppText style={[styles.warn, { color: colors.warnText }]}>{t('historyPartial')}</AppText>
      ) : null}
      <AppSubsection title={t('historyTransfers')} defaultOpen icon="wallet">
        {!loading && !transfers.length ? (
          <AppText style={[styles.empty, { color: colors.textMuted }]}>
            {t('historyTransferEmpty')}
          </AppText>
        ) : null}
        {transfers.map((item) => (
          <MovementCard key={item.id} item={item} />
        ))}
      </AppSubsection>
      <AppSubsection title={t('historySupport')} defaultOpen icon="star">
        {!loading && !support.length ? (
          <AppText style={[styles.empty, { color: colors.textMuted }]}>
            {t('historySupportEmpty')}
          </AppText>
        ) : null}
        {support.map((item) => (
          <MovementCard key={item.id} item={item} />
        ))}
      </AppSubsection>
      <AppSubsection title={t('historyLoans')} defaultOpen icon="bank">
        {!loading && !loans.length ? (
          <AppText style={[styles.empty, { color: colors.textMuted }]}>
            {t('historyLoanEmpty')}
          </AppText>
        ) : null}
        {loans.map((item) => (
          <MovementCard key={item.id} item={item} />
        ))}
        <AppSubsection title={t('historyMora')} defaultOpen icon="warning">
          {!loading && !mora.length ? (
            <AppText style={[styles.empty, { color: colors.textMuted }]}>
              {t('historyMoraEmpty')}
            </AppText>
          ) : null}
          {mora.map((item) => (
            <MoraCard key={item.id} item={item} />
          ))}
        </AppSubsection>
      </AppSubsection>
    </View>
  );
};

const styles = StyleSheet.create({
  spinner: {
    marginVertical: 12,
  },
  warn: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  kind: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
    lineHeight: 17,
  },
});
