import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Share, Alert, Pressable } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { addressToInviteCode, buildInviteLink, inviteLinkPreview } from '../utils/inviteCode';
import { AppIcon } from './icons';
import { ProfileAvatar } from './ProfileAvatar';
import { useUserProfile } from '../profile/ProfileContext';
import { labelForProfile } from '../services/userProfile';
import { formatRankLabel, getRankForLevel } from '../constants/ranks';
import { useWalletLevel } from '../hooks/useWalletLevel';
import { LOAN_TIERS, MAX_LOAN_LEVEL } from '../constants/loanTiers';
import {
  ACTIVATION_BONUS_USD,
  COMMISSION_BANDS,
  commissionForGeneration,
  directCommissionFromLoan,
  directCommissionRowsForTiers,
  formatCommissionUSD,
  generationCommissionBps,
} from '../constants/commissions';
import { REFERRAL_BONUS_THRESHOLD, REFERRAL_REPUTATION_POINTS } from '../constants/reputation';
import { formatUSD } from '../utils/formatters';
import { AppSubsection } from './AppSection';
import { AppText } from './AppText';
import { copyText } from '../utils/copyText';
import { loadLockedSponsor, type LockedSponsor } from '../services/sponsorLock';

export interface ReferralInfo {
  padre: string;
  fundador: string;
  isFundador: boolean;
  bonoActivacionCobrado: boolean;
  royaltiesCongeladas: boolean;
}

interface ReferralSectionProps {
  walletAddress: string;
  isRegistered: boolean;
  isRestricted?: boolean;
  curveRateBps?: number;
  referral?: ReferralInfo;
  reputation?: number;
  networkPoints?: number;
  networkBonusThreshold?: number;
  children?: React.ReactNode;
}

const ZERO = '0x0000000000000000000000000000000000000000';
const EXAMPLE_LEVELS = [1, 10, 100, 1000] as const;
const LEVEL_ROW_HEIGHT = 34;

type LevelCommissionRow = { id: number; usdAmount: number; amount: number };

export const ReferralSection: React.FC<ReferralSectionProps> = ({
  walletAddress,
  isRegistered,
  isRestricted = false,
  curveRateBps = 0,
  referral,
  reputation = 0,
  networkPoints: _networkPoints = 0,
  networkBonusThreshold: _networkBonusThreshold = REFERRAL_BONUS_THRESHOLD,
  children,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { profile, lookup, refreshDirectory } = useUserProfile();
  const [lockedSponsor, setLockedSponsor] = useState<LockedSponsor | null>(null);
  const [levelCommsOpen, setLevelCommsOpen] = useState(false);
  const padre = referral?.padre || '';
  const isFundador = Boolean(referral?.isFundador);
  const bonoActivacionCobrado = Boolean(referral?.bonoActivacionCobrado);
  const royaltiesCongeladas = Boolean(referral?.royaltiesCongeladas);

  const hasPadre = Boolean(padre) && padre.toLowerCase() !== ZERO;
  const myCode = walletAddress ? addressToInviteCode(walletAddress) : '';
  const inviteLink = myCode ? buildInviteLink(myCode, profile.displayName) : '';
  const padreCode = hasPadre ? addressToInviteCode(padre) : '';
  const padreProfile = hasPadre ? lookup(padre) : undefined;
  const padreLabel = hasPadre ? labelForProfile(padreProfile, padreCode) : '';
  const padreLevel = useWalletLevel(hasPadre ? padre : '');

  useEffect(() => {
    if (!hasPadre) return;
    refreshDirectory([padre]).catch(() => {});
  }, [hasPadre, padre, refreshDirectory]);

  const shareName = profile.displayName || t('profileSomeone');
  const shareText = t('shareMessage', { code: myCode, link: inviteLink, name: shareName });

  const exampleTiers = useMemo(
    () => EXAMPLE_LEVELS.map((id) => LOAN_TIERS.find((tier) => tier.id === id)).filter(Boolean),
    []
  );
  const levelCommissionRows = useMemo(
    () => directCommissionRowsForTiers(LOAN_TIERS, curveRateBps),
    [curveRateBps]
  );
  const sampleLoan = useMemo(() => LOAN_TIERS.find((tier) => tier.id === 10) || LOAN_TIERS[0], []);

  const renderLevelCommission = useCallback(
    (item: LevelCommissionRow) => {
      const earn = formatCommissionUSD(item.amount);
      return (
        <View
          key={item.id}
          style={[styles.earnRow, styles.levelRow, { borderColor: colors.border }]}
        >
          <AppText numberOfLines={1} style={[styles.earnCell, { color: colors.text, flex: 1.2 }]}>
            {t('level')} {item.id}
          </AppText>
          <AppText numberOfLines={1} style={[styles.earnCell, { color: colors.text, flex: 1 }]}>
            {formatUSD(item.usdAmount)}
          </AppText>
          <AppText
            numberOfLines={1}
            style={[styles.earnCell, { color: colors.primary, flex: 1.4 }]}
          >
            {item.id === 1
              ? `${t('referralEarnFirst', { bonus: formatCommissionUSD(ACTIVATION_BONUS_USD) })} · ${t('referralEarnNext', { amount: earn })}`
              : earn}
          </AppText>
        </View>
      );
    },
    [colors.border, colors.primary, colors.text, t]
  );

  useEffect(() => {
    let done = false;
    if (!walletAddress) {
      setLockedSponsor(null);
      return undefined;
    }
    loadLockedSponsor(walletAddress)
      .then((row) => {
        if (!done) setLockedSponsor(row);
      })
      .catch(() => {
        if (!done) setLockedSponsor(null);
      });
    return () => {
      done = true;
    };
  }, [walletAddress]);

  const guardShare = () => {
    if (isRestricted) {
      Alert.alert(t('delinquent'), t('shareDisabledMora'));
      return false;
    }
    if (!walletAddress || !myCode) {
      Alert.alert(t('connect'), t('connectForInvite'));
      return false;
    }
    return true;
  };

  const handleCopyCode = async () => {
    if (!guardShare()) return;
    const result = await copyText(myCode);
    if (result === 'copied') {
      Alert.alert(t('ready'), t('inviteCopied'));
      return;
    }
    if (result === 'failed') {
      Alert.alert(t('invite'), myCode);
    }
  };

  const handleCopyLink = async () => {
    if (!guardShare() || !inviteLink) return;
    const result = await copyText(inviteLink);
    if (result === 'copied') {
      Alert.alert(t('ready'), t('inviteLinkCopied'));
      return;
    }
    if (result === 'failed') {
      Alert.alert(t('invite'), inviteLink);
    }
  };

  const handleShare = async () => {
    if (!guardShare()) return;
    try {
      await Share.share({
        title: t('shareTitle'),
        message: shareText,
      });
    } catch {
      Alert.alert(t('invite'), `${myCode}\n${inviteLink}`);
    }
  };

  return (
    <View style={styles.stack}>
      {isRestricted ? <AppText style={styles.warn}>{t('moraBlocked')}</AppText> : null}

      <AppSubsection title={t('subsectionInvite')} defaultOpen icon="share">
        {isFundador ? (
          <View
            style={[
              styles.founderBadge,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <AppIcon name="star" size={16} color={colors.text} />
            <AppText style={[styles.founderBadgeText, { color: colors.text }]}>
              {t('youAreFounder')}
            </AppText>
          </View>
        ) : null}

        <AppText style={[styles.sectionLead, { color: colors.textMuted }]}>
          {t('referralHint')}
        </AppText>
        <TouchableOpacity
          style={styles.labelRow}
          onPress={() => void handleCopyCode()}
          disabled={!myCode || isRestricted}
          accessibilityRole="button"
          accessibilityLabel={t('copyInvite')}
        >
          <AppIcon name="copy" size={14} color={colors.textMuted} />
          <AppText style={[styles.label, { color: colors.textMuted }]}>{t('inviteCode')}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void handleCopyCode()}
          disabled={!myCode || isRestricted}
          accessibilityRole="button"
          accessibilityLabel={t('copyInvite')}
        >
          <View
            style={[
              styles.codeBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {myCode ? (
              myCode.split('-').map((part, index) => (
                <AppText
                  key={`${part}-${index}`}
                  selectable
                  style={[styles.codePart, { color: colors.text }]}
                >
                  {part}
                </AppText>
              ))
            ) : (
              <AppText style={[styles.codePart, { color: colors.textMuted }]}>
                {t('connectForCode')}
              </AppText>
            )}
          </View>
        </TouchableOpacity>
        {inviteLink ? (
          <View>
            <TouchableOpacity
              style={styles.labelRow}
              onPress={() => void handleCopyLink()}
              disabled={isRestricted}
              accessibilityRole="button"
              accessibilityLabel={t('copyInviteLink')}
            >
              <AppIcon name="copy" size={14} color={colors.textMuted} />
              <AppText style={[styles.label, { color: colors.textMuted }]}>
                {t('inviteLinkLabel')}
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleCopyLink()}
              disabled={isRestricted}
              accessibilityRole="button"
              accessibilityLabel={t('copyInviteLink')}
              style={[
                styles.linkBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <AppIcon name="globe" size={16} color={colors.primary} />
              <AppText
                numberOfLines={2}
                selectable
                style={[styles.linkText, { color: colors.primary }]}
              >
                {inviteLinkPreview(inviteLink)}
              </AppText>
              <AppIcon name="copy" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <AppText style={[styles.linkHint, { color: colors.textMuted }]}>
              {t('inviteLinkHint')}
            </AppText>
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.action,
              { backgroundColor: colors.connect },
              isRestricted && styles.shareDisabled,
            ]}
            onPress={() => void handleCopyCode()}
            disabled={!myCode || isRestricted}
            accessibilityRole="button"
            accessibilityLabel={t('copyInvite')}
          >
            <AppIcon name="copy" size={16} color="#111" />
            <AppText style={[styles.actionText, { color: '#111' }]}>{t('copyInvite')}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.action,
              { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
              isRestricted && styles.shareDisabled,
            ]}
            onPress={() => void handleCopyLink()}
            disabled={!inviteLink || isRestricted}
            accessibilityRole="button"
            accessibilityLabel={t('copyInviteLink')}
          >
            <AppIcon name="share" size={16} color={colors.text} />
            <AppText style={[styles.actionText, { color: colors.text }]}>
              {t('copyInviteLink')}
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.action,
              { backgroundColor: colors.primary },
              isRestricted && styles.shareDisabled,
            ]}
            onPress={handleShare}
            disabled={!myCode || isRestricted}
          >
            <AppIcon name="share" size={16} color={colors.onPrimary} />
            <AppText style={[styles.actionText, { color: colors.onPrimary }]}>
              {t('shareInvite')}
            </AppText>
          </TouchableOpacity>
        </View>

        {isRegistered ? (
          <View style={[styles.meta, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {hasPadre && !isFundador ? (
              <View style={styles.invitedBy}>
                <ProfileAvatar
                  profile={padreProfile}
                  wallet={padre}
                  size={40}
                  publicView
                  level={padreLevel}
                  rankName={t(getRankForLevel(padreLevel).nameKey)}
                  showRankLabel={false}
                />
                <AppText style={[styles.metaLine, { color: colors.text, flex: 1 }]}>
                  {t('invitedBy')}: {padreLabel}
                  {'\n'}
                  {formatRankLabel(
                    getRankForLevel(padreLevel || 1),
                    t(getRankForLevel(padreLevel || 1).nameKey)
                  )}
                </AppText>
              </View>
            ) : (
              <AppText style={[styles.metaLine, { color: colors.text }]}>
                {t('invitedBy')}: {isFundador ? t('nobodyRoot') : t('pending')}
              </AppText>
            )}
            <AppText style={[styles.metaLine, { color: colors.text }]}>
              {t('activationBonus')}:{' '}
              {isFundador
                ? t('notApplicable')
                : bonoActivacionCobrado
                  ? t('bonusPaid')
                  : t('bonusPending')}
            </AppText>
            {royaltiesCongeladas ? (
              <AppText style={styles.warn}>{t('royaltiesFrozen')}</AppText>
            ) : null}
          </View>
        ) : (
          <AppText style={[styles.hint, { color: colors.textMuted }]}>
            {lockedSponsor?.padre
              ? t('referralUplineLocked', { code: lockedSponsor.code })
              : t('referralOwnChain')}
          </AppText>
        )}
      </AppSubsection>

      {children}

      <AppSubsection title={t('referralRepTitle')} defaultOpen={false} icon="star">
        <AppText style={[styles.sectionLead, { color: colors.textMuted }]}>
          {t('referralRepLead', { points: String(REFERRAL_REPUTATION_POINTS) })}
        </AppText>
        <AppText style={[styles.hint, { color: colors.textMuted }]}>
          {t('referralRepDirectOnly')}
        </AppText>
        <AppText style={[styles.score, { color: colors.primary }]}>
          {t('referralRepScore', { score: String(reputation) })}
        </AppText>
      </AppSubsection>

      <AppSubsection title={t('referralEarnTitle')} defaultOpen icon="pay">
        <AppText style={[styles.sectionLead, { color: colors.textMuted }]}>
          {t('referralLead')}
        </AppText>
        <AppText style={[styles.hint, { color: colors.textMuted }]}>
          {t('referralCommissionSchedule')}
        </AppText>

        <View style={styles.table}>
          <View style={styles.earnHead}>
            <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1.1 }]}>
              {t('referralEarnColGen')}
            </AppText>
            <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 0.9 }]}>
              {t('referralEarnColPct')}
            </AppText>
            <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1.4 }]}>
              {t('referralEarnColPay')}
            </AppText>
          </View>
          {COMMISSION_BANDS.map((band) => {
            const appliedBps = Math.max(sampleLoan.interestBps, curveRateBps || 0);
            const amount = formatCommissionUSD(
              commissionForGeneration(sampleLoan.usdAmount, appliedBps, band.gen)
            );
            const pct = generationCommissionBps(band.gen) / 100;
            return (
              <View key={band.range} style={[styles.earnRow, { borderColor: colors.border }]}>
                <AppText style={[styles.earnCell, { color: colors.text, flex: 1.1 }]}>
                  {t('referralGeneration', { n: band.range })}
                </AppText>
                <AppText
                  style={[styles.earnCell, { color: colors.text, flex: 0.9 }]}
                >{`${pct}%`}</AppText>
                <AppText style={[styles.earnCell, { color: colors.primary, flex: 1.4 }]}>
                  {amount}
                </AppText>
              </View>
            );
          })}
        </View>

        <AppText style={[styles.examplesTitle, { color: colors.text }]}>
          {t('referralEarnExamples')}
        </AppText>
        <View style={styles.earnHead}>
          <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1.2 }]}>
            {t('referralEarnColRank')}
          </AppText>
          <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1 }]}>
            {t('referralEarnColLoan')}
          </AppText>
          <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1.4 }]}>
            {t('referralEarnColPay')}
          </AppText>
        </View>
        {exampleTiers.map((tier) => {
          if (!tier) return null;
          const rank = getRankForLevel(tier.id);
          const rankLabel = formatRankLabel(rank, t(rank.nameKey));
          const appliedBps = Math.max(tier.interestBps, curveRateBps || 0);
          const earn = formatCommissionUSD(directCommissionFromLoan(tier.usdAmount, appliedBps));
          return (
            <View key={tier.id} style={[styles.earnRow, { borderColor: colors.border }]}>
              <AppText style={[styles.earnCell, { color: colors.text, flex: 1.2 }]}>
                {rankLabel}
              </AppText>
              <AppText style={[styles.earnCell, { color: colors.text, flex: 1 }]}>
                {formatUSD(tier.usdAmount)}
              </AppText>
              <AppText style={[styles.earnCell, { color: colors.primary, flex: 1.4 }]}>
                {tier.id === 1
                  ? `${t('referralEarnFirst', { bonus: formatCommissionUSD(ACTIVATION_BONUS_USD) })} · ${t('referralEarnNext', { amount: earn })}`
                  : earn}
              </AppText>
            </View>
          );
        })}

        <Pressable
          onPress={() => {
            setLevelCommsOpen((open) => !open);
          }}
          style={styles.earnToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: levelCommsOpen }}
          accessibilityLabel={t('referralEarnAllLevels', { to: String(MAX_LOAN_LEVEL) })}
        >
          <AppText style={[styles.earnToggleText, { color: colors.primary }]}>
            {t('referralEarnAllLevels', { to: String(MAX_LOAN_LEVEL) })}
          </AppText>
          <AppText style={[styles.chevron, { color: colors.primary }]}>
            {levelCommsOpen ? '–' : '+'}
          </AppText>
        </Pressable>
        {levelCommsOpen ? (
          <View style={styles.levelListBox}>
            <AppText style={[styles.hint, { color: colors.textMuted, marginBottom: 8 }]}>
              {t('referralEarnAllLevelsLead')}
            </AppText>
            <View style={styles.earnHead}>
              <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1.2 }]}>
                {t('referralEarnColRank')}
              </AppText>
              <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1 }]}>
                {t('referralEarnColLoan')}
              </AppText>
              <AppText style={[styles.earnHeadCell, { color: colors.textMuted, flex: 1.4 }]}>
                {t('referralEarnColPay')}
              </AppText>
            </View>
            <View>{levelCommissionRows.map(renderLevelCommission)}</View>
          </View>
        ) : null}
      </AppSubsection>
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 10 },
  sectionLead: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
  earnHead: { flexDirection: 'row', marginBottom: 4 },
  earnHeadCell: { fontSize: 10, fontWeight: '700' },
  earnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1 },
  levelRow: { height: LEVEL_ROW_HEIGHT, paddingVertical: 0 },
  earnCell: { fontSize: 12, fontWeight: '700' },
  table: { marginBottom: 12 },
  examplesTitle: { fontSize: 13, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  earnToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  earnToggleText: { flex: 1, fontSize: 13, fontWeight: '800' },
  chevron: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  levelListBox: { marginTop: 8 },
  founderBadge: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  founderBadgeText: { fontWeight: '500', textAlign: 'center', fontSize: 13 },
  label: { fontSize: 12, fontWeight: '500' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  codeBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  codePart: { fontFamily: 'monospace', fontSize: 15, letterSpacing: 0.6, fontWeight: '600' },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 6,
  },
  linkText: { flex: 1, fontSize: 13, fontWeight: '600' },
  linkHint: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  actions: { gap: 8, marginBottom: 12 },
  action: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: { fontWeight: '600', fontSize: 15 },
  shareDisabled: { opacity: 0.45 },
  meta: { borderRadius: 8, borderWidth: 1, padding: 10 },
  invitedBy: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  metaLine: { fontSize: 12, lineHeight: 18, marginBottom: 4 },
  score: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  warn: { fontSize: 12, color: '#b42318', marginTop: 4 },
  hint: { fontSize: 12, lineHeight: 18 },
});
