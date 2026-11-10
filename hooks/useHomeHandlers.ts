/**
 * useHomeHandlers — lógica de cada acción del usuario en la pantalla principal.
 * Extraído de app/index.tsx para reducir complejidad del componente raíz.
 * Cada handler valida precondiciones y delega al hook useWeb3Transactions.
 */
import { useRef, useState } from 'react';
import {
  Contract,
  Interface,
  parseEther,
  parseUnits,
  type Eip1193Provider,
  type Signer,
} from 'ethers';
import { Alert, Linking } from 'react-native';
import { getEthersSignerFromProvider } from '../web3Config';
import { CONTRACT_ABI, ERC20_ABI } from '../constants/contractConfig';
import { getTokenMeta, isOfficialWorldToken } from '../constants/tokens';
import { setWalletSigner, QuatriviumCreditService } from '../services/quatriviumCreditService';
import { aportarReservaBote, reservaErrorKey } from '../services/reservaService';
import { recordMovement } from '../services/movementHistory';
import { useWeb3Transactions } from './useWeb3Transactions';
import { lockSponsorOnce } from '../services/sponsorLock';
import {
  getProviderWithFallback,
  isAccessPaymentEnabled,
  isCreditReady,
  isDemoAccount,
  isDemoMode,
  isDonationEnabled,
  isDonationVisible,
  getContractAddress,
} from '../constants/rpcConfig';
import { showNotice } from '../utils/appNotice';
import { ALTA_ABI, getAltaAddress, isAltaConfigured } from '../constants/altaConfig';
import {
  accessPayUsdt,
  creditNeedsAccess,
  creditNeedsPhrase,
  hasCreditAccess,
} from '../utils/creditGates';
import { enviarToken, isPhraseBackedUp } from '../services/appWallet';
import { loadRequiredExternalWallet } from '../services/linkedWallet';
import { ensureExternalWalletOnAppChain } from '../utils/walletChain';
import { openWalletConnect } from '../utils/openWalletConnect';
import { esperaParaVolverAPedir } from '../utils/creditCooldown';
import { markLoanFullyPaid } from '../utils/loanPaidMark';
import { formatCooldown, formatUSD, parsePositiveDecimal } from '../utils/formatters';
import { milestoneBonusUsd } from '../constants/loanTiers';
import { FAMA_CANJE_POR_USDT, usdtFromFama } from '../constants/fama';
import { FAMA_ABI } from '../constants/famaConfig';
import { useI18n } from '../i18n/LanguageContext';
import { humanizeTxError, networkFailureError } from '../utils/txErrors';
import type { FundsConfirmPurpose } from '../services/fundsConfirm';
import { fundsTx, quoteNetworkFee } from '../utils/fundsConfirmGate';
import { getReservaAddress, RESERVA_ABI } from '../constants/reservaConfig';
import { getRealDonationWallet } from '../constants/deployedAddresses';
import type { LoanTier, UserInfo } from './useWeb3Balances';
import type { Token } from '../constants/tokens';

const ARBITRUM_TESTNET_FAUCET = 'https://faucet.quicknode.com/arbitrum/sepolia';
const MIN_GAS_WEI = parseEther('0.0001');

async function quotedFunds(
  amount: string,
  destination: string,
  call?: { to: string; abi: string[]; method: string; args?: unknown[] }
) {
  let fee = 'no disponible';
  try {
    const provider = getProviderWithFallback();
    const data = call
      ? new Interface(call.abi).encodeFunctionData(call.method, call.args ?? [])
      : '0x';
    fee = await quoteNetworkFee(provider, { to: call?.to || destination, data });
  } catch {
    fee = 'no disponible';
  }
  return fundsTx(amount, destination, fee);
}

async function famaContract(): Promise<string | null> {
  try {
    const credit = new Contract(getContractAddress(), CONTRACT_ABI, getProviderWithFallback());
    const addr = String(await credit.famaHermano());
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr) || /^0x0{40}$/i.test(addr)) return null;
    return addr;
  } catch {
    return null;
  }
}

async function readOnChainEth(address: string): Promise<bigint | null> {
  try {
    return await getProviderWithFallback().getBalance(address);
  } catch {
    return null;
  }
}

async function tokenBalanceOf(token: string, wallet: string): Promise<bigint | null> {
  try {
    const erc20 = new Contract(token, ERC20_ABI, getProviderWithFallback());
    return BigInt(await erc20.balanceOf(wallet));
  } catch {
    return null;
  }
}

export interface HomeHandlersParams {
  walletAddress: string | null | undefined;
  userInfo: UserInfo;
  balances: { tokenBalance: string; bnbBalance: string };
  selectedToken: Token;
  appSigner: Signer | null | undefined;
  adminConnected: boolean;
  adminProvider: unknown;
  adminAddress?: string;
  openExternalWallet?: () => void;
  confirmFunds: (
    purpose?: FundsConfirmPurpose,
    details?: ReturnType<typeof fundsTx>
  ) => Promise<boolean>;
  refetch: () => void;
  clearPendingInvite: () => Promise<void>;
  loanReadsReady?: boolean;
}

export const useHomeHandlers = ({
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
  loanReadsReady = false,
}: HomeHandlersParams) => {
  const { t } = useI18n();
  const accesoBusy = useRef(false);
  const busyDepth = useRef(0);
  const [actionBusy, setActionBusy] = useState(false);

  const {
    isLoading: txLoading,
    registrarHumano,
    solicitarPrestamo,
    cobrarBonoHito,
    donarProyecto,
    canjearFama,
    canjearFamaRed,
    cobrarBonoRacha,
    pagarPrestamo,
    pagarCuotas,
    depositarLiquidez,
    cancelAdminAction,
    executeAdminAction,
    confirmAdminAction,
    proposeAddAdmin,
    proposeRemoveAdmin,
    proposeFundador,
    liquidarDeudor,
    marcarMorosoSiVencido,
  } = useWeb3Transactions();

  /** Ejecuta una acción admin cambiando temporalmente el signer al de MetaMask/WalletConnect. */
  const runAsAdmin = async (fn: () => Promise<void>) => {
    const appIsSeat = Boolean(
      userInfo.isAdmin || userInfo.isOwner || userInfo.referral?.isFundador
    );
    const useAppSigner =
      appIsSeat && Boolean(appSigner && walletAddress) && (!adminConnected || !adminProvider);
    if (!useAppSigner && (!adminConnected || !adminProvider)) {
      Alert.alert(t('admin'), t('appWalletAdminConnect'));
      return;
    }
    try {
      let signer = appSigner;
      let adminWallet = String(walletAddress || '');
      if (!useAppSigner) {
        try {
          await Promise.race([
            ensureExternalWalletOnAppChain(adminProvider as Eip1193Provider),
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(networkFailureError(isDemoAccount() || isDemoMode())),
                25_000
              );
            }),
          ]);
        } catch (error) {
          Alert.alert(t('connect'), humanizeTxError(error));
          return;
        }
        signer = await getEthersSignerFromProvider(adminProvider as Eip1193Provider);
        if (!signer) throw new Error('admin');
        adminWallet = await signer.getAddress();
      }
      if (!signer || !adminWallet) throw new Error('admin');
      const adminEth = await readOnChainEth(adminWallet);
      if (adminEth === null || adminEth < MIN_GAS_WEI) {
        if (isDemoAccount() || isDemoMode()) {
          Alert.alert(t('errNeedGas'), t('errNeedGasAdmin'), [
            { text: t('cancel'), style: 'cancel' },
            { text: t('ready'), onPress: () => void Linking.openURL(ARBITRUM_TESTNET_FAUCET) },
          ]);
        } else {
          Alert.alert(t('errNeedGas'), t('errNeedGas'));
        }
        return;
      }
      setWalletSigner(signer);
      await fn();
    } catch (error) {
      Alert.alert(t('admin'), humanizeTxError(error));
    } finally {
      if (appSigner) setWalletSigner(appSigner);
    }
  };

  const ensureGasForTx = async (): Promise<boolean> => {
    if (!walletAddress) return false;
    let onChain = await readOnChainEth(walletAddress);
    if (onChain === null) {
      const parsed = Number.parseFloat(balances.bnbBalance);
      onChain = Number.isFinite(parsed) && parsed > 0 ? parseEther(parsed.toFixed(6)) : 0n;
    }
    const demoGas = isDemoAccount() || isDemoMode();
    if (onChain < MIN_GAS_WEI) {
      if (demoGas) {
        showNotice(t('errNeedGas'), t('errNeedGasTestnet'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('openFaucet'), onPress: () => void Linking.openURL(ARBITRUM_TESTNET_FAUCET) },
        ]);
      } else {
        showNotice(t('errNeedGas'), t('errNeedGas'));
      }
      return false;
    }
    return true;
  };

  const ensureCreditReady = (): boolean => {
    if (isCreditReady()) return true;
    showNotice(
      t(isDemoAccount() ? 'contract' : 'appModeLive'),
      t(isDemoAccount() ? 'configureContract' : 'liveCreditNotReady')
    );
    return false;
  };

  const askToLinkExternal = (message: string) => {
    showNotice(t('linkWalletTitle'), message, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('connectWallet'),
        onPress: () => void openWalletConnect(() => openExternalWallet?.()),
      },
    ]);
  };

  const requireLinkedExternal = async (): Promise<string> => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return '';
    }
    const linked = await loadRequiredExternalWallet(walletAddress);
    if (!linked) {
      askToLinkExternal(t('linkWalletNeedFunds'));
      return '';
    }
    if (!adminConnected || !adminProvider) {
      askToLinkExternal(t('linkWalletNeed'));
      return '';
    }
    if (String(adminAddress || '').toLowerCase() !== linked.toLowerCase()) {
      askToLinkExternal(t('linkWalletMismatch'));
      return '';
    }
    return linked;
  };

  const fundInternalFromExternal = async (
    amountWei: string,
    tokenAddress: string
  ): Promise<boolean> => {
    if (!walletAddress) return false;
    const need = BigInt(amountWei);
    if (need <= 0n) return false;
    const internalBal = await tokenBalanceOf(tokenAddress, walletAddress);
    if (internalBal !== null && internalBal >= need) {
      return true;
    }
    const linked = await requireLinkedExternal();
    if (!linked || !adminProvider) return false;
    try {
      await ensureExternalWalletOnAppChain(adminProvider as Eip1193Provider);
    } catch (error) {
      Alert.alert(t('connect'), humanizeTxError(error));
      return false;
    }
    const signer = await getEthersSignerFromProvider(adminProvider as Eip1193Provider);
    if (!signer) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return false;
    }
    if (isDemoAccount()) {
      try {
        await QuatriviumCreditService.mintDemoUsdtTo(tokenAddress, linked, amountWei);
      } catch {
        // Si no hay minteo, se intenta con el saldo de la billetera vinculada.
      }
    }
    const extBal = await tokenBalanceOf(tokenAddress, linked);
    if (extBal !== null && extBal < need) {
      Alert.alert(
        t('amountExceedsBalance'),
        t('poolNeedInternalFunds', { symbol: selectedToken.symbol })
      );
      return false;
    }
    const extEth = await readOnChainEth(linked);
    if (extEth !== null && extEth < MIN_GAS_WEI) {
      showNotice(t('errNeedGasExternal'), t('errNeedGasExternal'));
      return false;
    }
    try {
      await enviarToken(signer, tokenAddress, walletAddress, amountWei, true);
      return true;
    } catch (error) {
      Alert.alert(t('error'), humanizeTxError(error));
      return false;
    }
  };

  const handleRegistrarHumano = async () => {
    if (userInfo.isRegistered || userInfo.referral?.isFundador) return;
    if (!ensureCreditReady()) return;
    if (!walletAddress) {
      showNotice(t('connect'), t('appWalletNotReady'));
      return;
    }

    if (!(await ensureGasForTx())) return;
    let padre: string | undefined;
    try {
      const locked = await lockSponsorOnce(walletAddress, '');
      padre = locked.padre || undefined;
    } catch {
      padre = undefined;
    }
    const result = await registrarHumano(walletAddress, padre);
    if (result.success) {
      await clearPendingInvite();
      refetch();
    }
  };

  const handleSolicitarCredito = async (tier: LoanTier) => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (!loanReadsReady) {
      Alert.alert(t('register'), t('identityChecking'));
      return;
    }
    if (!userInfo.isRegistered) {
      Alert.alert(t('register'), t('activateBeforeLoan'));
      return;
    }
    const phraseOk = await isPhraseBackedUp().catch(() => false);
    if (creditNeedsPhrase(phraseOk)) {
      Alert.alert(t('seedBannerTitle'), t('seedNeedBeforeLoan'));
      return;
    }
    if (creditNeedsAccess(userInfo.donatedUsd || 0, Boolean(userInfo.altaPagada))) {
      Alert.alert(t('creditAccessTitle'), t('creditAccessNeed'));
      return;
    }
    if (userInfo.hasActiveLoan) {
      Alert.alert(t('activeLoan'), t('loanBusy'));
      return;
    }
    if (tier.id > userInfo.userProgress.nivelActual) {
      Alert.alert(t('loanLockedTitle'), t('loanLockedBody'));
      return;
    }
    if (userInfo.isDelinquent) {
      Alert.alert(t('delinquent'), t('moraBlocked'));
      return;
    }
    const wait = esperaParaVolverAPedir(
      userInfo.userProgress.ultimoPrestamoTimestamp,
      userInfo.userProgress.cooldownAncla
    );
    if (wait > 0) {
      Alert.alert(
        t('cooldownTitle'),
        t('cooldownWait', {
          time: formatCooldown(wait, t('available')),
        })
      );
      return;
    }
    if (!userInfo.isTokenSupported && !isOfficialWorldToken(selectedToken.address)) {
      Alert.alert(t('token'), t('tokenNotEnabledAlert'));
      return;
    }
    if (
      !(await confirmFunds(
        'loanRequest',
        await quotedFunds(String(tier.usdAmount), getContractAddress(), {
          to: getContractAddress(),
          abi: CONTRACT_ABI,
          method: 'solicitarPrestamo',
          args: [selectedToken.address, tier.id],
        })
      ))
    )
      return;
    if (!(await ensureGasForTx())) return;
    const result = await solicitarPrestamo(selectedToken.address, tier.id);
    if (!result.success) {
      refetch();
      return;
    }
    if (isDemoAccount()) {
      try {
        const minted = await QuatriviumCreditService.topUpDemoUsdtToDebt(selectedToken.address);
        if (minted) Alert.alert(t('ready'), t('demoUsdtTopUp'));
      } catch (caught) {
        Alert.alert(t('error'), humanizeTxError(caught) || t('demoUsdtTopUpFailed'));
      }
    }
    refetch();
  };

  const handleCobrarBonoHito = async () => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (userInfo.isDelinquent) {
      Alert.alert(t('delinquent'), t('moraBlocked'));
      return;
    }
    if (!userInfo.canClaimHitos) {
      Alert.alert(t('toPoolBonus'), t('bonusLegacyContract'));
      return;
    }
    if (!userInfo.userProgress.bonusPending) {
      Alert.alert(
        t('toPoolBonus'),
        t('milestoneBonusHint', {
          amount: formatUSD(milestoneBonusUsd(userInfo.userProgress.nextMilestone || 100)),
          level: userInfo.userProgress.nextMilestone || 100,
        })
      );
      return;
    }
    if (!(await ensureGasForTx())) return;
    const result = await cobrarBonoHito(selectedToken.address);
    if (result.success) {
      const level = userInfo.userProgress.bonusPending;
      void recordMovement(walletAddress, {
        kind: 'bonus',
        from: selectedToken.address,
        to: walletAddress,
        amountLabel: formatUSD(milestoneBonusUsd(level)),
        tokenSymbol: selectedToken.symbol,
        platform: 'Quatrivium',
        timestamp: Date.now(),
      });
      refetch();
    }
  };

  const handleCanjearFama = async (fama: number) => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (userInfo.isDelinquent) {
      Alert.alert(t('delinquent'), t('moraBlocked'));
      return;
    }
    if (!userInfo.isRegistered) {
      Alert.alert(t('sectionCreditLine'), t('creditAccessNeed'));
      return;
    }
    if (!userInfo.canCanjearFama) {
      Alert.alert(t('hubCanje'), t('canjeLegacy'));
      return;
    }
    if (!Number.isInteger(fama) || fama < FAMA_CANJE_POR_USDT || fama % FAMA_CANJE_POR_USDT !== 0) {
      Alert.alert(t('amount'), t('invalidAmount'));
      return;
    }
    if (fama > userInfo.famaDisponible) {
      Alert.alert(
        t('hubCanje'),
        t('canjeNeed', { points: String(fama - userInfo.famaDisponible) })
      );
      return;
    }
    const canjeLusd = String(fama / 250);
    const famaAddr = await famaContract();
    if (
      !(await confirmFunds(
        'movement',
        await quotedFunds(
          canjeLusd,
          walletAddress,
          famaAddr
            ? { to: famaAddr, abi: FAMA_ABI, method: 'canjearFama', args: [fama] }
            : undefined
        )
      ))
    )
      return;
    if (!(await ensureGasForTx())) return;
    const result = await canjearFama(fama);
    if (result.success) {
      void recordMovement(walletAddress, {
        kind: 'bonus',
        from: '',
        to: walletAddress,
        amountLabel: formatUSD(usdtFromFama(fama)),
        tokenSymbol: selectedToken.symbol,
        platform: 'Quatrivium',
        timestamp: Date.now(),
      });
      refetch();
    }
  };

  const handleCanjearFamaRed = async (fama: number) => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (userInfo.isDelinquent) {
      Alert.alert(t('delinquent'), t('moraBlocked'));
      return;
    }
    if (!userInfo.isRegistered) {
      Alert.alert(t('sectionCreditLine'), t('creditAccessNeed'));
      return;
    }
    if (!userInfo.canCanjearFama) {
      Alert.alert(t('hubCanje'), t('canjeLegacy'));
      return;
    }
    if (!Number.isInteger(fama) || fama < FAMA_CANJE_POR_USDT || fama % FAMA_CANJE_POR_USDT !== 0) {
      Alert.alert(t('amount'), t('invalidAmount'));
      return;
    }
    if (fama > (userInfo.famaRedDisponible || 0)) {
      Alert.alert(
        t('hubCanje'),
        t('canjeNeed', { points: String(fama - (userInfo.famaRedDisponible || 0)) })
      );
      return;
    }
    const famaRed = await famaContract();
    if (
      !(await confirmFunds(
        'movement',
        await quotedFunds(
          String(fama / 250),
          walletAddress,
          famaRed
            ? { to: famaRed, abi: FAMA_ABI, method: 'canjearFamaRed', args: [fama] }
            : undefined
        )
      ))
    )
      return;
    if (!(await ensureGasForTx())) return;
    const result = await canjearFamaRed(fama);
    if (result.success) {
      void recordMovement(walletAddress, {
        kind: 'bonus',
        from: '',
        to: walletAddress,
        amountLabel: formatUSD(usdtFromFama(fama)),
        tokenSymbol: selectedToken.symbol,
        platform: 'Quatrivium',
        timestamp: Date.now(),
      });
      refetch();
    }
  };

  const handleCobrarBonoRacha = async () => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (userInfo.isDelinquent) {
      Alert.alert(t('delinquent'), t('moraBlocked'));
      return;
    }
    if (!userInfo.isRegistered) {
      Alert.alert(t('sectionCreditLine'), t('creditAccessNeed'));
      return;
    }
    if (!userInfo.canRacha) {
      Alert.alert(t('rachaTitle'), t('rachaLegacy'));
      return;
    }
    if (!(userInfo.racha?.bonoPendienteUsd > 0)) {
      Alert.alert(t('rachaTitle'), t('rachaNothing'));
      return;
    }
    const rachaAddr = await famaContract();
    if (
      !(await confirmFunds(
        'movement',
        await quotedFunds(
          String(userInfo.racha.bonoPendienteUsd),
          walletAddress,
          rachaAddr ? { to: rachaAddr, abi: FAMA_ABI, method: 'cobrarBonoRacha' } : undefined
        )
      ))
    )
      return;
    if (!(await ensureGasForTx())) return;
    const result = await cobrarBonoRacha();
    if (result.success) {
      void recordMovement(walletAddress, {
        kind: 'bonus',
        from: '',
        to: walletAddress,
        amountLabel: formatUSD(userInfo.racha.bonoPendienteUsd),
        tokenSymbol: selectedToken.symbol,
        platform: 'Quatrivium',
        timestamp: Date.now(),
      });
      refetch();
    }
  };

  const handlePagar = async (kind: 'installment' | 'all' | number) => {
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;

    if (!userInfo.activeLoan || userInfo.activeLoan.totalDueWei === '0') {
      Alert.alert(t('noDebt'), t('noActiveLoan'));
      return;
    }
    if (
      !(await confirmFunds(
        'loanPay',
        await quotedFunds(
          userInfo.activeLoan.remainingLabel || userInfo.activeLoan.totalDueLabel,
          getContractAddress(),
          {
            to: getContractAddress(),
            abi: CONTRACT_ABI,
            method: 'pagarPrestamo',
            args: [
              userInfo.activeLoan.token,
              userInfo.activeLoan.remainingWei || userInfo.activeLoan.totalDueWei,
            ],
          }
        )
      ))
    )
      return;
    if (!(await ensureGasForTx())) return;

    const loanToken = userInfo.activeLoan.token;
    if (isDemoAccount()) {
      try {
        await QuatriviumCreditService.topUpDemoUsdtToDebt(
          loanToken,
          userInfo.activeLoan.remainingWei || userInfo.activeLoan.totalDueWei
        );
        void refetch();
      } catch (caught) {
        Alert.alert(t('error'), humanizeTxError(caught) || t('demoUsdtTopUpFailed'));
        return;
      }
    }
    const left = Math.max(
      1,
      (userInfo.activeLoan.cuotasTotales || 1) - (userInfo.activeLoan.cuotasPagadas || 0)
    );
    const count = kind === 'all' ? left : kind === 'installment' ? 1 : kind;

    const assertEnoughToPay = async (amountWei: string) => {
      if (isDemoAccount() || !walletAddress) return true;
      const meta = getTokenMeta(loanToken) || selectedToken;
      const raw = await tokenBalanceOf(loanToken, walletAddress);
      let available: bigint | null = raw;
      if (available === null && loanToken.toLowerCase() === selectedToken.address.toLowerCase()) {
        try {
          available = parseUnits(balances.tokenBalance || '0', meta.decimals);
        } catch {
          available = null;
        }
      }
      if (available === null) {
        Alert.alert(t('error'), t('errRpcNoContract'));
        return false;
      }
      const needed = BigInt(amountWei);
      if (needed > available) {
        Alert.alert(t('amount'), t('amountExceedsBalance'));
        return false;
      }
      return true;
    };

    if (count >= left) {
      const amountWei = userInfo.activeLoan.remainingWei || userInfo.activeLoan.totalDueWei;
      if (!(await assertEnoughToPay(amountWei))) return;
      const result = await pagarPrestamo(amountWei, loanToken);
      if (result.success) {
        try {
          await markLoanFullyPaid(walletAddress);
        } catch {
          // El pago ya quedó en la cadena. Si el teléfono no guarda la marca, el reloj usa el pedido.
        }
        refetch();
      }
      return;
    }

    if (count <= 1) {
      const amountWei =
        userInfo.activeLoan.cuotaWei ||
        userInfo.activeLoan.remainingWei ||
        userInfo.activeLoan.totalDueWei;
      if (!(await assertEnoughToPay(amountWei))) return;
      const result = await pagarPrestamo(amountWei, loanToken);
      if (result.success) refetch();
      return;
    }

    let multiWei = userInfo.activeLoan.remainingWei || userInfo.activeLoan.totalDueWei;
    try {
      const cuota = BigInt(userInfo.activeLoan.cuotaWei || '0');
      const remaining = BigInt(
        userInfo.activeLoan.remainingWei || userInfo.activeLoan.totalDueWei || '0'
      );
      const planned = cuota * BigInt(count);
      multiWei = (planned > 0n && planned < remaining ? planned : remaining).toString();
    } catch {
      // se usa remainingWei
    }
    if (!(await assertEnoughToPay(multiWei))) return;
    const result = await pagarCuotas(count, loanToken);
    if (result.success) refetch();
  };

  const handleDepositarPool = async (amountHuman: string) => {
    if (isDemoAccount()) {
      Alert.alert(t('sectionPool'), t('poolRealOnly'));
      return;
    }
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (!userInfo.isTokenSupported && !isOfficialWorldToken(selectedToken.address)) {
      Alert.alert(t('token'), t('tokenNotEnabledAlert'));
      return;
    }
    const parsed = parsePositiveDecimal(amountHuman);
    if (!parsed) {
      Alert.alert(t('amount'), t('amountGreaterZero'));
      return;
    }
    if (
      !(await confirmFunds(
        'movement',
        await quotedFunds(parsed, getContractAddress(), {
          to: getContractAddress(),
          abi: CONTRACT_ABI,
          method: 'depositarLiquidez',
          args: [selectedToken.address, parseUnits(parsed, selectedToken.decimals)],
        })
      ))
    )
      return;
    try {
      const amountWei = parseUnits(parsed, selectedToken.decimals).toString();
      if (!(await fundInternalFromExternal(amountWei, selectedToken.address))) return;
      if (!(await ensureGasForTx())) return;
      const result = await depositarLiquidez(amountWei, selectedToken.address);
      if (result.success) refetch();
    } catch {
      Alert.alert(t('amount'), t('invalidAmount'));
    }
  };

  const handlePagarAcceso = async () => {
    if (isDemoAccount() && !isAltaConfigured()) return;
    if (accesoBusy.current) return;
    accesoBusy.current = true;
    try {
      if (!walletAddress) {
        Alert.alert(t('connect'), t('appWalletNotReady'));
        return;
      }
      if (!userInfo.founderAddress) {
        Alert.alert(t('creditAccessTitle'), t('creditAccessPending'));
        return;
      }
      if (!isAltaConfigured() && !isAccessPaymentEnabled()) {
        Alert.alert(
          t('creditAccessTitle'),
          t(isDemoAccount() ? 'creditAccessPending' : 'liveCreditNotReady')
        );
        return;
      }
      if (!ensureCreditReady()) return;
      if (hasCreditAccess(Number(userInfo.donatedUsd || 0), Boolean(userInfo.altaPagada))) return;
      if (walletAddress) {
        try {
          if (await QuatriviumCreditService.altaPagada(walletAddress)) return;
        } catch {
          // La lectura no llegó. pagarRegistro vuelve a consultar el contrato antes de firmar.
        }
      }
      if (!isAltaConfigured() && !userInfo.canDonate) {
        Alert.alert(
          t('creditAccessTitle'),
          t(isDemoAccount() ? 'creditAccessPending' : 'liveCreditNotReady')
        );
        return;
      }
      if (!userInfo.isTokenSupported && !isOfficialWorldToken(selectedToken.address)) {
        Alert.alert(t('token'), t('tokenNotEnabledAlert'));
        return;
      }
      const amount = String(accessPayUsdt());
      const amountWei = parseUnits(amount, selectedToken.decimals).toString();
      const accessTo = isAltaConfigured() ? getAltaAddress() : getContractAddress();
      if (
        !(await confirmFunds(
          'movement',
          await quotedFunds(amount, accessTo, {
            to: accessTo,
            abi: isAltaConfigured() ? ALTA_ABI : CONTRACT_ABI,
            method: isAltaConfigured() ? 'pagarRegistro' : 'pagarVerificacion',
            args: isAltaConfigured() ? [] : [selectedToken.address, amountWei],
          })
        ))
      )
        return;
      if (!(await fundInternalFromExternal(amountWei, selectedToken.address))) return;
      if (!(await ensureGasForTx())) return;
      try {
        const result = isAltaConfigured()
          ? {
              success: Boolean(
                await QuatriviumCreditService.pagarRegistroAlta(selectedToken.address)
              ),
            }
          : await donarProyecto(amountWei, selectedToken.address);
        if (result.success) {
          void recordMovement(walletAddress, {
            kind: 'access',
            from: walletAddress,
            to: '',
            amountLabel: `${amount} ${selectedToken.symbol}`,
            tokenSymbol: selectedToken.symbol,
            platform: 'Quatrivium',
            timestamp: Date.now(),
          });
          refetch();
          Alert.alert(t('creditAccessTitle'), t('creditAccessDone'));
        }
      } catch {
        Alert.alert(t('amount'), t('invalidAmount'));
      }
    } finally {
      accesoBusy.current = false;
    }
  };

  const handleAportarReserva = async (amountHuman: string) => {
    const parsed = parsePositiveDecimal(amountHuman);
    if (!parsed) {
      Alert.alert(t('amount'), t('amountGreaterZero'));
      return;
    }
    if (
      !(await confirmFunds(
        'movement',
        await quotedFunds(parsed, getReservaAddress(), {
          to: getReservaAddress(),
          abi: RESERVA_ABI,
          method: 'aportarBote',
          args: [parseUnits(parsed, 18)],
        })
      ))
    )
      return;
    try {
      await runAsAdmin(async () => {
        const signer = await getEthersSignerFromProvider(adminProvider as Eip1193Provider);
        if (!signer) throw new Error('admin');
        await aportarReservaBote(signer, parsed);
        showNotice(t('ready'), t('reservaAdminPotOk'));
        refetch();
      });
    } catch (error) {
      Alert.alert(t('error'), t(reservaErrorKey(error)));
    }
  };

  const handleDonar = async (amountHuman: string) => {
    if (!isDonationVisible()) {
      Alert.alert(t('donateTitle'), t('donateRealOnly'));
      return;
    }
    if (!userInfo.founderAddress) {
      Alert.alert(t('donateTitle'), t('donateWalletPending'));
      return;
    }
    if (!isDonationEnabled()) {
      Alert.alert(t('donateTitle'), t('liveCreditNotReady'));
      return;
    }
    if (!walletAddress) {
      Alert.alert(t('connect'), t('appWalletNotReady'));
      return;
    }
    if (!ensureCreditReady()) return;
    if (!userInfo.canDonate) {
      Alert.alert(t('donateTitle'), t('bonusLegacyContract'));
      return;
    }
    if (!userInfo.isTokenSupported && !isOfficialWorldToken(selectedToken.address)) {
      Alert.alert(t('token'), t('tokenNotEnabledAlert'));
      return;
    }
    const parsed = parsePositiveDecimal(amountHuman);
    if (!parsed) {
      Alert.alert(t('amount'), t('amountGreaterZero'));
      return;
    }
    if (
      !(await confirmFunds(
        'movement',
        await quotedFunds(parsed, getRealDonationWallet() || userInfo.founderAddress, {
          to: getContractAddress(),
          abi: CONTRACT_ABI,
          method: 'donar',
          args: [selectedToken.address, parseUnits(parsed, selectedToken.decimals)],
        })
      ))
    )
      return;
    try {
      const amountWei = parseUnits(parsed, selectedToken.decimals).toString();
      if (!(await fundInternalFromExternal(amountWei, selectedToken.address))) return;
      if (!(await ensureGasForTx())) return;
      const result = await donarProyecto(amountWei, selectedToken.address);
      if (result.success) {
        void recordMovement(walletAddress, {
          kind: 'donation',
          from: walletAddress,
          to: '',
          amountLabel: `${parsed} ${selectedToken.symbol}`,
          tokenSymbol: selectedToken.symbol,
          platform: 'Quatrivium',
          timestamp: Date.now(),
        });
        refetch();
      }
    } catch {
      Alert.alert(t('amount'), t('invalidAmount'));
    }
  };

  const handleExecuteProposal = async (id: number) => {
    await runAsAdmin(async () => {
      const result = await executeAdminAction(id);
      if (result.success) refetch();
    });
  };

  const handleConfirmProposal = async (id: number) => {
    await runAsAdmin(async () => {
      const result = await confirmAdminAction(id);
      if (result.success) refetch();
    });
  };

  const handleProposeAddAdmin = async (address: string) => {
    await runAsAdmin(async () => {
      const result = await proposeAddAdmin(address);
      if (result.success) refetch();
    });
  };

  const handleProposeRemoveAdmin = async (address: string) => {
    await runAsAdmin(async () => {
      const result = await proposeRemoveAdmin(address);
      if (result.success) refetch();
    });
  };

  const handleProposeFundador = async (address: string) => {
    await runAsAdmin(async () => {
      const result = await proposeFundador(address);
      if (result.success) refetch();
    });
  };

  const handleCancelProposal = async (id: number) => {
    await runAsAdmin(async () => {
      const result = await cancelAdminAction(id);
      if (result.success) refetch();
    });
  };

  const handleLiquidarDeudor = async (debtorAddress: string, tokenAddr: string) => {
    await runAsAdmin(async () => {
      const result = await liquidarDeudor(debtorAddress, tokenAddr);
      if (result.success) refetch();
    });
  };

  const handleMarcarMorosoSiVencido = async (debtorAddress: string) => {
    await runAsAdmin(async () => {
      const result = await marcarMorosoSiVencido(debtorAddress);
      if (result.success) refetch();
    });
  };

  const track = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...args: never[]) => {
      busyDepth.current += 1;
      setActionBusy(true);
      try {
        return await fn(...args);
      } finally {
        busyDepth.current = Math.max(0, busyDepth.current - 1);
        if (busyDepth.current === 0) setActionBusy(false);
      }
    }) as T;

  return {
    txLoading: txLoading || actionBusy,
    handleRegistrarHumano: track(handleRegistrarHumano),
    handleSolicitarCredito: track(handleSolicitarCredito),
    handleCobrarBonoHito: track(handleCobrarBonoHito),
    handleCanjearFama: track(handleCanjearFama),
    handleCanjearFamaRed: track(handleCanjearFamaRed),
    handleCobrarBonoRacha: track(handleCobrarBonoRacha),
    handlePagar: track(handlePagar),
    handleDepositarPool: track(handleDepositarPool),
    handlePagarAcceso: track(handlePagarAcceso),
    handleDonar: track(handleDonar),
    handleAportarReserva: track(handleAportarReserva),
    handleExecuteProposal,
    handleConfirmProposal,
    handleProposeAddAdmin,
    handleProposeRemoveAdmin,
    handleProposeFundador,
    handleCancelProposal,
    handleLiquidarDeudor,
    handleMarcarMorosoSiVencido,
  };
};
