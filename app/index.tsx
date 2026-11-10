import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking as RNLinking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { LOCKED_DEEP_LINK_ROOMS, parseAppDeepLink } from '../utils/appDeepLink';
import { getWalletWrapKey } from '../services/walletSession';
import { rankingVisible } from '../utils/fameRankings';
import { rememberAppUrl, takePendingAppUrl } from '../utils/pendingDeepLink';
import { AppKit, useAccount, useAppKit, useProvider } from '@reown/appkit-react-native';
import { parseUnits } from 'ethers';
import { setWalletSigner } from '../services/quatriviumCreditService';
import { useWeb3Balances } from '../hooks/useWeb3Balances';
import { BrandSplash } from '../components/BrandSplash';
import { BusyMark, useBusy } from '../components/BusyLogo';
import { useHomeHandlers } from '../hooks/useHomeHandlers';
import { WalletSection } from '../components/WalletSection';
import { TokenSelector } from '../components/TokenSelector';
import { BalanceDisplay } from '../components/BalanceDisplay';
import { UserMetrics } from '../components/UserMetrics';
import { RankLadder } from '../components/RankLadder';
import { FameLeaderboard } from '../components/FameLeaderboard';
import { LoanTierCard } from '../components/LoanTierCard';
import { LockedLoanCatalog } from '../components/LockedLoanCatalog';
import { AdminPanel } from '../components/AdminPanel';
import { AdminStatusReadout } from '../components/AdminStatusReadout';
import { ApkIntegrityNote } from '../components/ApkIntegrityNote';
import { ActivateCreditSection } from '../components/ActivateCreditSection';
import { AccountWorldCard } from '../components/AccountWorldCard';
import { AccountOnboarding } from '../components/AccountOnboarding';
import { WalletFailedEscape } from '../components/WalletFailedEscape';
import { CreditAccessBanner } from '../components/CreditAccessBanner';
import { CreditAccessGate } from '../components/CreditAccessGate';
import { BrandLogo } from '../components/BrandLogo';
import { ReferralSection } from '../components/ReferralSection';
import { SettingsButton } from '../components/SettingsButton';
import { useEquippedFrame } from '../hooks/useEquippedFrame';
import { isFounderWallet } from '../utils/founderWallet';
import { AppSubsection } from '../components/AppSection';
import { AppWindow } from '../components/AppWindow';
import { HomeHub, type HomeRoom } from '../components/HomeHub';
import { LinkedWalletCard } from '../components/LinkedWalletCard';
import { AppText } from '../components/AppText';
import { PoolSupportSection } from '../components/PoolSupportSection';
import { MilestoneBonusCatalog } from '../components/MilestoneBonusCatalog';
import { FameCanjeSection } from '../components/FameCanjeSection';
import { RachaSection } from '../components/RachaSection';
import { DonateFounderSection } from '../components/DonateFounderSection';
import { ReservaSection } from '../components/ReservaSection';
import { ReferralHistory } from '../components/ReferralHistory';
import { MovementHistory } from '../components/MovementHistory';
import { GraceMoraClock } from '../components/GraceMoraClock';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { RESERVA_MIN_LEVEL } from '../constants/reserva';
import { getConfigurableStables, getSupportedTokens } from '../constants/tokens';
import { isAltaConfigured } from '../constants/altaConfig';
import {
  isAccessPaymentEnabled,
  isContractConfigured,
  isCreditReady,
  isDemoAccount,
  isDonationEnabled,
} from '../constants/rpcConfig';
import {
  adminSeatOpen,
  canPayCreditAccess,
  creditLineLooksActive,
  creditNeedsAccess,
  hasCreditAccess,
  liveCreditReady,
} from '../utils/creditGates';
import { isPhraseBackedUp } from '../services/appWallet';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { usePendingInvite } from '../hooks/usePendingInvite';
import { useUserProfile } from '../profile/ProfileContext';
import { useLoanPaymentReminders } from '../hooks/useLoanPaymentReminders';
import { useAppWallet } from '../wallet/AppWalletContext';
import { useAppMode } from '../wallet/AppModeContext';
import { useFundsConfirm } from '../components/FundsConfirmHost';
import type { TranslationKey } from '../i18n/translations';

export default function HomeScreen() {
  return <HomeScreenWithHooks />;
}

function HomeScreenWithHooks() {
  const { t, rtl } = useI18n();
  const { colors, isDark } = useTheme();
  const { pendingInviteCode, clearPendingInvite } = usePendingInvite();
  const { profile } = useUserProfile();
  const {
    address: appAddress,
    signer: appSigner,
    ready: walletReady,
    failed: walletFailed,
    retry: retryWallet,
  } = useAppWallet();
  const { address: adminAddress, isConnected: adminConnected } = useAccount();
  const { provider: adminProvider } = useProvider();
  const { open: openExternalWallet } = useAppKit();

  const { mode } = useAppMode();
  const { confirmFunds } = useFundsConfirm();
  const tokens = useMemo(() => getSupportedTokens(mode === 'demo'), [mode]);
  const extraStables = useMemo(() => getConfigurableStables(mode === 'demo'), [mode]);
  const [selectedToken, setSelectedToken] = useState(tokens[0]);
  const [room, setRoom] = useState<HomeRoom | null>(null);
  const [phraseBackedUp, setPhraseBackedUp] = useState(false);

  useEffect(() => {
    const apply = (url?: string | null) => {
      if (url) rememberAppUrl(url);
      const link = parseAppDeepLink(url || takePendingAppUrl());
      if (link?.kind === 'room') {
        if (link.room === 'admin') return;
        if (LOCKED_DEEP_LINK_ROOMS.has(link.room) && !getWalletWrapKey()) return;
        setRoom(link.room);
      }
    };
    apply(takePendingAppUrl());
    Linking.getInitialURL()
      .then(apply)
      .catch(() => {});
    RNLinking.getInitialURL()
      .then(apply)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => apply(url));
    const rnSub = RNLinking.addEventListener('url', ({ url }) => apply(url));
    return () => {
      sub.remove();
      rnSub.remove();
    };
  }, []);

  useEffect(() => {
    setSelectedToken(tokens[0]);
  }, [tokens]);

  const walletAddress = appAddress;
  const isConnected = Boolean(walletAddress);

  useEffect(() => {
    let live = true;
    isPhraseBackedUp()
      .then((ok) => {
        if (live) setPhraseBackedUp(ok);
      })
      .catch(() => {
        if (live) setPhraseBackedUp(false);
      });
    return () => {
      live = false;
    };
  }, [walletAddress, room]);

  const {
    balances,
    userInfo,
    loanTiers,
    isLoading: creditChecking,
    gatesReady,
    registrationKnown,
    loanReadsReady,
    refetch,
  } = useWeb3Balances(walletAddress, selectedToken);
  const { userInfo: adminInfo } = useWeb3Balances(
    adminConnected && adminAddress ? adminAddress.toLowerCase() : '',
    selectedToken
  );
  const founderHere =
    Boolean(userInfo.referral.isFundador) ||
    isFounderWallet(walletAddress, userInfo.founderAddress);
  const externalReady = Boolean(adminConnected && adminAddress);
  const adminInfoIsSeat = Boolean(adminInfo.isOwner || adminInfo.isAdmin);
  const appIsSeat = Boolean(userInfo.isOwner || userInfo.isAdmin || userInfo.referral.isFundador);
  const showAdminControls = externalReady ? adminInfoIsSeat : appIsSeat;
  const adminSeat = adminSeatOpen({
    demo: isDemoAccount(),
    connected: externalReady,
    address: adminAddress || walletAddress,
    isAdmin: Boolean(adminInfo.isAdmin || userInfo.isAdmin),
    isOwner: Boolean(adminInfo.isOwner || userInfo.isOwner),
    roster: adminInfo.adminRoster.length ? adminInfo.adminRoster : userInfo.adminRoster,
    founder: founderHere,
  });
  const debtReminder = useLoanPaymentReminders(userInfo);
  const creditReady = isCreditReady();
  const { displayLevel, equippedLevel, wearFrame } = useEquippedFrame(
    walletAddress || '',
    founderHere,
    userInfo.userProgress.nivelActual || 1
  );
  const creditOnChain = creditLineLooksActive(
    creditReady,
    userInfo.isRegistered,
    userInfo.hasActiveLoan
  );
  const altaPaid = hasCreditAccess(userInfo.donatedUsd || 0, Boolean(userInfo.altaPagada));
  const altaVisible = !(mode === 'demo' && !isAltaConfigured()) && !altaPaid;
  const canPayAlta = canPayCreditAccess({
    protocolCanDonate: userInfo.canDonate,
    founderAddress: userInfo.founderAddress,
    accessEnabled: isAccessPaymentEnabled(),
  });
  const creditPaused = false;
  const activeLoan = userInfo.activeLoan;
  const unlockedTiers = loanTiers.filter((tier) => tier.id <= userInfo.userProgress.nivelActual);
  const lockedTiers = loanTiers.filter((tier) => tier.id > userInfo.userProgress.nivelActual);
  const visibleUnlocked = unlockedTiers.slice(-3);
  const liveIdentityReady = liveCreditReady(isDemoAccount(), {
    phraseBackedUp,
  });
  const identityBlocked = !liveIdentityReady;
  const labelTier = (tier: (typeof loanTiers)[number]) => ({
    ...tier,
    name: `${t('level')} ${tier.id}`,
    term: t('termDays' as TranslationKey, { days: String(tier.termDays || 7) }),
  });
  const matchesActiveLoan = (tier: (typeof loanTiers)[number]) => {
    if (!activeLoan) return false;
    if (activeLoan.tierId > 0 && activeLoan.tierId === tier.id) return true;
    try {
      return parseUnits(String(tier.usdAmount), 18).toString() === activeLoan.principalWei;
    } catch {
      return false;
    }
  };
  const hasMatchingPayCard = unlockedTiers.some(matchesActiveLoan);
  const fallbackPayTierId =
    !activeLoan || hasMatchingPayCard
      ? 0
      : activeLoan.tierId || unlockedTiers[unlockedTiers.length - 1]?.id || 0;

  const {
    txLoading,
    handleRegistrarHumano,
    handleSolicitarCredito,
    handleCobrarBonoHito,
    handleCanjearFama,
    handleCanjearFamaRed,
    handleCobrarBonoRacha,
    handlePagar,
    handleDepositarPool,
    handlePagarAcceso,
    handleDonar,
    handleAportarReserva,
    handleProponerRetiroReserva,
    handleAplicarRetiroReserva,
    handleRetirarComisiones,
    handleRetirarComisionesToken,
    handleExecuteProposal,
    handleConfirmProposal,
    handleProposeAddAdmin,
    handleProposeRemoveAdmin,
    handleProposeFeeCollector,
    handleProposeConfirmations,
    handleProposeFundador,
    handleProposeOwner,
    handleProposeSetTokenConfig,
    handleCancelProposal,
    handleLiquidarDeudor,
    handleMarcarMorosoSiVencido,
  } = useHomeHandlers({
    walletAddress,
    userInfo,
    balances,
    selectedToken,
    appSigner,
    adminConnected,
    adminProvider,
    adminAddress,
    openExternalWallet,
    confirmFunds,
    refetch,
    clearPendingInvite,
    loanReadsReady,
  });

  useEffect(() => {
    if (appSigner) setWalletSigner(appSigner);
  }, [appSigner]);

  useEffect(() => {
    if (room === 'admin' && !adminSeat) {
      setRoom(null);
    }
  }, [room, adminSeat]);

  useEffect(() => {
    if (room === 'donate' && mode === 'demo') {
      setRoom(null);
    }
  }, [room, mode]);

  const waitingChain = !gatesReady;
  const needPay = !waitingChain && altaVisible;
  const needRegister = !waitingChain && !userInfo.isRegistered && !founderHere;
  const servicesOpen = !waitingChain && !needPay && !needRegister;
  useBusy(txLoading);

  const roomLocked = (id: HomeRoom) =>
    id !== 'wallet' && id !== 'alta' && id !== 'admin' && !servicesOpen;

  const denyUse = () => {
    Alert.alert(
      needPay ? t('creditAccessTitle') : t('register'),
      needPay ? t('creditAccessLook') : t('creditAccessRegisterNeed')
    );
  };

  const openRoom = (id: HomeRoom) => {
    setRoom(id);
  };

  return (
    <AccountOnboarding
      walletAddress={walletAddress}
      walletReady={walletReady}
      walletFailed={walletFailed}
      onRetryWallet={retryWallet}
      isRegistered={userInfo.isRegistered}
      isLoading={txLoading}
      inviteCode={pendingInviteCode}
      canRegisterOnChain={Boolean(creditReady)}
      registrationKnown={registrationKnown}
      skipAutoRegister={founderHere}
      onRegister={() => void handleRegistrarHumano()}
      onInviteLocked={() => {
        void clearPendingInvite();
      }}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <View style={styles.topBar}>
            <BrandLogo size={44} />
            <View style={styles.topBarText}>
              <View style={styles.titleRow}>
                <AppText style={[styles.title, { color: colors.text }]}>{APP_DISPLAY_NAME}</AppText>
                <View
                  style={[
                    styles.worldBadge,
                    {
                      borderColor: mode === 'demo' ? colors.warnText : colors.success,
                      backgroundColor: mode === 'demo' ? colors.warnBg : colors.chip,
                    },
                  ]}
                >
                  <AppText
                    style={[
                      styles.worldBadgeText,
                      { color: mode === 'demo' ? colors.warnText : colors.success },
                    ]}
                  >
                    {mode === 'demo' ? t('appModeDemo') : t('appModeLive')}
                  </AppText>
                </View>
              </View>
              <AppText
                style={[styles.subtitle, rtl && styles.rtlText, { color: colors.textMuted }]}
              >
                {profile.displayName
                  ? t('helloName', { name: profile.displayName })
                  : t('subtitle')}
              </AppText>
            </View>
            <SettingsButton
              isFounder={founderHere}
              founderAddress={userInfo.founderAddress}
              naturalLevel={userInfo.userProgress.nivelActual || 1}
            />
          </View>

          {needPay || needRegister ? (
            <CreditAccessBanner
              paidUsd={userInfo.donatedUsd || 0}
              altaPaid={Boolean(userInfo.altaPagada)}
              canPay={canPayAlta}
              isLoading={txLoading}
              appWalletUsdt={balances.tokenBalance}
              needRegister={needRegister}
              canRegister={Boolean(creditReady)}
              onPay={() => void handlePagarAcceso()}
              onRegister={() => void handleRegistrarHumano()}
            />
          ) : null}

          {walletReady && (walletFailed || !walletAddress) ? (
            <View style={[styles.configWarn, { backgroundColor: colors.warnBg }]}>
              <AppText style={{ color: colors.warnText }}>{t('appWalletFailed')}</AppText>
              <WalletFailedEscape onRetry={retryWallet} />
            </View>
          ) : null}

          <GraceMoraClock
            hasActiveLoan={userInfo.hasActiveLoan}
            vencimiento={userInfo.activeLoan?.vencimiento}
            proximaCuota={userInfo.activeLoan?.proximaCuota}
            isFounder={userInfo.referral.isFundador}
          />
          <AccountWorldCard />
          {mode === 'demo' && !isContractConfigured() && (
            <AppText
              style={[
                styles.configWarn,
                rtl && styles.rtlText,
                { backgroundColor: colors.warnBg, color: colors.warnText },
              ]}
            >
              {t('configWarn')}
            </AppText>
          )}

          <AppText style={[styles.hubTitle, { color: colors.text }]}>{t('hubChoose')}</AppText>
          {!servicesOpen ? (
            <AppText style={[styles.lockedHint, rtl && styles.rtlText, { color: colors.warnText }]}>
              {needPay ? t('creditAccessLook') : t('creditAccessRegisterNeed')}
            </AppText>
          ) : null}
          {walletAddress ? <LinkedWalletCard internalWallet={walletAddress} compact /> : null}
          <HomeHub
            onOpen={openRoom}
            tiles={[
              ...(needPay
                ? [
                    {
                      id: 'alta' as const,
                      title: t('creditAccessTitle'),
                      lead: t('creditAccessPay'),
                      icon: 'pay' as const,
                      locked: false,
                    },
                  ]
                : []),
              {
                id: 'wallet',
                title: t('sectionAccount'),
                lead: mode === 'demo' ? t('hubWalletLeadDemo') : t('hubWalletLead'),
                icon: 'wallet',
                locked: false,
              },
              {
                id: 'credit',
                title: t('sectionCreditLine'),
                lead: creditOnChain ? t('hubCreditLeadActive') : t('hubCreditLead'),
                icon: 'id',
                locked: roomLocked('credit'),
              },
              {
                id: 'loans',
                title: t('loanLevels'),
                lead: t('hubLoansLead'),
                icon: 'bank',
                locked: roomLocked('loans'),
              },
              {
                id: 'ranks',
                title: t('rankGalleryTitle'),
                lead: t('hubRanksLead'),
                icon: 'star',
                locked: roomLocked('ranks'),
              },
              {
                id: 'fame',
                title: t('fameBoardTitle'),
                lead: rankingVisible(userInfo.userProgress.nivelActual)
                  ? t('hubFameLead')
                  : t('hubFameLeadLocked'),
                icon: 'chart',
                locked: roomLocked('fame'),
              },
              {
                id: 'bonuses',
                title: t('sectionBonuses'),
                lead: t('hubBonusesLead'),
                icon: 'star',
                locked: roomLocked('bonuses'),
              },
              {
                id: 'canje',
                title: t('hubCanje'),
                lead: t('hubCanjeLead'),
                icon: 'pay',
                locked: roomLocked('canje'),
              },
              {
                id: 'network',
                title: t('referralNetwork'),
                lead: t('hubNetworkLead'),
                icon: 'people',
                locked: roomLocked('network'),
              },
              {
                id: 'history',
                title: t('historyTitle'),
                lead: t('hubHistoryLead'),
                icon: 'history',
                locked: roomLocked('history'),
              },
              {
                id: 'pool',
                title: t('sectionPool'),
                lead: t('hubPoolLead'),
                icon: 'pool',
                locked: roomLocked('pool'),
              },
              {
                id: 'reserva',
                title: t('reservaTitle'),
                lead:
                  userInfo.userProgress.nivelActual >= RESERVA_MIN_LEVEL
                    ? t('hubReservaLead')
                    : t('hubReservaLeadLocked'),
                icon: 'lock',
                locked: roomLocked('reserva'),
              },
              ...(mode === 'demo'
                ? []
                : [
                    {
                      id: 'donate' as const,
                      title: t('donateTitle'),
                      lead: t('hubDonateLead'),
                      icon: 'deposit' as const,
                      locked: roomLocked('donate'),
                    },
                  ]),
              {
                id: 'racha',
                title: t('rachaTitle'),
                lead: t('hubRachaLead'),
                icon: 'star',
                locked: roomLocked('racha'),
              },
              ...(adminSeat
                ? [
                    {
                      id: 'admin' as const,
                      title: t('admin'),
                      lead: t('hubAdminLead'),
                      icon: 'shield' as const,
                      locked: roomLocked('admin'),
                    },
                  ]
                : []),
            ]}
          />
        </ScrollView>

        <AppWindow
          visible={room === 'wallet'}
          title={t('sectionAccount')}
          lead={t('sectionAccountLead')}
          onClose={() => setRoom(null)}
        >
          <AppSubsection title={t('subsectionWallet')} icon="plug">
            <WalletSection
              walletAddress={walletAddress}
              bnbBalance={balances.bnbBalance}
              tokenBalance={balances.tokenBalance}
              selectedToken={selectedToken}
              isLoading={txLoading}
              onSent={refetch}
            />
          </AppSubsection>
          {isConnected ? (
            <AppSubsection title={t('subsectionBalances')} icon="wallet">
              {tokens.length > 1 ? (
                <TokenSelector
                  tokens={tokens}
                  selectedToken={selectedToken}
                  onSelectToken={setSelectedToken}
                />
              ) : null}
              <BalanceDisplay balances={balances} selectedTokenSymbol={selectedToken.symbol} />
            </AppSubsection>
          ) : null}
        </AppWindow>

        <AppWindow
          visible={room === 'alta'}
          title={t('creditAccessTitle')}
          lead={t('creditAccessLead')}
          onClose={() => setRoom(null)}
        >
          <CreditAccessGate
            canPay={canPayAlta}
            isLoading={txLoading}
            walletAddress={walletAddress || ''}
            appWalletUsdt={balances.tokenBalance}
            onPay={() => void handlePagarAcceso()}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'credit'}
          title={t('sectionCreditLine')}
          lead={t('sectionCreditLineLead')}
          onClose={() => setRoom(null)}
        >
          {creditOnChain ? (
            <>
              <CreditAccessBanner
                paidUsd={userInfo.donatedUsd || 0}
                altaPaid={Boolean(userInfo.altaPagada)}
                canPay={canPayAlta}
                isLoading={txLoading}
                appWalletUsdt={balances.tokenBalance}
                tokenSymbol={selectedToken.symbol}
                onPay={() => void handlePagarAcceso()}
              />
              <ActivateCreditSection
                isRegistered={creditOnChain}
                checking={false}
                hasActiveLoan={userInfo.hasActiveLoan}
                onRegister={() => void handleRegistrarHumano()}
                onGoLoans={() => setRoom('loans')}
                isLoading={txLoading}
                paused={creditPaused}
                contractReady={creditReady}
              />
            </>
          ) : (
            <AppSubsection title={t('subsectionActivate')} icon="id">
              <CreditAccessBanner
                paidUsd={userInfo.donatedUsd || 0}
                altaPaid={Boolean(userInfo.altaPagada)}
                canPay={canPayAlta}
                isLoading={txLoading}
                appWalletUsdt={balances.tokenBalance}
                tokenSymbol={selectedToken.symbol}
                onPay={() => void handlePagarAcceso()}
              />
              <ActivateCreditSection
                isRegistered={false}
                checking={creditChecking}
                hasActiveLoan={userInfo.hasActiveLoan}
                onRegister={() => void handleRegistrarHumano()}
                onGoLoans={() => setRoom('loans')}
                isLoading={txLoading}
                paused={creditPaused}
                contractReady={creditReady}
              />
            </AppSubsection>
          )}
          {creditOnChain || !creditChecking ? (
            <AppSubsection title={t('subsectionRank')} icon="star">
              <UserMetrics
                userInfo={userInfo}
                reminder={debtReminder}
                showDebt={false}
                frameLevel={displayLevel}
                onOpenBonuses={() => setRoom('bonuses')}
                onOpenRanks={() => setRoom('ranks')}
                lpUsd={Number.parseFloat(balances.lpBalance) || 0}
                isPaying={txLoading}
              />
            </AppSubsection>
          ) : null}
          {userInfo.activeLoan ? (
            <AppSubsection title={t('subsectionDebt')} icon="warning">
              <UserMetrics
                userInfo={userInfo}
                reminder={debtReminder}
                showRank={false}
                showDebt
                onPayLoan={() => (servicesOpen ? handlePagar('installment') : denyUse())}
                onPayAll={() => (servicesOpen ? handlePagar('all') : denyUse())}
                onPayCount={(count) => (servicesOpen ? handlePagar(count) : denyUse())}
                isPaying={txLoading}
              />
            </AppSubsection>
          ) : null}
        </AppWindow>

        <AppWindow
          visible={room === 'loans'}
          title={t('loanLevels')}
          lead={t('sectionLoansLead')}
          onClose={() => setRoom(null)}
        >
          <CreditAccessBanner
            paidUsd={userInfo.donatedUsd || 0}
            altaPaid={Boolean(userInfo.altaPagada)}
            canPay={canPayAlta}
            isLoading={txLoading}
            appWalletUsdt={balances.tokenBalance}
            tokenSymbol={selectedToken.symbol}
            onPay={() => void handlePagarAcceso()}
          />
          {tokens.length > 1 ? (
            <TokenSelector
              tokens={tokens}
              selectedToken={selectedToken}
              onSelectToken={setSelectedToken}
            />
          ) : null}
          <AppSubsection title={t('subsectionUnlocked')} icon="bank">
            {visibleUnlocked.map((tier) => (
              <LoanTierCard
                key={tier.id}
                tier={labelTier(tier)}
                userLevel={userInfo.userProgress.nivelActual}
                hasActiveLoan={userInfo.hasActiveLoan}
                isDelinquent={userInfo.isDelinquent}
                paused={creditPaused}
                isActiveTier={
                  matchesActiveLoan(tier) ||
                  Boolean(activeLoan && !hasMatchingPayCard && tier.id === fallbackPayTierId)
                }
                dueLabel={activeLoan?.totalDueLabel}
                cuotaLabel={activeLoan?.cuotaLabel}
                cuotasPagadas={activeLoan?.cuotasPagadas}
                cuotasTotales={activeLoan?.cuotasTotales}
                remainingLabel={activeLoan?.remainingLabel}
                isLoading={txLoading}
                curveRateBps={userInfo.curveRateBps}
                ultimoPrestamoTimestamp={Math.max(
                  userInfo.userProgress.cooldownAncla || 0,
                  userInfo.userProgress.ultimoPrestamoTimestamp || 0
                )}
                cooldownRestante={userInfo.userProgress.cooldownRestante}
                isRegistered={creditOnChain}
                identityBlocked={identityBlocked}
                accessBlocked={
                  !servicesOpen ||
                  creditNeedsAccess(userInfo.donatedUsd || 0, Boolean(userInfo.altaPagada))
                }
                contractReady={creditReady}
                onActivateCredit={() => setRoom('credit')}
                onRequestLoan={servicesOpen ? handleSolicitarCredito : () => denyUse()}
                onPayLoan={() => (servicesOpen ? handlePagar('installment') : denyUse())}
                onPayAll={() => (servicesOpen ? handlePagar('all') : denyUse())}
                onPayCount={(count) => (servicesOpen ? handlePagar(count) : denyUse())}
                showMilestoneBonus
              />
            ))}
          </AppSubsection>
          {lockedTiers.length ? (
            <AppSubsection title={t('subsectionLocked')} icon="lock">
              <AppText
                style={[styles.lockedHint, rtl && styles.rtlText, { color: colors.textMuted }]}
              >
                {t('lockedLevelsHint')}
              </AppText>
              <LockedLoanCatalog
                tiers={lockedTiers}
                labelTier={labelTier}
                userLevel={userInfo.userProgress.nivelActual}
                hasActiveLoan={userInfo.hasActiveLoan}
                isDelinquent={userInfo.isDelinquent}
                paused={creditPaused}
                isLoading={txLoading}
                curveRateBps={userInfo.curveRateBps}
                ultimoPrestamoTimestamp={0}
                isRegistered={creditOnChain}
                identityBlocked={identityBlocked}
                accessBlocked={
                  !servicesOpen ||
                  creditNeedsAccess(userInfo.donatedUsd || 0, Boolean(userInfo.altaPagada))
                }
                contractReady={creditReady}
                onActivateCredit={() => setRoom('credit')}
                onRequestLoan={servicesOpen ? handleSolicitarCredito : () => denyUse()}
                onPayLoan={() => (servicesOpen ? handlePagar('installment') : denyUse())}
                onPayAll={() => (servicesOpen ? handlePagar('all') : denyUse())}
                onPayCount={(count) => (servicesOpen ? handlePagar(count) : denyUse())}
                showMilestoneBonus
              />
            </AppSubsection>
          ) : null}
        </AppWindow>

        <AppWindow
          visible={room === 'ranks'}
          title={t('rankGalleryTitle')}
          lead={t('rankGalleryLead')}
          onClose={() => setRoom(null)}
        >
          <RankLadder
            userLevel={userInfo.userProgress.nivelActual}
            isFounder={founderHere}
            equippedLevel={equippedLevel}
            onWearFrame={(level) => {
              void wearFrame(level);
            }}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'fame'}
          title={t('fameBoardTitle')}
          lead={
            rankingVisible(userInfo.userProgress.nivelActual)
              ? t('fameBoardLead')
              : t('fameBoardLocked')
          }
          onClose={() => setRoom(null)}
        >
          <FameLeaderboard
            enabled={room === 'fame'}
            unlocked={rankingVisible(userInfo.userProgress.nivelActual)}
            walletAddress={walletAddress || ''}
            poolCashUsd={Number(balances.poolCash) || 0}
            poolNavUsd={Number(balances.poolBalance) || 0}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'bonuses'}
          title={t('sectionBonuses')}
          lead={t('sectionBonusesLead')}
          onClose={() => setRoom(null)}
        >
          <AppSubsection title={t('sectionBonuses')} icon="star">
            <MilestoneBonusCatalog
              userLevel={userInfo.userProgress.nivelActual}
              lastHito={userInfo.userProgress.lastHito}
              claimable={userInfo.userProgress.bonusPending}
              canClaim={Boolean(servicesOpen && creditReady && userInfo.canClaimHitos)}
              maxLevel={userInfo.maxLoanLevel}
              isPaying={txLoading}
              onClaim={servicesOpen ? handleCobrarBonoHito : () => denyUse()}
            />
          </AppSubsection>
        </AppWindow>

        <AppWindow
          visible={room === 'canje'}
          title={t('sectionCanje')}
          lead={t('sectionCanjeLead')}
          onClose={() => setRoom(null)}
        >
          {walletAddress ? <LinkedWalletCard internalWallet={walletAddress} compact /> : null}
          <FameCanjeSection
            famaCaja={userInfo.famaCaja || 0}
            famaRed={userInfo.famaRed || 0}
            famaRacha={userInfo.famaRacha || 0}
            famaCanjeada={userInfo.famaCanjeada || 0}
            famaRedCanjeada={userInfo.famaRedCanjeada || 0}
            famaDisponible={userInfo.famaDisponible || 0}
            famaRedDisponible={userInfo.famaRedDisponible || 0}
            canRedeem={Boolean(
              servicesOpen &&
                creditReady &&
                userInfo.canCanjearFama &&
                userInfo.isRegistered &&
                !userInfo.isDelinquent
            )}
            tokenSymbol={selectedToken.symbol}
            isPaying={txLoading}
            onRedeem={(fama) => void handleCanjearFama(fama)}
            onRedeemRed={(fama) => void handleCanjearFamaRed(fama)}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'donate' && mode !== 'demo'}
          title={t('donateTitle')}
          lead={t('sectionDonateLead')}
          onClose={() => setRoom(null)}
        >
          {walletAddress ? <LinkedWalletCard internalWallet={walletAddress} compact /> : null}
          <DonateFounderSection
            isLoading={txLoading}
            tokenSymbol={selectedToken.symbol}
            tokenSupported={userInfo.isTokenSupported}
            walletConnected={Boolean(walletAddress)}
            founderAddress={userInfo.founderAddress}
            donatedUsd={userInfo.donatedUsd || 0}
            altaPaid={Boolean(userInfo.altaPagada)}
            lpUsd={Number.parseFloat(balances.lpBalance) || 0}
            canSend={servicesOpen && isDonationEnabled()}
            onDonate={servicesOpen ? handleDonar : () => denyUse()}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'network'}
          title={t('referralNetwork')}
          lead={t('sectionInviteLead')}
          onClose={() => setRoom(null)}
        >
          <ReferralSection
            walletAddress={walletAddress}
            isRegistered={creditOnChain}
            isRestricted={userInfo.isDelinquent}
            curveRateBps={userInfo.curveRateBps}
            referral={
              userInfo.referral ?? {
                padre: '',
                fundador: '',
                isFundador: false,
                bonoActivacionCobrado: false,
                royaltiesCongeladas: false,
              }
            }
            reputation={userInfo.reputation}
            networkPoints={userInfo.networkPoints}
            networkBonusThreshold={userInfo.networkBonusThreshold}
          >
            {walletAddress ? (
              <AppSubsection title={t('referralHistoryTitle')} defaultOpen icon="history">
                <ReferralHistory
                  variant="board"
                  walletAddress={walletAddress}
                  enabled={Boolean(walletAddress)}
                  onOpenPeople={() => setRoom('people')}
                />
              </AppSubsection>
            ) : null}
          </ReferralSection>
        </AppWindow>

        <AppWindow
          visible={room === 'people'}
          title={t('referralPeopleTitle')}
          lead={t('referralPeopleLead')}
          onClose={() => setRoom('network')}
        >
          <ReferralHistory
            variant="people"
            walletAddress={walletAddress}
            enabled={room === 'people' && Boolean(walletAddress)}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'history'}
          title={`${t('historyTitle')} · ${mode === 'demo' ? t('appModeDemo') : t('appModeLive')}`}
          lead={t('historyLead')}
          onClose={() => setRoom(null)}
        >
          <MovementHistory
            walletAddress={walletAddress}
            enabled={room === 'history'}
            level={userInfo.userProgress.nivelActual}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'reserva'}
          title={t('reservaTitle')}
          lead={t('hubReservaLead')}
          onClose={() => setRoom(null)}
        >
          {walletAddress ? <LinkedWalletCard internalWallet={walletAddress} compact /> : null}
          <ReservaSection
            walletAddress={walletAddress || ''}
            signer={appSigner}
            tokenSymbol={selectedToken.symbol}
            identityBlocked={mode !== 'demo' && identityBlocked}
            delinquent={userInfo.isDelinquent}
            paused={!servicesOpen}
            hasPadre={Boolean(userInfo.referral?.padre && !/^0x0+$/i.test(userInfo.referral.padre))}
            userLevel={userInfo.userProgress.nivelActual}
            isLoading={txLoading}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'pool'}
          title={t('sectionPool')}
          lead={t('sectionPoolLead')}
          onClose={() => setRoom(null)}
        >
          {mode !== 'demo' && walletAddress ? (
            <LinkedWalletCard internalWallet={walletAddress} compact />
          ) : null}
          {tokens.length > 1 ? (
            <TokenSelector
              tokens={tokens}
              selectedToken={selectedToken}
              onSelectToken={setSelectedToken}
            />
          ) : null}
          <PoolSupportSection
            isLoading={txLoading}
            tokenSymbol={selectedToken.symbol}
            tokenSupported={userInfo.isTokenSupported}
            poolBalance={balances.poolBalance}
            poolOutstanding={balances.poolOutstanding}
            poolCash={balances.poolCash}
            moneyUnconfirmed={balances.moneyUnconfirmed}
            lpBalance={balances.lpBalance}
            walletConnected={Boolean(walletAddress)}
            paused={creditPaused}
            onDepositPool={servicesOpen ? handleDepositarPool : () => denyUse()}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'racha'}
          title={t('sectionRacha')}
          lead={t('sectionRachaLead')}
          onClose={() => setRoom(null)}
        >
          {walletAddress ? <LinkedWalletCard internalWallet={walletAddress} compact /> : null}
          <RachaSection
            racha={
              userInfo.racha || {
                dias: 0,
                diasMax: 0,
                famaDias: 0,
                hitoCobrado: 0,
                siguienteHito: 0,
                bonoPendienteUsd: 0,
                graciaVigente: false,
              }
            }
            canUse={Boolean(
              servicesOpen &&
                creditReady &&
                userInfo.canRacha &&
                userInfo.isRegistered &&
                !userInfo.isDelinquent
            )}
            isPaying={txLoading}
            onClaim={() => (servicesOpen ? void handleCobrarBonoRacha() : denyUse())}
          />
        </AppWindow>

        <AppWindow
          visible={room === 'admin'}
          title={t('admin')}
          lead={t('adminLead')}
          onClose={() => setRoom(null)}
        >
          {tokens.length > 1 ? (
            <TokenSelector
              tokens={tokens}
              selectedToken={selectedToken}
              onSelectToken={setSelectedToken}
            />
          ) : null}
          <ApkIntegrityNote />
          <AdminStatusReadout paused={creditPaused} admins={userInfo.adminRoster || []} />
          {showAdminControls ? (
            <AdminPanel
              isOwner={externalReady ? adminInfo.isOwner : Boolean(userInfo.isOwner || founderHere)}
              isAdmin={externalReady ? adminInfo.isAdmin : userInfo.isAdmin}
              isLoading={txLoading}
              tokenSymbol={selectedToken.symbol}
              tokenAddress={selectedToken.address}
              onWithdrawFees={handleRetirarComisiones}
              onWithdrawTokenFees={handleRetirarComisionesToken}
              onExecuteProposal={handleExecuteProposal}
              onConfirmProposal={handleConfirmProposal}
              onCancelProposal={handleCancelProposal}
              onProposeAddAdmin={handleProposeAddAdmin}
              onProposeRemoveAdmin={handleProposeRemoveAdmin}
              onProposeFeeCollector={handleProposeFeeCollector}
              onProposeConfirmations={handleProposeConfirmations}
              onProposeFundador={handleProposeFundador}
              onProposeOwner={handleProposeOwner}
              extraStables={extraStables}
              onProposeSetTokenConfig={handleProposeSetTokenConfig}
              onLiquidar={handleLiquidarDeudor}
              onMarcarMoroso={handleMarcarMorosoSiVencido}
              onAportarReserva={handleAportarReserva}
              onProponerRetiroReserva={handleProponerRetiroReserva}
              onAplicarRetiroReserva={handleAplicarRetiroReserva}
              adminRoster={
                adminInfo.adminRoster.length ? adminInfo.adminRoster : userInfo.adminRoster
              }
              requiredConfirmations={
                adminInfo.requiredConfirmations || userInfo.requiredConfirmations
              }
              proposalCount={adminInfo.proposalCount || userInfo.proposalCount}
              openProposal={adminInfo.openProposal || userInfo.openProposal}
              founderAddress={adminInfo.founderAddress || userInfo.founderAddress}
              ownerAddress={adminInfo.ownerAddress || userInfo.ownerAddress}
            />
          ) : (
            <AppText style={{ color: colors.text }}>{t('appWalletAdminConnect')}</AppText>
          )}
        </AppWindow>
        <AppKit />
        <BusyMark />
        {waitingChain ? (
          <View style={styles.bootCover}>
            <BrandSplash />
          </View>
        ) : null}
      </SafeAreaView>
    </AccountOnboarding>
  );
}

const styles = StyleSheet.create({
  bootCover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
    marginBottom: 20,
    gap: 10,
  },
  topBarText: {
    flex: 1,
    paddingRight: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  worldBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  worldBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  configWarn: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  rtlText: {
    textAlign: 'right',
  },
  hubTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  lockedHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
});
