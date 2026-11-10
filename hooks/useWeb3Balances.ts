import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contract, formatEther, formatUnits, isAddress } from 'ethers';
import { useEffect, useState, useCallback, useRef } from 'react';
import { CONTRACT_ABI, ERC20_ABI, getContractAddress } from '../constants/contractConfig';
import { getRealDonationWallet } from '../constants/deployedAddresses';
import {
  assertTrustedRpc,
  isContractConfigured,
  isDemoAccount,
  NETWORK_CONFIG,
  subscribeRuntimeMode,
} from '../constants/rpcConfig';
import { canHydrateCreditStatus } from '../utils/creditGates';
import { getTokenMeta, isOfficialWorldToken, type Token } from '../constants/tokens';
import {
  LOAN_TIERS,
  MAX_LOAN_LEVEL,
  ONCHAIN_TIER_SCAN,
  overlayOnChainTier,
  requiredCountForLiveLevel,
  visibleLoanTiers,
  type LoanTier,
} from '../constants/loanTiers';
import { describeAdminCalldata, type OpenAdminProposal } from '../utils/adminProposal';
import { asWeiString, QuatriviumCreditService } from '../services/quatriviumCreditService';
import { REFERRAL_BONUS_THRESHOLD, REFERRAL_REPUTATION_POINTS } from '../constants/reputation';
import { esperaParaVolverAPedir } from '../utils/creditCooldown';
import { readLoanFullyPaidAt } from '../utils/loanPaidMark';

const logErr = __DEV__ ? console.log.bind(console) : () => {};
const logWarn = __DEV__ ? console.warn.bind(console) : () => {};

/** El fondo mostrado es la liquidez contable menos préstamos aún abiertos. La deuda ya dada por perdida no está en ninguno de los dos. */
function poolFigures(
  nav: bigint,
  outstanding: bigint | null,
  decimals: number
): { poolBalance: string; poolOutstanding?: string; poolCash?: string } {
  const poolBalance = Number(formatUnits(nav, decimals)).toFixed(2);
  if (outstanding === null) return { poolBalance };
  const cash = nav > outstanding ? nav - outstanding : 0n;
  return {
    poolBalance,
    poolOutstanding: Number(formatUnits(outstanding, decimals)).toFixed(2),
    poolCash: Number(formatUnits(cash, decimals)).toFixed(2),
  };
}

function creditStatusKey(wallet: string): string {
  return `quatrivium.creditStatus.${NETWORK_CONFIG.chainId}.${getContractAddress().toLowerCase()}.${wallet.toLowerCase()}`;
}

function persistCreditStatus(wallet: string, isRegistered: boolean, hasActiveLoan: boolean) {
  AsyncStorage.setItem(
    creditStatusKey(wallet),
    JSON.stringify({
      isRegistered,
      hasActiveLoan,
      contract: getContractAddress().toLowerCase(),
    })
  ).catch(() => {});
}

export type { Token, LoanTier };

export interface UserBalances {
  bnbBalance: string;
  tokenBalance: string;
  poolBalance: string;
  poolOutstanding: string;
  poolCash: string;
  lpBalance: string;
}

export interface ActiveLoan {
  tierId: number;
  principalWei: string;
  totalDueWei: string;
  totalDueLabel: string;
  remainingWei: string;
  cuotaWei: string;
  cuotaLabel: string;
  remainingLabel: string;
  cuotasPagadas: number;
  cuotasTotales: number;
  proximaCuota: number;
  token: string;
  tokenSymbol: string;
  vencimiento: number;
}

export interface UserInfo {
  hasActiveLoan: boolean;
  isRegistered: boolean;
  isTokenSupported: boolean;
  reputation: number;
  networkPoints: number;
  networkBonusesPaid: number;
  networkBonusThreshold: number;
  referralPoints: number;
  isDelinquent: boolean;
  creditHistory: {
    paidOnTime: number;
    missedLoans: number;
    penalties: number;
  };
  userProgress: {
    nivelActual: number;
    solicitudesCompletadas: number;
    ultimoPrestamoTimestamp: number;
    /** Segundos del pedido o del pago que cerró el crédito, el que sea más reciente. */
    cooldownAncla: number;
    cooldownRestante: number;
    bonusPending: number;
    nextMilestone: number;
    lastHito: number;
  };
  donatedUsd: number;
  altaPagada: boolean;
  famaCaja: number;
  famaRed: number;
  famaRacha: number;
  famaCanjeada: number;
  famaRedCanjeada: number;
  famaDisponible: number;
  famaRedDisponible: number;
  racha: {
    dias: number;
    diasMax: number;
    famaDias: number;
    hitoCobrado: number;
    siguienteHito: number;
    bonoPendienteUsd: number;
    graciaVigente: boolean;
  };
  maxLoanLevel: number;
  canClaimHitos: boolean;
  canDonate: boolean;
  canCanjearFama: boolean;
  canRacha: boolean;
  canPagarVerificacion: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  paused: boolean;
  curveRateBps: number;
  kycDeclarado: boolean;
  kycExigido: boolean;
  identityBound: boolean;
  deviceHash: string;
  deviceMatches: boolean;
  identidadExigida: boolean;
  adminRoster: string[];
  requiredConfirmations: number;
  proposalCount: number;
  openProposal: OpenAdminProposal | null;
  founderAddress: string;
  ownerAddress: string;
  attesterAddress: string;
  activeLoan: ActiveLoan | null;
  referral: {
    padre: string;
    fundador: string;
    isFundador: boolean;
    bonoActivacionCobrado: boolean;
    royaltiesCongeladas: boolean;
  };
}

const kycDeclaredListeners = new Set<() => void>();

export function publishKycDeclared() {
  kycDeclaredListeners.forEach((fn) => fn());
}

function subscribeKycDeclared(listener: () => void) {
  kycDeclaredListeners.add(listener);
  return () => {
    kycDeclaredListeners.delete(listener);
  };
}

const EMPTY_BALANCES: UserBalances = {
  bnbBalance: '0.00',
  tokenBalance: '0.00',
  poolBalance: '0.00',
  poolOutstanding: '0.00',
  poolCash: '0.00',
  lpBalance: '0.00',
};

const EMPTY_USER_INFO: UserInfo = {
  hasActiveLoan: false,
  isRegistered: false,
  isTokenSupported: false,
  reputation: 0,
  networkPoints: 0,
  networkBonusesPaid: 0,
  networkBonusThreshold: REFERRAL_BONUS_THRESHOLD,
  referralPoints: REFERRAL_REPUTATION_POINTS,
  isDelinquent: false,
  creditHistory: { paidOnTime: 0, missedLoans: 0, penalties: 0 },
  userProgress: {
    nivelActual: 1,
    solicitudesCompletadas: 0,
    ultimoPrestamoTimestamp: 0,
    cooldownAncla: 0,
    cooldownRestante: 0,
    bonusPending: 0,
    nextMilestone: 100,
    lastHito: 0,
  },
  donatedUsd: 0,
  altaPagada: false,
  famaCaja: 0,
  famaRed: 0,
  famaRacha: 0,
  famaCanjeada: 0,
  famaRedCanjeada: 0,
  famaDisponible: 0,
  famaRedDisponible: 0,
  racha: {
    dias: 0,
    diasMax: 0,
    famaDias: 0,
    hitoCobrado: 0,
    siguienteHito: 0,
    bonoPendienteUsd: 0,
    graciaVigente: false,
  },
  maxLoanLevel: MAX_LOAN_LEVEL,
  canClaimHitos: false,
  canDonate: false,
  canCanjearFama: false,
  canRacha: false,
  canPagarVerificacion: false,
  isOwner: false,
  isAdmin: false,
  paused: false,
  curveRateBps: 0,
  kycDeclarado: false,
  kycExigido: false,
  identityBound: false,
  deviceHash: '',
  deviceMatches: true,
  identidadExigida: false,
  adminRoster: [],
  requiredConfirmations: 1,
  proposalCount: 0,
  openProposal: null,
  founderAddress: '',
  ownerAddress: '',
  attesterAddress: '',
  activeLoan: null,
  referral: {
    padre: '',
    fundador: '',
    isFundador: false,
    bonoActivacionCobrado: false,
    royaltiesCongeladas: false,
  },
};

function formatDue(amountWei: bigint, decimals: number, symbol: string): string {
  const formatted = Number(formatUnits(amountWei, decimals)).toFixed(4);
  return `${formatted} ${symbol}`;
}

export const useWeb3Balances = (walletAddress: string, selectedToken: Token) => {
  const [balances, setBalances] = useState<UserBalances>(EMPTY_BALANCES);
  const [userInfo, setUserInfo] = useState<UserInfo>(EMPTY_USER_INFO);
  const [loanTiers, setLoanTiers] = useState<LoanTier[]>(() => visibleLoanTiers(MAX_LOAN_LEVEL));
  const [isLoading, setIsLoading] = useState(true);
  const [gatesReady, setGatesReady] = useState(false);
  const [registrationKnown, setRegistrationKnown] = useState(false);
  const [loanReadsReady, setLoanReadsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);
  const chainStatusReadyRef = useRef(false);
  const onChainTiersReadyRef = useRef(false);
  const tokenAddress = selectedToken.address;
  const tokenDecimals = selectedToken.decimals;

  const fetchBalances = useCallback(
    async (opts?: { silent?: boolean }) => {
      const gen = ++fetchGen.current;
      const live = () => gen === fetchGen.current;

      if (!opts?.silent) {
        setIsLoading(true);
        setLoanReadsReady(false);
      }
      setError(null);
      let accountKnown = !walletAddress || !isAddress(walletAddress);
      let loanReadsSettled = false;

      try {
        const provider = await assertTrustedRpc();
        if (!live()) return;
        let decimals = tokenDecimals;
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
        try {
          decimals = Number(await tokenContract.decimals());
        } catch {
          // usar decimales configurados
        }

        let poolRead: { poolBalance: string; poolOutstanding?: string; poolCash?: string } | null =
          null;
        let isTokenSupported = false;
        let curveRateRead: number | null = null;
        const kycExigido = false;
        if (isContractConfigured()) {
          try {
            const creditContract = new Contract(getContractAddress(), CONTRACT_ABI, provider);
            try {
              isTokenSupported = Boolean(await creditContract.supportedToken(tokenAddress));
            } catch {
              isTokenSupported = isOfficialWorldToken(tokenAddress);
            }
            try {
              curveRateRead = Number(await creditContract.obtenerTasaInteresActual(tokenAddress));
            } catch {
              curveRateRead = null;
            }
            try {
              const nav = (await creditContract.totalLiquidity(tokenAddress)) as bigint;
              let outstanding: bigint | null = null;
              try {
                outstanding = (await creditContract.outstandingLoans(tokenAddress)) as bigint;
              } catch {
                outstanding = null;
              }
              poolRead = poolFigures(nav, outstanding, decimals);
            } catch {
              poolRead = null;
            }
          } catch {
            // contrato no disponible
          }
        }

        if (!walletAddress || !isAddress(walletAddress)) {
          if (!live()) return;
          setUserInfo({
            ...EMPTY_USER_INFO,
            isTokenSupported,
            curveRateBps: curveRateRead ?? 0,
            kycExigido,
            identidadExigida: !isDemoAccount(),
            canDonate: false,
            canCanjearFama: false,
            canRacha: false,
            canPagarVerificacion: false,
            founderAddress: getRealDonationWallet(),
          });
          setBalances({ ...EMPTY_BALANCES, ...(poolRead ?? {}) });
          return;
        }

        try {
          const bnb = await provider.getBalance(walletAddress);
          if (!live()) return;
          setBalances((prev) => ({
            ...prev,
            bnbBalance: Number(formatEther(bnb)).toFixed(4),
            ...(poolRead ?? {}),
          }));
        } catch (e) {
          logErr('Error fetching BNB balance:', e);
          if (poolRead) setBalances((prev) => ({ ...prev, ...poolRead }));
        }

        try {
          const bal = (await tokenContract.balanceOf(walletAddress)) as bigint;
          setBalances((prev) => ({
            ...prev,
            tokenBalance: Number(formatUnits(bal, decimals)).toFixed(4),
            ...(poolRead ?? {}),
          }));
        } catch (e) {
          logErr('Error fetching token balances:', e);
          if (poolRead) setBalances((prev) => ({ ...prev, ...poolRead }));
        }

        if (!live()) return;

        if (!isContractConfigured()) {
          accountKnown = true;
          setUserInfo((prev) => {
            const keep =
              !prev.isRegistered &&
              !prev.hasActiveLoan &&
              !prev.kycDeclarado &&
              !prev.identityBound &&
              prev.userProgress.solicitudesCompletadas === 0;
            const base = keep ? prev : { ...EMPTY_USER_INFO };
            return {
              ...base,
              curveRateBps: curveRateRead ?? 0,
              canDonate: false,
              canCanjearFama: false,
              canRacha: false,
              canPagarVerificacion: false,
              founderAddress: prev.founderAddress || getRealDonationWallet(),
              ownerAddress: prev.ownerAddress,
              attesterAddress: prev.attesterAddress,
              adminRoster: prev.adminRoster,
              requiredConfirmations: prev.requiredConfirmations,
              proposalCount: prev.proposalCount,
              openProposal: prev.openProposal,
              isAdmin: prev.isAdmin,
              isOwner: prev.isOwner,
              maxLoanLevel: MAX_LOAN_LEVEL,
              canClaimHitos: false,
              isTokenSupported: isOfficialWorldToken(tokenAddress) || isTokenSupported,
              kycExigido,
              identidadExigida: !isDemoAccount(),
            };
          });
          setLoanTiers(visibleLoanTiers(MAX_LOAN_LEVEL));
          setBalances((prev) => {
            if (
              prev.poolBalance === EMPTY_BALANCES.poolBalance &&
              prev.poolOutstanding === EMPTY_BALANCES.poolOutstanding &&
              prev.poolCash === EMPTY_BALANCES.poolCash &&
              prev.lpBalance === EMPTY_BALANCES.lpBalance
            ) {
              return prev;
            }
            return {
              ...prev,
              poolBalance: EMPTY_BALANCES.poolBalance,
              poolOutstanding: EMPTY_BALANCES.poolOutstanding,
              poolCash: EMPTY_BALANCES.poolCash,
              lpBalance: EMPTY_BALANCES.lpBalance,
            };
          });
          return;
        }

        setUserInfo((prev) => ({
          ...prev,
          isTokenSupported,
          curveRateBps: curveRateRead ?? prev.curveRateBps,
          kycExigido,
        }));

        try {
          const creditContract = new Contract(getContractAddress(), CONTRACT_ABI, provider);
          if (!live()) return;
          let caps = {
            maxLevel: MAX_LOAN_LEVEL,
            canClaimHitos: false,
            canDonate: false,
            canCanjearFama: false,
            canRacha: false,
            canPagarVerificacion: false,
          };
          let capsRead = false;
          try {
            caps = await QuatriviumCreditService.detectarCapacidadProtocolo();
            capsRead = true;
          } catch (error) {
            logWarn('protocol caps unread:', error);
          }
          if (live() && capsRead) {
            setUserInfo((prev) => ({
              ...prev,
              maxLoanLevel: caps.maxLevel,
              canClaimHitos: caps.canClaimHitos,
              canDonate: caps.canDonate,
              canCanjearFama: caps.canCanjearFama,
              canRacha: caps.canRacha,
              canPagarVerificacion: caps.canPagarVerificacion,
            }));
          }

          try {
            const [loan, registeredFlag] = await Promise.all([
              creditContract.usuarios(walletAddress).catch(() => null),
              creditContract.humanosVerificados(walletAddress).catch(() => null),
            ]);
            if (!live()) return;

            const principal = loan ? BigInt(loan.montoActivo) : 0n;
            const hasLoan = principal > 0n;
            let activeLoan: ActiveLoan | null = null;

            if (loan && principal > 0n) {
              let totalDue = principal;
              try {
                const debt = await creditContract.obtenerDeuda(walletAddress);
                totalDue = BigInt(debt.total);
              } catch {
                const tasa = BigInt(loan.tasaAplicadaBP);
                totalDue = principal + (principal * tasa) / 10000n;
              }

              const loanToken = String(loan.monedaActivo || tokenAddress).toLowerCase();
              const meta = getTokenMeta(loanToken);
              const loanDecimals = meta?.decimals ?? decimals;
              const loanSymbol = meta?.symbol ?? 'TOKEN';

              let remainingWei = totalDue.toString();
              let cuotaWei = totalDue.toString();
              let cuotasPagadas = 0;
              let cuotasTotales = 1;
              let proximaCuota = Number(loan.vencimiento);
              try {
                const plan = await creditContract.planPago(walletAddress);
                const pagado = BigInt(plan.pagado);
                const restantes = totalDue > pagado ? totalDue - pagado : 0n;
                const totales = Math.max(1, Number(plan.totales) || 1);
                const pagadas = Number(plan.pagadas);
                const left = Math.max(1, totales - pagadas);
                remainingWei = restantes.toString();
                cuotaWei = (left <= 1 ? restantes : restantes / BigInt(left)).toString();
                cuotasPagadas = pagadas;
                cuotasTotales = totales;
                proximaCuota = Number(plan.venceCuota) || Number(loan.vencimiento);
              } catch {
                // contrato anterior sin plan de cuotas
              }

              activeLoan = {
                tierId: Number(loan.nivelActual || 0),
                principalWei: principal.toString(),
                totalDueWei: totalDue.toString(),
                totalDueLabel: formatDue(totalDue, loanDecimals, loanSymbol),
                remainingWei,
                cuotaWei,
                cuotaLabel: formatDue(BigInt(cuotaWei), loanDecimals, loanSymbol),
                remainingLabel: formatDue(BigInt(remainingWei), loanDecimals, loanSymbol),
                cuotasPagadas,
                cuotasTotales,
                proximaCuota,
                token: loanToken,
                tokenSymbol: loanSymbol,
                vencimiento: Number(loan.vencimiento),
              };
            }

            const nowSec = Math.floor(Date.now() / 1000);
            const overdue = Boolean(
              activeLoan &&
                ((activeLoan.vencimiento > 0 && nowSec > activeLoan.vencimiento) ||
                  (activeLoan.proximaCuota > 0 && nowSec > activeLoan.proximaCuota))
            );
            const loanReadOk = loan !== null;
            const registeredReadOk = registeredFlag !== null;
            if (!loanReadOk && !registeredReadOk) {
              logWarn('Loan/registration RPC failed; keeping last known status');
            } else {
              const registered = registeredReadOk ? Boolean(registeredFlag) || hasLoan : hasLoan;
              setUserInfo((prev) => ({
                ...prev,
                hasActiveLoan: loanReadOk ? hasLoan : prev.hasActiveLoan,
                activeLoan: loanReadOk ? activeLoan : prev.activeLoan,
                isDelinquent: loanReadOk ? overdue : prev.isDelinquent,
                isRegistered: registeredReadOk ? registered : hasLoan || prev.isRegistered,
              }));
              if (registeredReadOk) setRegistrationKnown(true);
              if (loanReadOk && registeredReadOk) {
                chainStatusReadyRef.current = true;
                persistCreditStatus(walletAddress, registered, hasLoan);
              }
            }
          } catch (e) {
            logErr('Error fetching user loan status:', e);
          }

          try {
            const altaHecha = Boolean(await QuatriviumCreditService.altaPagada(walletAddress));
            accountKnown = true;
            if (live()) {
              setUserInfo((prev) => ({ ...prev, altaPagada: altaHecha }));
            }
          } catch (e) {
            logErr('Error fetching alta status:', e);
          }

          loanReadsSettled = true;
          accountKnown = true;
          if (live()) setGatesReady(true);

          try {
            const progress = await QuatriviumCreditService.obtenerProgresoUsuario(walletAddress);
            const lastTs = Number(progress.ultimoPrestamoTimestamp);
            const paidAt = await readLoanFullyPaidAt(walletAddress);
            const currentLevel =
              Number(progress.nivelActual) > 0 ? Number(progress.nivelActual) : 1;
            if (live()) {
              setUserInfo((prev) => {
                const chainTs =
                  Number.isFinite(lastTs) && lastTs > 0
                    ? Math.max(Math.floor(lastTs), prev.userProgress.ultimoPrestamoTimestamp || 0)
                    : prev.userProgress.ultimoPrestamoTimestamp || 0;
                const ancla = Math.max(chainTs, paidAt);
                return {
                  ...prev,
                  userProgress: {
                    nivelActual: currentLevel,
                    solicitudesCompletadas: Number(progress.solicitudesCompletadas),
                    ultimoPrestamoTimestamp: chainTs,
                    cooldownAncla: ancla,
                    cooldownRestante: esperaParaVolverAPedir(chainTs, paidAt),
                    bonusPending: Number(progress.bonusPending || 0),
                    nextMilestone: Number(progress.nextMilestone || 0),
                    lastHito: Number(progress.lastHito || 0),
                  },
                  ...(progress.donatedWei == null
                    ? {}
                    : {
                        donatedUsd: Number(
                          formatUnits(BigInt(asWeiString(progress.donatedWei)), 18)
                        ),
                      }),
                };
              });
            }
          } catch (e) {
            logErr('Error fetching user progress:', e);
          }

          try {
            const fama = await QuatriviumCreditService.obtenerFama(walletAddress);
            const racha = await QuatriviumCreditService.obtenerRacha(walletAddress);
            if (live() && (fama || racha)) {
              setUserInfo((prev) => ({
                ...prev,
                ...(fama
                  ? {
                      famaCaja: fama.caja,
                      famaRed: fama.red,
                      famaRacha: fama.racha,
                      famaCanjeada: fama.canjeada,
                      famaRedCanjeada: fama.redCanjeada,
                      famaDisponible: fama.disponible,
                      famaRedDisponible: fama.redDisponible,
                    }
                  : {}),
                ...(racha ? { racha } : {}),
              }));
            }
          } catch (e) {
            logErr('Error fetching fame:', e);
          }

          try {
            if (opts?.silent && onChainTiersReadyRef.current) {
              // Solo se contrastan los 100 niveles semilla. 101–1000 son fórmula local.
            } else {
              const overlay = new Map<number, LoanTier>();
              const scan = LOAN_TIERS.filter((tier) => tier.id <= ONCHAIN_TIER_SCAN);
              for (let start = 0; start < scan.length && live(); start += 20) {
                const batch = scan.slice(start, start + 20);
                const rows = await Promise.all(
                  batch.map(async (base) => {
                    try {
                      const row = await creditContract.niveles(base.id);
                      const monto = BigInt(row[0] ?? 0);
                      if (monto === 0n) return base;
                      return overlayOnChainTier(base, monto, BigInt(row[1]), BigInt(row[2]));
                    } catch {
                      return base;
                    }
                  })
                );
                rows.forEach((tier) => overlay.set(tier.id, tier));
              }
              if (live()) {
                onChainTiersReadyRef.current = true;
                setLoanTiers(
                  visibleLoanTiers(caps.maxLevel).map((tier) => {
                    const next = overlay.get(tier.id) || tier;
                    return {
                      ...next,
                      requiredCount: requiredCountForLiveLevel(next.id, caps.maxLevel),
                    };
                  })
                );
              }
            }
          } catch {
            if (live()) setLoanTiers(visibleLoanTiers(caps.maxLevel));
          }

          try {
            const supported = Boolean(await creditContract.supportedToken(tokenAddress));
            let nextCurve = 0;
            let curveRead = false;
            try {
              nextCurve = Number(await creditContract.obtenerTasaInteresActual(tokenAddress));
              curveRead = true;
            } catch {
              curveRead = false;
            }
            setUserInfo((prev) => ({
              ...prev,
              isTokenSupported: supported,
              curveRateBps: curveRead ? nextCurve : prev.curveRateBps,
            }));
          } catch (e) {
            logWarn('supportedToken failed:', e);
            setUserInfo((prev) => ({
              ...prev,
              isTokenSupported: prev.isTokenSupported || isOfficialWorldToken(tokenAddress),
            }));
          }

          try {
            const lpValue = (await creditContract.valorLp(walletAddress, tokenAddress)) as bigint;
            setBalances((prev) => ({
              ...prev,
              lpBalance: Number(formatUnits(lpValue, decimals)).toFixed(4),
            }));
          } catch (e) {
            logWarn('valorLp failed:', e);
          }

          try {
            const nav = (await creditContract.totalLiquidity(tokenAddress)) as bigint;
            let outstanding: bigint | null = null;
            try {
              outstanding = (await creditContract.outstandingLoans(tokenAddress)) as bigint;
            } catch {
              outstanding = null;
            }
            const figures = poolFigures(nav, outstanding, decimals);
            setBalances((prev) => ({ ...prev, ...figures }));
          } catch {
            // La lectura no llegó: se conserva la cifra anterior, no se pinta 0.
          }

          try {
            const history = await creditContract.obtenerHistorialUsuario(walletAddress);
            setUserInfo((prev) => {
              const loan = prev.activeLoan;
              const nowSec = Math.floor(Date.now() / 1000);
              const overdue = Boolean(
                loan &&
                  ((loan.vencimiento > 0 && nowSec > loan.vencimiento) ||
                    (loan.proximaCuota > 0 && nowSec > loan.proximaCuota))
              );
              return {
                ...prev,
                reputation: Number(history.puntosReputacion ?? history[0]),
                isDelinquent: Boolean(history.moroso ?? history[1]) || overdue,
                creditHistory: {
                  paidOnTime: Number(history.pagadosATiempo ?? history[2]),
                  missedLoans: Number(history.morosos ?? history[3]),
                  penalties: Number(history.totalPenalizaciones ?? history[4]),
                },
              };
            });
          } catch (e) {
            logErr('Error fetching credit history:', e);
          }

          try {
            const red = await creditContract.obtenerRedReputacion(walletAddress);
            setUserInfo((prev) => ({
              ...prev,
              networkPoints: Number(red.puntos ?? red[0] ?? 0),
              networkBonusesPaid: Number(red.bonosCobrados ?? red[1] ?? 0),
              networkBonusThreshold:
                Number(red.umbral ?? red[2] ?? REFERRAL_BONUS_THRESHOLD) ||
                REFERRAL_BONUS_THRESHOLD,
              referralPoints:
                Number(red.puntosPorReferido ?? red[4] ?? REFERRAL_REPUTATION_POINTS) ||
                REFERRAL_REPUTATION_POINTS,
            }));
          } catch {
            // Contrato desplegado antes de los bonos de red.
          }

          try {
            const ownerAddress = await QuatriviumCreditService.obtenerOwner();
            let isAdmin = false;
            try {
              isAdmin = Boolean(await creditContract.admins(walletAddress));
            } catch {
              isAdmin = walletAddress.toLowerCase() === String(ownerAddress).toLowerCase();
            }
            setUserInfo((prev) => ({
              ...prev,
              isOwner: walletAddress.toLowerCase() === String(ownerAddress).toLowerCase(),
              isAdmin:
                isAdmin || walletAddress.toLowerCase() === String(ownerAddress).toLowerCase(),
              paused: false,
              ownerAddress: String(ownerAddress || ''),
            }));
            const roster: string[] = [];
            for (let i = 0; i < 3; i += 1) {
              try {
                const item = String(await creditContract.ownerList(i));
                if (item && !/^0x0+$/i.test(item)) roster.push(item);
              } catch {
                break;
              }
            }
            let confirms = 1;
            let proposals = 0;
            try {
              confirms = Number(await creditContract.requiredConfirmations()) || 1;
            } catch {
              confirms = 1;
            }
            try {
              proposals = Number(await creditContract.proposalCount()) || 0;
            } catch {
              proposals = 0;
            }
            let openProposal: OpenAdminProposal | null = null;
            for (let id = proposals; id >= 1 && id >= proposals - 12; id -= 1) {
              try {
                const row = await creditContract.proposals(id);
                const executed = Boolean(row.executed ?? row[4]);
                const cancelled = Boolean(row.cancelled ?? row[5]);
                const eta = Number(row.eta ?? row[1]);
                if (executed || cancelled || eta <= 0) continue;
                openProposal = {
                  id,
                  selector: describeAdminCalldata(String(row.data ?? row[2] ?? '0x')),
                  eta,
                  confirms: Number((row.confirms ?? row[3]) || 0),
                  executed,
                  cancelled,
                  proposer: String(row.proposer ?? row[0] ?? ''),
                };
                break;
              } catch {
                continue;
              }
            }
            setUserInfo((prev) => ({
              ...prev,
              adminRoster: roster,
              requiredConfirmations: confirms,
              proposalCount: proposals,
              openProposal,
            }));
          } catch (e) {
            logErr('Error fetching owner status:', e);
          }

          try {
            let fundador: string | null = null;
            try {
              fundador = String(await creditContract.fundador());
            } catch {
              fundador = null;
            }
            const attester: string | null = null;
            let padre: string | null = null;
            let bonoActivacionCobrado: boolean | null = null;
            try {
              const nodo = await creditContract.redGenealogica(walletAddress);
              padre = String(nodo.padre ?? nodo[0] ?? '');
              bonoActivacionCobrado = Boolean(nodo.bonoActivacionCobrado ?? nodo[1]);
            } catch {
              padre = null;
              bonoActivacionCobrado = null;
            }
            let royaltiesCongeladas: boolean | null = null;
            try {
              royaltiesCongeladas = Boolean(
                await creditContract.dispersionCongelada(walletAddress)
              );
            } catch {
              royaltiesCongeladas = null;
            }
            setUserInfo((prev) => {
              const founderNow = fundador === null ? prev.referral.fundador : fundador;
              return {
                ...prev,
                founderAddress:
                  fundador === null
                    ? prev.founderAddress || getRealDonationWallet()
                    : fundador || getRealDonationWallet(),
                attesterAddress: attester === null ? prev.attesterAddress : attester,
                isRegistered:
                  prev.isRegistered ||
                  (Boolean(founderNow) && walletAddress.toLowerCase() === founderNow.toLowerCase()),
                referral: {
                  padre: padre === null ? prev.referral.padre : padre,
                  fundador: founderNow,
                  isFundador:
                    Boolean(founderNow) && walletAddress.toLowerCase() === founderNow.toLowerCase(),
                  bonoActivacionCobrado:
                    bonoActivacionCobrado === null
                      ? prev.referral.bonoActivacionCobrado
                      : bonoActivacionCobrado,
                  royaltiesCongeladas:
                    royaltiesCongeladas === null
                      ? prev.referral.royaltiesCongeladas
                      : royaltiesCongeladas,
                },
              };
            });
          } catch (e) {
            logErr('Error fetching referral network:', e);
          }
        } catch (e) {
          logErr('Error fetching protocol info:', e);
        }
      } catch (fetchError) {
        accountKnown = true;
        if (!live()) return;
        const errorMessage =
          fetchError instanceof Error ? fetchError.message : 'Failed to fetch balances';
        setError(errorMessage);
        if (!isContractConfigured()) {
          setUserInfo((prev) => {
            if (
              !prev.isRegistered &&
              !prev.hasActiveLoan &&
              !prev.kycDeclarado &&
              !prev.identityBound &&
              prev.userProgress.solicitudesCompletadas === 0
            ) {
              return prev;
            }
            return { ...EMPTY_USER_INFO };
          });
          setLoanTiers(visibleLoanTiers(MAX_LOAN_LEVEL));
        }
      } finally {
        if (live()) {
          setIsLoading(false);
          if (accountKnown) setGatesReady(true);
          if (loanReadsSettled) setLoanReadsReady(true);
        }
      }
    },
    [walletAddress, tokenAddress, tokenDecimals]
  );

  const markKycDeclared = useCallback(() => {
    publishKycDeclared();
  }, []);

  useEffect(
    () =>
      subscribeKycDeclared(() => {
        setUserInfo((prev) => ({ ...prev, kycDeclarado: true }));
      }),
    []
  );

  useEffect(() => {
    setGatesReady(false);
    setRegistrationKnown(false);
    chainStatusReadyRef.current = false;
    onChainTiersReadyRef.current = false;
    if (!walletAddress || !isAddress(walletAddress)) return;
    const wallet = walletAddress.toLowerCase();
    const hydrate = () => {
      if (!isContractConfigured()) return;
      AsyncStorage.getItem(creditStatusKey(walletAddress))
        .then((raw) => {
          if (!raw) return;
          const saved = JSON.parse(raw) as {
            isRegistered?: boolean;
            hasActiveLoan?: boolean;
            contract?: string;
          };
          if (walletAddress.toLowerCase() !== wallet) return;
          if (
            !canHydrateCreditStatus({
              configured: isContractConfigured(),
              chainReady: chainStatusReadyRef.current,
              savedContract: saved.contract,
              currentContract: getContractAddress(),
            })
          ) {
            return;
          }
          setUserInfo((prev) => ({
            ...prev,
            isRegistered: Boolean(saved.isRegistered),
            hasActiveLoan: Boolean(saved.hasActiveLoan),
          }));
        })
        .catch(() => {});
    };
    hydrate();
    return subscribeRuntimeMode(() => {
      chainStatusReadyRef.current = false;
      onChainTiersReadyRef.current = false;
      hydrate();
    });
  }, [walletAddress]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(
    () =>
      subscribeRuntimeMode(() => {
        chainStatusReadyRef.current = false;
        onChainTiersReadyRef.current = false;
        setGatesReady(false);
        setRegistrationKnown(false);
        setLoanReadsReady(false);
        void fetchBalances();
      }),
    [fetchBalances]
  );

  // Auto-refresh cada 30 s cuando hay wallet conectada para mantener el saldo al día
  useEffect(() => {
    if (!walletAddress) return;
    const id = setInterval(() => {
      void fetchBalances({ silent: true });
    }, 30_000);
    return () => clearInterval(id);
  }, [walletAddress, fetchBalances]);

  return {
    balances,
    userInfo,
    loanTiers,
    isLoading,
    gatesReady,
    registrationKnown,
    loanReadsReady,
    markKycDeclared,
    error,
    refetch: fetchBalances,
  };
};
