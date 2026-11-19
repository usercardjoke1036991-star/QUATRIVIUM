import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, ActivityIndicator } from 'react-native';
import { LoanTier } from '../hooks/useWeb3Balances';
import { formatCountdownClock, formatUSD } from '../utils/formatters';
import { useLiveCooldown } from '../hooks/useLiveCooldown';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { formatRankLabel, getRankForLevel } from '../constants/ranks';
import { RankMedal } from './RankMedal';
import { AppIcon } from './icons';
import {
  commissionRowsForLoan,
  formatCommissionUSD,
  ACTIVATION_BONUS_USD,
} from '../constants/commissions';
import { AppText } from './AppText';
import {
  isMilestoneLevel,
  MAX_LEVEL_BONUS_EVERY,
  MAX_LOAN_LEVEL,
  milestoneBonusUsd,
} from '../constants/loanTiers';

interface LoanTierCardProps {
  tier: LoanTier;
  userLevel: number;
  hasActiveLoan: boolean;
  isActiveTier: boolean;
  dueLabel?: string;
  cuotaLabel?: string;
  cuotasPagadas?: number;
  cuotasTotales?: number;
  remainingLabel?: string;
  isLoading: boolean;
  isDelinquent?: boolean;
  paused?: boolean;
  curveRateBps?: number;
  ultimoPrestamoTimestamp?: number;
  cooldownRestante?: number;
  isRegistered?: boolean;
  identityBlocked?: boolean;
  accessBlocked?: boolean;
  contractReady?: boolean;
  onActivateCredit?: () => void;
  onRequestLoan: (tier: LoanTier) => void;
  onPayLoan: () => void;
  onPayAll?: () => void;
  onPayCount?: (count: number) => void;
  showMilestoneBonus?: boolean;
}

export const LoanTierCard: React.FC<LoanTierCardProps> = ({
  tier,
  userLevel,
  hasActiveLoan,
  isActiveTier,
  dueLabel,
  cuotaLabel,
  cuotasPagadas = 0,
  cuotasTotales = 1,
  remainingLabel,
  isLoading,
  isDelinquent = false,
  paused = false,
  curveRateBps = 0,
  ultimoPrestamoTimestamp = 0,
  cooldownRestante = 0,
  isRegistered = true,
  identityBlocked = false,
  accessBlocked = false,
  contractReady = true,
  onActivateCredit,
  onRequestLoan,
  onPayAll,
  onPayCount,
  onPayLoan,
  showMilestoneBonus = false,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const locked = tier.id > userLevel;
  const unlocked = !locked;
  const [detailsOpen, setDetailsOpen] = useState(!locked);
  const [commsOpen, setCommsOpen] = useState(false);
  const showDetails = unlocked || detailsOpen;
  const appliedBps = Math.max(tier.interestBps, curveRateBps || 0);
  const interest = (tier.usdAmount * appliedBps) / 10000;
  const totalRepay = tier.usdAmount + interest;
  const installments = tier.installments || 1;
  const cuotaPreview = formatUSD(totalRepay / installments);
  const isMaxLevel = tier.id >= MAX_LOAN_LEVEL;
  const rank = getRankForLevel(tier.id);
  const rankLabel = formatRankLabel(rank, t(rank.nameKey));
  const earnRows = commissionRowsForLoan(tier.usdAmount, appliedBps);
  const curveRaisesRate = appliedBps > tier.interestBps;
  const remainingInstallments = Math.max(0, cuotasTotales - cuotasPagadas);
  const cooldownLeft = useLiveCooldown(ultimoPrestamoTimestamp, cooldownRestante);
  const waitingNextLoan = cooldownLeft > 0 && !hasActiveLoan && !locked;
  const protocolClosed = !contractReady && unlocked && !hasActiveLoan;
  const needsActivate = !isRegistered && unlocked && !hasActiveLoan && !protocolClosed;
  const needsIdentity =
    identityBlocked && unlocked && !hasActiveLoan && !needsActivate && !protocolClosed;
  const needsAccess =
    accessBlocked &&
    unlocked &&
    !hasActiveLoan &&
    !needsActivate &&
    !needsIdentity &&
    !protocolClosed;
  const requestBlocked =
    isLoading ||
    locked ||
    hasActiveLoan ||
    isDelinquent ||
    paused ||
    waitingNextLoan ||
    needsIdentity ||
    needsAccess ||
    protocolClosed;
  const toggleLockedDetails = () => setDetailsOpen((open) => !open);

  const card = (
    <>
      <View style={[styles.accent, { backgroundColor: locked ? colors.border : rank.metal }]} />
      <View style={styles.tierRow}>
        <View style={styles.titleBlock}>
          <RankMedal level={tier.id} rank={rank} size={36} dimmed={locked} />
          <View style={styles.titleText}>
            <AppText style={[styles.rankName, { color: colors.textMuted }]}>{rankLabel}</AppText>
            <AppText style={[styles.tierTitle, { color: colors.text }]}>{tier.name}</AppText>
          </View>
        </View>
        {locked ? (
          <View style={styles.lockedMeta} pointerEvents="none">
            <AppText style={[styles.metaBadge, { color: colors.textMuted }]}>
              {t('loanLockedBadge')}
            </AppText>
            <AppText style={[styles.chevron, { color: colors.primary }]}>
              {detailsOpen ? '–' : '+'}
            </AppText>
          </View>
        ) : protocolClosed ? (
          <AppText style={[styles.metaBadge, { color: colors.warnText }]}>
            {t('accountWorldLivePendingTag')}
          </AppText>
        ) : (
          <AppText style={[styles.metaBadge, { color: colors.success }]}>
            {t('loanUnlockedBadge')}
          </AppText>
        )}
      </View>

      <AppText style={[styles.tierAmount, { color: colors.text }]}>
        {formatUSD(tier.usdAmount)}
      </AppText>
      {!showDetails ? (
        <AppText style={[styles.seeDetails, { color: colors.primary }]}>
          {t('loanSeeDetails')}
        </AppText>
      ) : null}
      {showDetails ? (
        <View>
          <AppText style={[styles.tierRate, { color: colors.text }]}>
            {t('interestRate', { rate: String(appliedBps / 100) })}
          </AppText>
          {curveRaisesRate ? (
            <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
              {t('interestRateCurveNote', { floor: String(tier.interestBps / 100) })}
            </AppText>
          ) : null}
          <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
            {t('interestAmount', { amount: formatUSD(interest) })}
          </AppText>
          <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
            {t('loanFounderShare')}
          </AppText>
          <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
            {t('loanInsuranceShare')}
          </AppText>
          <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
            {t('loanSequencerGrace')}
          </AppText>
          <AppText style={[styles.tierTotal, { color: colors.text }]}>
            {t('totalRepay', { amount: formatUSD(totalRepay) })}
          </AppText>
          {installments > 1 ? (
            <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
              {t('installmentPlan', { count: installments, amount: cuotaPreview })}
            </AppText>
          ) : (
            <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
              {t('repayOnce')}
            </AppText>
          )}
          {installments > 1 ? (
            <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
              {t('payChoiceLead')}
            </AppText>
          ) : null}
          <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
            {t('term')}: {tier.term}
          </AppText>
          {showMilestoneBonus && isMilestoneLevel(tier.id) ? (
            <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
              {t('milestoneBonusOnTier', { amount: formatUSD(milestoneBonusUsd(tier.id)) })}
            </AppText>
          ) : null}
          {isMaxLevel ? (
            <AppText style={[styles.tierMeta, { color: colors.success }]}>
              {t('maxLevelNote', {
                count: String(MAX_LEVEL_BONUS_EVERY),
                amount: formatUSD(milestoneBonusUsd(MAX_LOAN_LEVEL)),
              })}
            </AppText>
          ) : (
            <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
              {t('payOnTimeToLevel', { count: tier.requiredCount })}
            </AppText>
          )}
          <Pressable
            onPress={() => setCommsOpen((open) => !open)}
            style={styles.earnToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: commsOpen }}
            accessibilityLabel={t('referralEarnLeadLevel')}
          >
            <AppText style={[styles.earnNote, styles.earnToggleText, { color: colors.success }]}>
              {t('referralEarnLeadLevel')}
            </AppText>
            <AppText style={[styles.chevron, { color: colors.success }]}>
              {commsOpen ? '–' : '+'}
            </AppText>
          </Pressable>
          {tier.id === 1 ? (
            <AppText style={[styles.earnNote, { color: colors.success }]}>
              {t('referralEarnLevel1First', { bonus: formatCommissionUSD(ACTIVATION_BONUS_USD) })}
            </AppText>
          ) : null}
          {commsOpen
            ? earnRows.map((band) => (
                <AppText key={band.range} style={[styles.earnBand, { color: colors.success }]}>
                  {t('referralEarnBand', {
                    range: band.range,
                    amount: formatCommissionUSD(band.amount),
                  })}
                </AppText>
              ))
            : null}

          <View style={styles.tierActions}>
            {locked ? (
              <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
                {t('loanLockedBody')}
              </AppText>
            ) : isActiveTier && hasActiveLoan ? (
              <>
                {remainingLabel && remainingInstallments > 1 && (
                  <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
                    {t('payChoiceNow')}
                  </AppText>
                )}
                {remainingLabel && remainingInstallments > 1 && (
                  <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
                    {t('remainingDebt', { amount: remainingLabel })}
                  </AppText>
                )}
                <TouchableOpacity
                  disabled={isLoading}
                  onPress={onPayLoan}
                  style={[styles.btn, { backgroundColor: colors.primary }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <View style={styles.btnRow}>
                      <AppIcon name="pay" size={16} color={colors.onPrimary} />
                      <AppText style={[styles.btnText, { color: colors.onPrimary }]}>
                        {cuotasTotales > 1
                          ? t('payInstallment', {
                              current: cuotasPagadas + 1,
                              total: cuotasTotales,
                              amount: cuotaLabel || dueLabel || t('debt'),
                            })
                          : `${t('pay')} ${dueLabel || t('debt')}`}
                      </AppText>
                    </View>
                  )}
                </TouchableOpacity>
                {remainingInstallments > 2 && onPayCount ? (
                  <TouchableOpacity
                    disabled={isLoading}
                    onPress={() => onPayCount(2)}
                    style={[
                      styles.btn,
                      styles.btnSecond,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                    ]}
                  >
                    <AppText style={[styles.btnText, { color: colors.text }]}>
                      {t('payNInstallments', { count: 2 })}
                    </AppText>
                  </TouchableOpacity>
                ) : null}
                {remainingInstallments > 1 && onPayAll ? (
                  <TouchableOpacity
                    disabled={isLoading}
                    onPress={onPayAll}
                    style={[
                      styles.btn,
                      styles.btnSecond,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                    ]}
                  >
                    <AppText style={[styles.btnText, { color: colors.text }]}>
                      {t('payAllNow', { amount: remainingLabel || dueLabel || t('debt') })}
                    </AppText>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : waitingNextLoan ? (
              <View
                style={[
                  styles.waitBox,
                  { backgroundColor: colors.chip, borderColor: colors.border },
                ]}
                accessibilityRole="text"
                accessibilityLabel={`${t('cooldown')} ${formatCountdownClock(cooldownLeft)}`}
              >
                <AppText style={[styles.waitLabel, { color: colors.textMuted }]}>
                  {t('cooldown')}
                </AppText>
                <AppText style={[styles.waitClock, { color: colors.text }]}>
                  {formatCountdownClock(cooldownLeft)}
                </AppText>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  disabled={needsActivate ? isLoading : requestBlocked}
                  onPress={() => {
                    if (protocolClosed) return;
                    if (needsActivate) {
                      onActivateCredit?.();
                      return;
                    }
                    onRequestLoan(tier);
                  }}
                  style={[
                    styles.btn,
                    !needsActivate &&
                    (locked ||
                      hasActiveLoan ||
                      isDelinquent ||
                      paused ||
                      needsIdentity ||
                      needsAccess ||
                      protocolClosed)
                      ? { backgroundColor: colors.chip }
                      : { backgroundColor: colors.primary },
                  ]}
                >
                  {isLoading && unlocked && !hasActiveLoan ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <View style={styles.btnRow}>
                      <AppIcon
                        name={
                          needsActivate
                            ? 'id'
                            : locked ||
                                isDelinquent ||
                                paused ||
                                needsIdentity ||
                                needsAccess ||
                                protocolClosed
                              ? 'lock'
                              : 'bank'
                        }
                        size={16}
                        color={
                          !needsActivate &&
                          (locked ||
                            hasActiveLoan ||
                            isDelinquent ||
                            paused ||
                            needsIdentity ||
                            needsAccess ||
                            protocolClosed)
                            ? colors.textMuted
                            : colors.onPrimary
                        }
                      />
                      <AppText
                        style={[
                          styles.btnText,
                          {
                            color:
                              !needsActivate &&
                              (locked ||
                                hasActiveLoan ||
                                isDelinquent ||
                                paused ||
                                needsIdentity ||
                                needsAccess ||
                                protocolClosed)
                                ? colors.textMuted
                                : colors.onPrimary,
                          },
                        ]}
                      >
                        {protocolClosed
                          ? t('liveCreditNotReady')
                          : needsActivate
                            ? t('activateCredit')
                            : needsIdentity
                              ? t('requestNeedIdentity')
                              : needsAccess
                                ? t('creditAccessNeed')
                                : paused
                                  ? t('actionPaused')
                                  : isDelinquent
                                    ? t('delinquent')
                                    : hasActiveLoan && unlocked
                                      ? t('loanBusy')
                                      : t('requestUncollateralized')}
                      </AppText>
                    </View>
                  )}
                </TouchableOpacity>
                {protocolClosed ? (
                  <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
                    {t('liveNetworkPendingLead')}
                  </AppText>
                ) : needsIdentity ? (
                  <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
                    {t('liveIdentityBeforeLoan')}
                  </AppText>
                ) : needsAccess ? (
                  <AppText style={[styles.tierMeta, { color: colors.textMuted }]}>
                    {t('creditAccessNeed')}
                  </AppText>
                ) : null}
              </>
            )}
          </View>
        </View>
      ) : null}
    </>
  );

  const cardStyle = [
    styles.tierCard,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
  ];

  if (locked) {
    return (
      <Pressable
        onPress={toggleLockedDetails}
        style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.82 : 0.92 }]}
        android_ripple={{ color: colors.chip }}
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        accessibilityLabel={`${tier.name}. ${t('loanSeeDetails')}`}
      >
        {card}
      </Pressable>
    );
  }

  return <View style={cardStyle}>{card}</View>;
};

const styles = StyleSheet.create({
  tierCard: {
    borderRadius: 12,
    padding: 16,
    paddingLeft: 18,
    marginBottom: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
  },
  tierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 8,
    gap: 10,
  },
  titleText: {
    flex: 1,
  },
  rankName: {
    fontSize: 11,
    fontWeight: '500',
  },
  tierTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  lockedMeta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  chevron: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  seeDetails: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 2,
  },
  metaBadge: {
    fontSize: 11,
    fontWeight: '500',
  },
  tierAmount: {
    fontSize: 26,
    fontWeight: '600',
    marginBottom: 2,
  },
  tierRate: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  tierTotal: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 6,
  },
  tierMeta: {
    fontSize: 13,
    marginBottom: 2,
  },
  earnToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  earnToggleText: {
    flex: 1,
    marginTop: 0,
  },
  earnNote: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    lineHeight: 17,
  },
  earnBand: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  tierActions: {
    marginTop: 12,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecond: {
    marginTop: 8,
    borderWidth: 1,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  waitBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  waitClock: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
});
