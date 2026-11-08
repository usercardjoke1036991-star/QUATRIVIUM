import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useTheme } from '../theme/ThemeContext';
import { useFameLeaderboard } from '../hooks/useFameLeaderboard';
import { useUserProfile } from '../profile/ProfileContext';
import { labelForProfile } from '../services/userProfile';
import { formatRankLabel, getRankForLevel } from '../constants/ranks';
import { formatUSD } from '../utils/formatters';
import { addressToInviteCode } from '../utils/inviteCode';
import {
  FAME_BOARD_KINDS,
  FAME_PAGE_SIZE,
  fameBoardMetric,
  type FameBoardKind,
  type FamePlayer,
  type PodiumPlace,
} from '../utils/fameRankings';
import {
  RANKING_DIVISION_SIZE,
  assignDivisions,
  attachDivisionPrizes,
  monthlyPrizeBudgetUsd,
  seatsForDivision,
  type RankingSeat,
} from '../utils/rankingDivisions';
import {
  clampReferralPage,
  referralPageCount,
  sliceReferralPage,
  visibleReferralPages,
} from '../utils/referralPages';
import { AppIcon } from './icons';
import { AppText } from './AppText';
import { PodiumFrame } from './PodiumFrame';
import { ProfileAvatar } from './ProfileAvatar';

interface FameLeaderboardProps {
  enabled: boolean;
  unlocked?: boolean;
  walletAddress?: string;
  poolCashUsd?: number;
  poolNavUsd?: number;
}

const BOARD_TITLE: Record<FameBoardKind, TranslationKey> = {
  referrals: 'fameBoardReferrals',
  loans: 'fameBoardLoans',
  fame: 'fameBoardFame',
  streak: 'fameBoardStreak',
  level: 'fameBoardLevel',
  bonuses: 'fameBoardBonuses',
  combined: 'fameBoardCombined',
};

const PLACE_LABEL: Record<PodiumPlace, TranslationKey> = {
  1: 'famePlace1',
  2: 'famePlace2',
  3: 'famePlace3',
};

function metricLine(
  player: FamePlayer,
  kind: FameBoardKind,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string {
  if (kind === 'referrals') return t('fameMetricReferrals', { count: player.referrals });
  if (kind === 'loans') {
    return t('fameMetricLoans', {
      paid: player.loansPaid,
      requested: player.loansRequested,
      amount: formatUSD(player.paidUsd),
    });
  }
  if (kind === 'fame') return t('fameMetricFame', { points: player.fame });
  if (kind === 'streak') return t('fameMetricStreak', { count: player.streakDays || 0 });
  if (kind === 'level') return t('fameMetricLevel', { level: player.level || 1 });
  if (kind === 'bonuses') {
    return t('fameMetricBonuses', {
      count: player.bonuses || 0,
      amount: formatUSD(player.bonusUsd || 0),
    });
  }
  return t('fameMetricCombined', { score: (player.combined * 100).toFixed(0) });
}

function rankingIdentity(profile: Parameters<typeof labelForProfile>[0], address: string) {
  const code = addressToInviteCode(address);
  return { name: labelForProfile(profile, code), code };
}

function placeOf(rank: number): PodiumPlace | 0 {
  if (rank === 1) return 1;
  if (rank === 2) return 2;
  if (rank === 3) return 3;
  return 0;
}

export const FameLeaderboard: React.FC<FameLeaderboardProps> = ({
  enabled,
  unlocked = true,
  walletAddress = '',
  poolCashUsd = 0,
  poolNavUsd = 0,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { data, isLoading, error, refetch } = useFameLeaderboard(
    enabled && unlocked,
    walletAddress
  );
  const { lookup, refreshDirectory } = useUserProfile();
  const [kind, setKind] = useState<FameBoardKind>('combined');
  const [division, setDivision] = useState(1);
  const [page, setPage] = useState(1);

  const budget = monthlyPrizeBudgetUsd(poolCashUsd, poolNavUsd);
  const seats = useMemo(
    () => attachDivisionPrizes(assignDivisions(data.players, kind), budget),
    [data.players, kind, budget]
  );
  const divisionIds = useMemo(
    () => [...new Set(seats.map((seat) => seat.division))].sort((left, right) => left - right),
    [seats]
  );
  const mine = useMemo(() => {
    const wallet = walletAddress.toLowerCase();
    if (!wallet) return undefined;
    return seats.find((seat) => seat.player.address.toLowerCase() === wallet);
  }, [seats, walletAddress]);

  const firstDivision = divisionIds[0] || 1;

  useEffect(() => {
    setDivision(mine?.division || firstDivision);
    setPage(1);
  }, [kind, mine?.division, firstDivision]);

  const visible = seatsForDivision(seats, division);
  const podium = visible.slice(0, 3).filter((seat) => fameBoardMetric(seat.player, kind) > 0);
  const rest = visible.length > 3 ? visible.slice(3) : [];
  const totalPages = referralPageCount(rest.length, FAME_PAGE_SIZE);
  const safePage = clampReferralPage(page, totalPages);
  const pageRows = sliceReferralPage(rest, safePage, FAME_PAGE_SIZE);
  const divisionPrize = visible.reduce((sum, seat) => sum + (seat.prizeUsd || 0), 0);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    const rows = seatsForDivision(seats, division);
    const wallets = [
      ...new Set([...rows.map((seat) => seat.player.address), walletAddress].filter(Boolean)),
    ];
    if (!wallets.length) return;
    refreshDirectory(wallets).catch(() => {});
  }, [seats, division, walletAddress, refreshDirectory]);

  const first = podium.find((seat) => seat.placeInDivision === 1);
  const second = podium.find((seat) => seat.placeInDivision === 2);
  const third = podium.find((seat) => seat.placeInDivision === 3);

  const renderFace = (
    player: FamePlayer,
    size: number,
    place: PodiumPlace | 0,
    caption: string
  ) => {
    const profile = lookup(player.address);
    const rank = getRankForLevel(player.level || 1);
    const face = (
      <ProfileAvatar
        profile={profile}
        wallet={player.address}
        size={size}
        level={rank.level}
        rankName={t(rank.nameKey)}
        showRankLabel
        publicView
      />
    );
    if (!place) return face;
    return (
      <PodiumFrame place={place} label={caption} showLabel>
        {face}
      </PodiumFrame>
    );
  };

  const prizeLine = (seat: RankingSeat) => {
    if (seat.player.delinquent) return t('famePrizeMora');
    if (seat.prizeUsd <= 0) return t('famePrizeLine', { amount: formatUSD(0) });
    return t('famePrizeLine', { amount: formatUSD(seat.prizeUsd) });
  };

  const renderPerson = (seat: RankingSeat, size: number) => {
    const player = seat.player;
    const profile = lookup(player.address);
    const { name, code } = rankingIdentity(profile, player.address);
    const mineRow = walletAddress && player.address.toLowerCase() === walletAddress.toLowerCase();
    const rankStyle = getRankForLevel(player.level || 1);
    const place = placeOf(seat.placeInDivision);
    return (
      <View style={styles.person}>
        {renderFace(
          player,
          size,
          place,
          t(place ? PLACE_LABEL[place] : 'fameBoardUser', { number: player.userNumber })
        )}
        <AppText style={[styles.name, { color: colors.text }]} numberOfLines={2}>
          {name}
          {mineRow ? ` · ${t('fameYou')}` : ''}
        </AppText>
        {name !== code ? (
          <AppText style={[styles.code, { color: colors.textMuted }]} numberOfLines={1}>
            {code}
          </AppText>
        ) : null}
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('fameBoardUser', { number: player.userNumber })}
          {seat.placeInDivision ? ` · #${seat.placeInDivision}` : ''}
        </AppText>
        <AppText style={[styles.meta, { color: rankStyle.text }]} numberOfLines={2}>
          {formatRankLabel(rankStyle, t(rankStyle.nameKey))}
        </AppText>
        <AppText style={[styles.metric, { color: colors.primary }]} numberOfLines={2}>
          {metricLine(player, kind, t)}
        </AppText>
        <AppText
          style={[styles.meta, { color: player.delinquent ? colors.danger : colors.textMuted }]}
          numberOfLines={2}
        >
          {prizeLine(seat)}
        </AppText>
      </View>
    );
  };

  if (!unlocked) {
    return (
      <View
        style={[styles.locked, { borderColor: colors.border, backgroundColor: colors.surface }]}
      >
        <AppIcon name="lock" size={22} color={colors.primary} />
        <AppText style={[styles.lockedTitle, { color: colors.text }]}>
          {t('fameBoardLocked')}
        </AppText>
        <AppText style={[styles.live, { color: colors.textMuted, marginBottom: 0 }]}>
          {t('famePrizeLead')}
        </AppText>
      </View>
    );
  }

  return (
    <View>
      <AppText style={[styles.live, { color: colors.textMuted }]}>{t('fameBoardLive')}</AppText>
      <AppText style={[styles.live, { color: colors.textMuted }]}>{t('famePrizeLead')}</AppText>
      <View style={styles.chips}>
        {FAME_BOARD_KINDS.map((item) => {
          const active = item === kind;
          return (
            <TouchableOpacity
              key={item}
              onPress={() => setKind(item)}
              style={[
                styles.chip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(BOARD_TITLE[item])}
            >
              <AppText style={[styles.chipText, { color: active ? colors.primary : colors.text }]}>
                {t(BOARD_TITLE[item])}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>

      {divisionIds.length ? (
        <View style={styles.chips}>
          {divisionIds.map((id) => {
            const active = id === division;
            const count = seatsForDivision(seats, id).length;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => {
                  setDivision(id);
                  setPage(1);
                }}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('fameDivision', { n: id })}
              >
                <AppText
                  style={[styles.chipText, { color: active ? colors.primary : colors.text }]}
                >
                  {t('fameDivision', { n: id })}
                  {` · ${t('fameDivisionFill', { count, size: RANKING_DIVISION_SIZE })}`}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {visible.length ? (
        <AppText style={[styles.live, { color: colors.textMuted }]}>
          {t('fameDivisionPrize', { amount: formatUSD(divisionPrize) })}
        </AppText>
      ) : null}

      {isLoading && !seats.length ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? (
        <AppText style={[styles.warn, { color: colors.danger }]}>{t('configWarn')}</AppText>
      ) : null}
      {data.partial ? (
        <AppText style={[styles.live, { color: colors.warnText }]}>{t('fameBoardPartial')}</AppText>
      ) : null}

      {!isLoading && !podium.length && !rest.length ? (
        <AppText style={[styles.live, { color: colors.textMuted }]}>{t('fameBoardEmpty')}</AppText>
      ) : null}

      {podium.length ? (
        <View
          style={[styles.podium, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          {first ? <View style={styles.firstSlot}>{renderPerson(first, 64)}</View> : null}
          <View style={styles.sideRow}>
            <View style={styles.sideSlot}>{second ? renderPerson(second, 48) : null}</View>
            <View style={styles.sideSlot}>{third ? renderPerson(third, 48) : null}</View>
          </View>
        </View>
      ) : null}

      {rest.length ? (
        <View>
          {totalPages > 1 ? (
            <AppText style={[styles.live, { color: colors.textMuted }]}>
              {t('famePageOf', { page: String(safePage), pages: String(totalPages) })}
            </AppText>
          ) : null}
          {pageRows.map((seat) => {
            const profile = lookup(seat.player.address);
            const { name, code } = rankingIdentity(profile, seat.player.address);
            const mineRow =
              walletAddress && seat.player.address.toLowerCase() === walletAddress.toLowerCase();
            return (
              <View
                key={`${kind}-${division}-${seat.player.address}`}
                style={[
                  styles.row,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <AppText style={[styles.placeNum, { color: colors.textMuted }]}>
                  #{seat.placeInDivision}
                </AppText>
                {renderFace(seat.player, 48, 0, '')}
                <View style={styles.rowText}>
                  <AppText style={[styles.rowName, { color: colors.text }]} numberOfLines={2}>
                    {name}
                    {mineRow ? ` · ${t('fameYou')}` : ''}
                  </AppText>
                  {name !== code ? (
                    <AppText
                      style={[styles.rowCode, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {code}
                    </AppText>
                  ) : null}
                  <AppText style={[styles.rowMeta, { color: colors.textMuted }]}>
                    {t('fameBoardUser', { number: seat.player.userNumber })}
                  </AppText>
                  <AppText style={[styles.rowMetric, { color: colors.primary }]} numberOfLines={2}>
                    {metricLine(seat.player, kind, t)}
                  </AppText>
                  <AppText
                    style={[
                      styles.rowMeta,
                      { color: seat.player.delinquent ? colors.danger : colors.textMuted },
                    ]}
                    numberOfLines={2}
                  >
                    {prizeLine(seat)}
                  </AppText>
                </View>
              </View>
            );
          })}
          {totalPages > 1 ? (
            <View style={styles.pager}>
              <TouchableOpacity
                disabled={safePage <= 1}
                onPress={() => setPage(safePage - 1)}
                style={[
                  styles.pageChip,
                  { borderColor: colors.border },
                  safePage <= 1 && styles.pageDisabled,
                ]}
              >
                <AppText style={[styles.pageChipText, { color: colors.text }]}>‹</AppText>
              </TouchableOpacity>
              {visibleReferralPages(safePage, totalPages).map((item, index) =>
                item === 'gap' ? (
                  <AppText
                    key={`gap-${index}`}
                    style={[styles.pageGap, { color: colors.textMuted }]}
                  >
                    …
                  </AppText>
                ) : (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setPage(item)}
                    style={[
                      styles.pageChip,
                      {
                        borderColor: item === safePage ? colors.primary : colors.border,
                        backgroundColor: item === safePage ? colors.chip : colors.surface,
                      },
                    ]}
                  >
                    <AppText style={[styles.pageChipText, { color: colors.text }]}>{item}</AppText>
                  </TouchableOpacity>
                )
              )}
              <TouchableOpacity
                disabled={safePage >= totalPages}
                onPress={() => setPage(safePage + 1)}
                style={[
                  styles.pageChip,
                  { borderColor: colors.border },
                  safePage >= totalPages && styles.pageDisabled,
                ]}
              >
                <AppText style={[styles.pageChipText, { color: colors.text }]}>›</AppText>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity
        onPress={() => void refetch()}
        style={styles.refresh}
        accessibilityRole="button"
      >
        <AppIcon name="refresh" size={16} color={colors.primary} />
        <AppText style={[styles.refreshText, { color: colors.primary }]}>
          {t('referralRefresh')}
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  live: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  locked: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  lockedTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  podium: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  firstSlot: {
    alignItems: 'center',
    marginBottom: 8,
  },
  sideRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    gap: 8,
  },
  sideSlot: {
    flex: 1,
    alignItems: 'center',
  },
  person: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 160,
  },
  name: {
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  meta: {
    fontSize: 11,
    textAlign: 'center',
  },
  metric: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  placeNum: {
    fontSize: 13,
    fontWeight: '800',
    width: 32,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '800',
  },
  rowCode: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  rowMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  rowMetric: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  pager: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  pageChip: {
    minWidth: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pageChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pageGap: {
    fontSize: 16,
    paddingHorizontal: 4,
  },
  pageDisabled: {
    opacity: 0.35,
  },
  warn: {
    fontSize: 13,
    marginBottom: 8,
  },
  refresh: {
    marginTop: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  refreshText: {
    fontWeight: '700',
    fontSize: 13,
  },
});
