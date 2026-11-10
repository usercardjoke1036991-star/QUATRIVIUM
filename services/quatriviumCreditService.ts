/**
 * QuatriviumCredit Service — operaciones on-chain con ethers v6.
 */

import {
  Contract,
  Interface,
  ZeroAddress,
  formatUnits,
  id,
  isAddress,
  type AbstractProvider,
  type Signer,
} from 'ethers';
import { ALTA_ABI, getAltaAddress, isAltaConfigured } from '../constants/altaConfig';
import { CONTRACT_ABI, ERC20_ABI, getContractAddress } from '../constants/contractConfig';
import { FAMA_ABI, isFamaAddress } from '../constants/famaConfig';
import { FAMA_CANJE_POR_USDT } from '../constants/fama';
import { isTestnetOnlyToken } from '../constants/bsc';
import {
  assertTrustedRpc,
  getProviderWithFallback,
  isAccessPaymentEnabled,
  isContractConfigured,
  isDemoAccount,
  isDemoMode,
  publicRpcList,
} from '../constants/rpcConfig';
import { getTokenMeta } from '../constants/tokens';
import { isAllowedWei } from '../utils/sanitize';
import { agreedCallData } from '../utils/broadcastRpc';
import {
  CORE_LOAN_LEVEL,
  MAX_LOAN_LEVEL,
  nextClaimableMilestone,
  nextUpcomingMilestone,
} from '../constants/loanTiers';
import { cooldownRestanteDesdeTimestamp } from '../utils/creditCooldown';
import { cobrarComisionIntermediario, isPhraseBackedUp, loadAppWallet } from './appWallet';
import { waitMined } from '../utils/waitMined';

const logWarn = __DEV__ ? console.warn : () => {};
const logInfo = __DEV__ ? console.log : () => {};

let walletSigner: Signer | null = null;

export const setWalletSigner = (signer: Signer) => {
  if (walletSigner === signer) return;
  walletSigner = signer;
};

export const clearWalletSigner = () => {
  walletSigner = null;
};

export const getWalletSigner = () => walletSigner;

const assertContractConfigured = () => {
  if (!isContractConfigured() || !isAddress(getContractAddress())) {
    throw new Error(
      'Contrato no configurado. Define EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET (development) o EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET (production).'
    );
  }
};

const recoverAppSigner = async (): Promise<Signer | null> => {
  const app = await loadAppWallet();
  if (!app) return null;
  setWalletSigner(app);
  return app;
};

const getProviderAndSigner = async () => {
  const provider = await assertTrustedRpc(getProviderWithFallback());
  let signer = walletSigner;
  if (!signer || !signer.provider) {
    signer = await recoverAppSigner();
    return { provider, signer };
  }
  const connected = await signer.provider.getNetwork().catch(() => null);
  const expected = Number((await provider.getNetwork()).chainId);
  if (connected && Number(connected.chainId) !== expected) {
    signer = await recoverAppSigner();
  }
  return { provider, signer };
};

const requireSigner = async () => {
  const { signer, provider } = await getProviderAndSigner();
  if (!signer) {
    throw new Error('no-wallet');
  }
  return { signer, provider };
};

const requireInternalSigner = async () => {
  const pair = await requireSigner();
  const app = await loadAppWallet();
  const current = (await pair.signer.getAddress()).toLowerCase();
  if (!app || app.address.toLowerCase() !== current) {
    throw new Error('internal-wallet-only');
  }
  return pair;
};

const assertToken = (tokenAddress: string) => {
  if (!getTokenMeta(tokenAddress)) {
    throw new Error('token-not-in-app');
  }
};

const assertAmount = (amountWei: string) => {
  if (!isAllowedWei(amountWei)) {
    throw new Error('invalid-amount');
  }
};

const contractWith = (runner: Signer | AbstractProvider) => {
  assertContractConfigured();
  return new Contract(getContractAddress(), CONTRACT_ABI, runner);
};

export type ProtocolCaps = {
  maxLevel: number;
  canClaimHitos: boolean;
  canDonate: boolean;
  canCanjearFama: boolean;
  canRacha: boolean;
  canPagarVerificacion: boolean;
};

const DEFAULT_CAPS: ProtocolCaps = {
  maxLevel: CORE_LOAN_LEVEL,
  canClaimHitos: false,
  canDonate: false,
  canCanjearFama: false,
  canRacha: false,
  canPagarVerificacion: false,
};

export function cachedProtocolCaps(): ProtocolCaps {
  return capsCache?.caps || DEFAULT_CAPS;
}

/** Un revert del contrato es “eso no está”. Timeout o red caída no lo son. */
export function isUnreadRpc(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code || '');
  return code !== 'CALL_EXCEPTION';
}

let capsCache: { addr: string; caps: ProtocolCaps } | null = null;

export function asWeiString(value: unknown): string {
  try {
    if (typeof value === 'bigint') return value.toString();
    const text = String(value ?? '0').trim();
    return /^\d+$/.test(text) ? text : '0';
  } catch {
    return '0';
  }
}

function asFamePoints(value: unknown): number {
  try {
    const n = Number(typeof value === 'bigint' ? value : String(value ?? '0'));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  } catch {
    return 0;
  }
}

async function readFamaHermano(credit: Contract): Promise<string | null> {
  try {
    const hermano = await credit.famaHermano();
    return isFamaAddress(String(hermano || '')) ? String(hermano) : '';
  } catch (error) {
    if (isUnreadRpc(error)) return null;
    return '';
  }
}

const proposeAdmin = async (fragment: string, args: unknown[]) => {
  const { signer } = await requireSigner();
  const contract = contractWith(signer);
  const data = contract.interface.encodeFunctionData(fragment, args);
  const tx = await contract.proposeAdminAction(data);
  return waitMined(tx);
};

const assertProposalId = (id: number) => {
  if (!Number.isInteger(id) || id < 1) throw new Error('no-admin-proposal');
};

async function agreedUintAt(
  contract: Contract,
  method: string,
  args: readonly unknown[],
  index = 0
): Promise<bigint> {
  const data = contract.interface.encodeFunctionData(method, [...args]);
  const agreed = await agreedCallData(publicRpcList(), await contract.getAddress(), data);
  if (agreed.kind !== 'value') throw new Error('rpc-money-mismatch');
  const decoded = contract.interface.decodeFunctionResult(method, agreed.value);
  return BigInt(decoded[index]);
}

const asegurarAprobacionToken = async (
  signer: Signer,
  userAddress: string,
  tokenAddress: string,
  amountWei: string,
  spender = getContractAddress()
) => {
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
  const allowance = await agreedUintAt(tokenContract, 'allowance', [userAddress, spender]);
  const required = BigInt(amountWei);

  if (allowance < required) {
    logInfo('Aprobando token para el contrato...');
    const txApprove = await tokenContract.approve(spender, required);
    await waitMined(txApprove);
    logInfo('Token aprobado');
  }
};

const DEMO_TOKEN_ABI = [...ERC20_ABI, 'function mint(address to, uint256 amount)'];

/** En Demo cubre el interés con USDT de prueba para poder pagar y subir de nivel. Nunca en Real. */
async function topUpDemoUsdtToDebt(tokenAddress: string, neededWei = '0'): Promise<boolean> {
  if (!isDemoAccount() || !isDemoMode()) return false;
  if (!isTestnetOnlyToken(tokenAddress)) return false;
  const { signer } = await requireInternalSigner();
  const userAddress = await signer.getAddress();
  const credit = contractWith(signer);
  const fromLoan = await agreedUintAt(credit, 'obtenerDeuda', [userAddress], 2);
  let needed = fromLoan;
  if (neededWei && neededWei !== '0') {
    try {
      const extra = BigInt(neededWei);
      if (extra > needed) needed = extra;
    } catch {
      // Se usa la deuda on-chain.
    }
  }
  if (needed <= 0n) return false;
  const token = new Contract(tokenAddress, DEMO_TOKEN_ABI, signer);
  const balance = await agreedUintAt(token, 'balanceOf', [userAddress]);
  if (balance >= needed) return false;
  const tx = await token.mint(userAddress, needed - balance);
  await waitMined(tx);
  return true;
}

async function mintDemoUsdtTo(
  tokenAddress: string,
  to: string,
  amountWei: string
): Promise<boolean> {
  if (!isDemoAccount() || !isDemoMode()) return false;
  if (!isTestnetOnlyToken(tokenAddress) || !isAddress(to)) return false;
  let needed = 0n;
  try {
    needed = BigInt(amountWei || '0');
  } catch {
    return false;
  }
  if (needed <= 0n) return false;
  const { signer } = await requireInternalSigner();
  const token = new Contract(tokenAddress, DEMO_TOKEN_ABI, signer);
  const balance = (await token.balanceOf(to)) as bigint;
  if (balance >= needed) return false;
  const tx = await token.mint(to, needed - balance);
  await waitMined(tx);
  return true;
}

export const QuatriviumCreditService = {
  detectarCapacidadProtocolo: async (): Promise<ProtocolCaps> => {
    if (!isContractConfigured() || !isAddress(getContractAddress())) {
      return DEFAULT_CAPS;
    }
    const addr = getContractAddress().toLowerCase();
    if (capsCache?.addr === addr) return capsCache.caps;
    const { provider } = await getProviderAndSigner();
    const credit = contractWith(provider);
    let maxLevel = CORE_LOAN_LEVEL;
    let canClaimHitos = false;
    let canDonate = false;
    let canCanjearFama = false;
    let canRacha = false;
    let canPagarVerificacion = false;
    let unread = false;
    const miss = (error: unknown) => {
      if (isUnreadRpc(error)) unread = true;
    };
    try {
      const row = await credit.niveles(CORE_LOAN_LEVEL + 1);
      if (BigInt(row[0] ?? 0) > 0n) maxLevel = MAX_LOAN_LEVEL;
    } catch (error) {
      miss(error);
    }
    try {
      await credit.hitoCobrado(ZeroAddress);
      canClaimHitos = true;
    } catch (error) {
      miss(error);
    }
    try {
      await credit.donado(ZeroAddress);
      canDonate = true;
    } catch (error) {
      miss(error);
    }
    const hermano = await readFamaHermano(credit);
    if (hermano === null) unread = true;
    else canCanjearFama = Boolean(hermano);
    if (canCanjearFama && hermano) {
      try {
        const fama = new Contract(hermano, FAMA_ABI, provider);
        await fama.FAMA_POR_DIA_RACHA();
        canRacha = true;
      } catch (error) {
        miss(error);
      }
    }
    try {
      const code = await provider.getCode(addr);
      const sel = id('pagarVerificacion(address,uint256)').slice(2, 10).toLowerCase();
      canPagarVerificacion = Boolean(code) && code.toLowerCase().includes(sel);
    } catch (error) {
      miss(error);
    }
    if (unread) {
      if (capsCache?.addr === addr) return capsCache.caps;
      throw new Error('caps-unread');
    }
    const caps = {
      maxLevel,
      canClaimHitos,
      canDonate,
      canCanjearFama,
      canRacha,
      canPagarVerificacion,
    };
    capsCache = { addr, caps };
    return caps;
  },

  connectWallet: async () => {
    const { signer } = await getProviderAndSigner();
    if (!signer) {
      throw new Error('no-wallet');
    }
    return signer.getAddress();
  },

  depositar: async (amountInWei: string, tokenAddress: string) => {
    if (isDemoAccount() || isDemoMode()) {
      throw new Error('pool-real-only');
    }
    assertToken(tokenAddress);
    assertAmount(amountInWei);
    const { signer } = await requireInternalSigner();
    const userAddress = await signer.getAddress();
    await asegurarAprobacionToken(signer, userAddress, tokenAddress, amountInWei);
    const tx = await contractWith(signer).depositarLiquidez(tokenAddress, amountInWei);
    return waitMined(tx);
  },

  retirar: async (_amountInWei: string, _tokenAddress: string) => {
    throw new Error('pool locked');
  },

  solicitar: async (tokenAddress: string, nivel = 0) => {
    assertToken(tokenAddress);
    if (!Number.isInteger(nivel) || nivel < 0 || nivel > MAX_LOAN_LEVEL) {
      throw new Error('invalid-level');
    }
    const { signer } = await requireInternalSigner();
    const phraseOk = await isPhraseBackedUp().catch(() => false);
    if (!phraseOk) {
      throw new Error('phrase-required');
    }
    const userAddressForGate = await signer.getAddress();
    if (isAltaConfigured()) {
      let altaPaid = false;
      try {
        const alta = new Contract(getAltaAddress(), ALTA_ABI, signer);
        altaPaid = Boolean(await alta.registroHecho(userAddressForGate));
      } catch {
        altaPaid = false;
      }
      if (!altaPaid) throw new Error('access-required');
    }
    if (!isDemoAccount() && !isAltaConfigured()) {
      const credit = contractWith(signer);
      const donated = await credit.donado(userAddressForGate).catch(() => 0n);
      if (BigInt(donated.toString()) < 2n * 10n ** 18n) {
        throw new Error('access-required');
      }
    }
    const credit = contractWith(signer);
    await credit.solicitarPrestamo.staticCall(tokenAddress, nivel);
    await cobrarComisionIntermediario(signer, true);
    const tx = await credit.solicitarPrestamo(tokenAddress, nivel);
    const receipt = await waitMined(tx);
    const userAddress = await signer.getAddress();
    const remaining = await agreedUintAt(credit, 'obtenerDeuda', [userAddress], 2);
    if (remaining > 0n) {
      await asegurarAprobacionToken(signer, userAddress, tokenAddress, remaining.toString());
    }
    return receipt;
  },

  cobrarBonoHito: async (tokenAddress: string) => {
    assertToken(tokenAddress);
    const { signer } = await requireInternalSigner();
    const credit = contractWith(signer);
    await credit.cobrarBonoHito.staticCall(tokenAddress);
    const tx = await credit.cobrarBonoHito(tokenAddress);
    return waitMined(tx);
  },

  donar: async (amountInWei: string, tokenAddress: string) => {
    if (!isAccessPaymentEnabled()) {
      throw new Error(isDemoAccount() || isDemoMode() ? 'access-not-ready' : 'donate-real-only');
    }
    assertToken(tokenAddress);
    assertAmount(amountInWei);
    const { signer } = await requireInternalSigner();
    const userAddress = await signer.getAddress();
    await asegurarAprobacionToken(signer, userAddress, tokenAddress, amountInWei);
    const credit = contractWith(signer);
    await credit.donar.staticCall(tokenAddress, amountInWei);
    const tx = await credit.donar(tokenAddress, amountInWei);
    return waitMined(tx);
  },

  pagarVerificacion: async (amountInWei: string, tokenAddress: string) => {
    if (!isAccessPaymentEnabled()) {
      throw new Error(isDemoAccount() || isDemoMode() ? 'access-not-ready' : 'donate-real-only');
    }
    assertToken(tokenAddress);
    assertAmount(amountInWei);
    const { signer } = await requireInternalSigner();
    const userAddress = await signer.getAddress();
    await asegurarAprobacionToken(signer, userAddress, tokenAddress, amountInWei);
    const credit = contractWith(signer);
    await credit.pagarVerificacion.staticCall(tokenAddress, amountInWei);
    const tx = await credit.pagarVerificacion(tokenAddress, amountInWei);
    return waitMined(tx);
  },

  pagarRegistroAlta: async (tokenAddress: string) => {
    if (!isAltaConfigured()) {
      throw new Error('access-not-ready');
    }
    assertToken(tokenAddress);
    const amountInWei = (4n * 10n ** 18n).toString();
    const { signer } = await requireInternalSigner();
    const userAddress = await signer.getAddress();
    await asegurarAprobacionToken(signer, userAddress, tokenAddress, amountInWei, getAltaAddress());
    const alta = new Contract(getAltaAddress(), ALTA_ABI, signer);
    await alta.pagarRegistro.staticCall();
    const tx = await alta.pagarRegistro();
    return waitMined(tx);
  },

  altaPagada: async (userAddress: string) => {
    if (!isAltaConfigured() || !isAddress(userAddress)) return false;
    try {
      const { provider } = await getProviderAndSigner();
      const alta = new Contract(getAltaAddress(), ALTA_ABI, provider);
      return Boolean(await alta.registroHecho(userAddress));
    } catch (error) {
      throw error;
    }
  },

  obtenerSaludAdmin: async (tokenAddress: string) => {
    if (!isContractConfigured() || !isAddress(tokenAddress)) return null;
    try {
      const { provider } = await getProviderAndSigner();
      const credit = contractWith(provider);
      const token = new Contract(tokenAddress, ERC20_ABI, provider);
      const [cash, outstanding, liquidity] = await Promise.all([
        token.balanceOf(getContractAddress()),
        credit.outstandingLoans(tokenAddress),
        credit.totalLiquidity(tokenAddress),
      ]);
      let reservaBote: bigint | null = null;
      let reservaLocked: bigint | null = null;
      let reservaApyBps: number | null = null;
      try {
        const { getReservaAddress, isReservaConfigured, RESERVA_ABI } = await import(
          '../constants/reservaConfig'
        );
        if (!isReservaConfigured()) {
          reservaBote = 0n;
          reservaLocked = 0n;
          reservaApyBps = 0;
        } else {
          const reserva = new Contract(getReservaAddress(), RESERVA_ABI, provider);
          const salud = await reserva.saludReserva();
          reservaBote = BigInt(salud.bote_ ?? salud[0] ?? 0n);
          reservaLocked = BigInt(salud.bloqueado_ ?? salud[1] ?? 0n);
          reservaApyBps = Number(salud.apyBps ?? salud[2] ?? 0);
        }
      } catch {
        reservaBote = null;
        reservaLocked = null;
        reservaApyBps = null;
      }
      return {
        cash: BigInt(cash),
        outstanding: BigInt(outstanding),
        liquidity: BigInt(liquidity),
        fees: 0n,
        reservaBote,
        reservaLocked,
        reservaApyBps,
      };
    } catch {
      return null;
    }
  },

  obtenerFama: async (userAddress: string) => {
    const empty = {
      caja: 0,
      red: 0,
      racha: 0,
      canjeada: 0,
      redCanjeada: 0,
      disponible: 0,
      redDisponible: 0,
      perfil: 0,
    };
    if (!isAddress(userAddress) || !isContractConfigured()) return null;
    const { provider } = await getProviderAndSigner();
    const hermano = await readFamaHermano(contractWith(provider));
    if (hermano === null) return null;
    if (!hermano) return empty;
    const lane = async (work: Promise<unknown>, optional: boolean): Promise<number | null> => {
      try {
        return asFamePoints(await work);
      } catch (error) {
        if (isUnreadRpc(error) || !optional) return null;
        return 0;
      }
    };
    try {
      const fama = new Contract(hermano, FAMA_ABI, provider);
      const [caja, red, racha, canjeada, redCanjeada, disponible, redDisponible, perfil] =
        await Promise.all([
          lane(fama.famaCaja(userAddress), false),
          lane(fama.famaRed(userAddress), true),
          lane(fama.famaRacha(userAddress), true),
          lane(fama.famaCanjeada(userAddress), false),
          lane(fama.famaRedCanjeada(userAddress), true),
          lane(fama.famaDisponible(userAddress), false),
          lane(fama.famaRedDisponible(userAddress), true),
          lane(fama.famaPerfil(userAddress), true),
        ]);
      if (
        [caja, red, racha, canjeada, redCanjeada, disponible, redDisponible, perfil].some(
          (value) => value === null
        )
      ) {
        return null;
      }
      return {
        caja: caja ?? 0,
        red: red ?? 0,
        racha: racha ?? 0,
        canjeada: canjeada ?? 0,
        redCanjeada: redCanjeada ?? 0,
        disponible: disponible ?? 0,
        redDisponible: redDisponible ?? 0,
        perfil: perfil ?? 0,
      };
    } catch {
      return null;
    }
  },

  obtenerRacha: async (userAddress: string) => {
    const empty = {
      dias: 0,
      diasMax: 0,
      famaDias: 0,
      hitoCobrado: 0,
      siguienteHito: 0,
      bonoPendienteUsd: 0,
      graciaVigente: false,
    };
    if (!isAddress(userAddress) || !isContractConfigured()) return null;
    const { provider } = await getProviderAndSigner();
    const hermano = await readFamaHermano(contractWith(provider));
    if (hermano === null) return null;
    if (!hermano) return empty;
    try {
      const fama = new Contract(hermano, FAMA_ABI, provider);
      const row = await fama.obtenerRacha(userAddress);
      const pendingWei = BigInt(row.bonoPendiente ?? row[6] ?? 0);
      return {
        dias: Number(row.dias ?? row[0] ?? 0) || 0,
        diasMax: Number(row.diasMax ?? row[1] ?? 0) || 0,
        famaDias: Number(row.famaDias ?? row[3] ?? 0) || 0,
        hitoCobrado: Number(row.hitoCobrado ?? row[4] ?? 0) || 0,
        siguienteHito: Number(row.siguienteHito ?? row[5] ?? 0) || 0,
        bonoPendienteUsd: Number(formatUnits(pendingWei, 18)) || 0,
        graciaVigente: Boolean(row.graciaVigente ?? row[7]),
      };
    } catch {
      return null;
    }
  },

  notificarRacha: async (hijo: string) => {
    if (!isAddress(hijo)) return;
    const { signer } = await requireInternalSigner();
    const credit = contractWith(signer);
    const hermano = await readFamaHermano(credit);
    if (!hermano) return;
    const caja = new Contract(hermano, FAMA_ABI, signer);
    try {
      await caja.notificarRacha.staticCall(hijo);
      const tx = await caja.notificarRacha(hijo);
      await waitMined(tx);
    } catch {
      /* sin cierre nuevo, sin padrino o hermano legado */
    }
  },

  cobrarBonoRacha: async () => {
    const { signer } = await requireInternalSigner();
    const credit = contractWith(signer);
    const hermano = await readFamaHermano(credit);
    if (!hermano) throw new Error('racha-legacy');
    const caja = new Contract(hermano, FAMA_ABI, signer);
    await caja.cobrarBonoRacha.staticCall();
    const tx = await caja.cobrarBonoRacha();
    return waitMined(tx);
  },

  canjearFama: async (fama: number) => {
    if (!Number.isInteger(fama) || fama < FAMA_CANJE_POR_USDT || fama % FAMA_CANJE_POR_USDT !== 0) {
      throw new Error('invalid-amount');
    }
    const { signer } = await requireInternalSigner();
    const credit = contractWith(signer);
    const hermano = await readFamaHermano(credit);
    if (!hermano) throw new Error('canje-legacy');
    const caja = new Contract(hermano, FAMA_ABI, signer);
    await caja.canjearFama.staticCall(fama);
    const tx = await caja.canjearFama(fama);
    return waitMined(tx);
  },

  canjearFamaRed: async (fama: number) => {
    if (!Number.isInteger(fama) || fama < FAMA_CANJE_POR_USDT || fama % FAMA_CANJE_POR_USDT !== 0) {
      throw new Error('invalid-amount');
    }
    const { signer } = await requireInternalSigner();
    const credit = contractWith(signer);
    const hermano = await readFamaHermano(credit);
    if (!hermano) throw new Error('canje-legacy');
    const caja = new Contract(hermano, FAMA_ABI, signer);
    await caja.canjearFamaRed.staticCall(fama);
    const tx = await caja.canjearFamaRed(fama);
    return waitMined(tx);
  },

  pagar: async (amountInWei: string, tokenAddress: string) => {
    assertToken(tokenAddress);
    assertAmount(amountInWei);
    const { signer } = await requireInternalSigner();
    const userAddress = await signer.getAddress();
    await asegurarAprobacionToken(signer, userAddress, tokenAddress, amountInWei);
    const credit = contractWith(signer);
    await credit.pagarPrestamo.staticCall(tokenAddress, amountInWei);
    await cobrarComisionIntermediario(signer, true);
    const tx = await credit.pagarPrestamo(tokenAddress, amountInWei);
    const receipt = await waitMined(tx);
    await QuatriviumCreditService.notificarRacha(userAddress);
    return receipt;
  },

  pagarCuotas: async (tokenAddress: string, count: number) => {
    assertToken(tokenAddress);
    if (!Number.isInteger(count) || count < 1 || count > 12) {
      throw new Error('invalid-amount');
    }
    const { signer } = await requireInternalSigner();
    const userAddress = await signer.getAddress();
    const credit = contractWith(signer);
    await cobrarComisionIntermediario(signer, true);
    let last: unknown = null;
    for (let i = 0; i < count; i += 1) {
      const totalDue = await agreedUintAt(credit, 'obtenerDeuda', [userAddress], 2);
      const plan = await credit.planPago(userAddress);
      const pagado = plan[0] as bigint;
      if (totalDue <= pagado) break;
      const restantes = totalDue - pagado;
      const totales = Number(plan[2]) || 1;
      const pagadas = Number(plan[3]);
      const left = Math.max(1, totales - pagadas);
      const leftover = count - i;
      const amount = leftover >= left || left <= 1 ? restantes : restantes / BigInt(left);
      if (amount <= 0n) break;
      await asegurarAprobacionToken(signer, userAddress, tokenAddress, amount.toString());
      await credit.pagarPrestamo.staticCall(tokenAddress, amount);
      const tx = await credit.pagarPrestamo(tokenAddress, amount);
      last = await waitMined(tx);
      if (leftover >= left || left <= 1) break;
    }
    await QuatriviumCreditService.notificarRacha(userAddress);
    return last;
  },

  registrarHumano: async (_userAddress: string, padre?: string) => {
    const { signer } = await requireInternalSigner();
    const sponsor = padre && isAddress(padre) ? padre : ZeroAddress;
    const tx = await contractWith(signer).registrarHumanoConPadre(sponsor);
    return waitMined(tx);
  },

  topUpDemoUsdtToDebt,
  mintDemoUsdtTo,

  proposeAddAdmin: async (address: string) => {
    if (!isAddress(address)) throw new Error('invalid address');
    return proposeAdmin('addAdmin', [address]);
  },

  proposeRemoveAdmin: async (address: string) => {
    if (!isAddress(address)) throw new Error('invalid address');
    return proposeAdmin('removeAdmin', [address]);
  },

  proposeFundador: async (address: string) => {
    if (!isAddress(address)) throw new Error('invalid address');
    return proposeAdmin('setFundador', [address]);
  },

  confirmAdminAction: async (id: number) => {
    assertProposalId(id);
    const { signer } = await requireSigner();
    const credit = contractWith(signer);
    await credit.confirmAdminAction.staticCall(id);
    const tx = await credit.confirmAdminAction(id);
    return waitMined(tx);
  },

  executeAdminAction: async (id: number) => {
    assertProposalId(id);
    const { signer } = await requireSigner();
    const tx = await contractWith(signer).executeAdminAction(id);
    return waitMined(tx);
  },

  obtenerDatosUsuario: async (userAddress: string, tokenAddress: string) => {
    const { provider } = await getProviderAndSigner();
    const contract = contractWith(provider);
    try {
      const lpValue = await contract.valorLp(userAddress, tokenAddress);
      return { liquidezDepositada: lpValue.toString() };
    } catch (e) {
      logWarn('valorLp falló:', e);
      return { liquidezDepositada: '0' };
    }
  },

  disconnect: async () => {
    clearWalletSigner();
  },

  obtenerProgresoUsuario: async (userAddress: string) => {
    const { provider } = await getProviderAndSigner();
    const progress = await contractWith(provider).obtenerProgresoUsuario(userAddress);
    const nivelActual = Number(progress.nivelActual ?? progress[0]);
    const solicitudesCompletadas = Number(progress.solicitudesCompletadas ?? progress[1]);
    const ultimoPrestamoTimestamp = Number(progress.ultimoPrestamoTimestamp ?? progress[2]);
    let lastHito = 0;
    let hitoSupported = false;
    let donatedWei: string | null = '0';
    const caps = await QuatriviumCreditService.detectarCapacidadProtocolo();
    if (caps.canClaimHitos) {
      try {
        lastHito = Number(await contractWith(provider).hitoCobrado(userAddress));
        hitoSupported = true;
      } catch {
        lastHito = 0;
      }
    }
    if (caps.canDonate) {
      try {
        donatedWei = (await contractWith(provider).donado(userAddress)).toString();
      } catch {
        donatedWei = null;
      }
    }
    return {
      nivelActual,
      solicitudesCompletadas,
      ultimoPrestamoTimestamp,
      lastHito,
      bonusPending: hitoSupported ? nextClaimableMilestone(nivelActual, lastHito) : 0,
      nextMilestone: nextUpcomingMilestone(nivelActual, lastHito),
      donatedWei: donatedWei == null ? null : asWeiString(donatedWei),
    };
  },

  obtenerCooldownRestante: async (userAddress: string) => {
    const progress = await QuatriviumCreditService.obtenerProgresoUsuario(userAddress);
    return cooldownRestanteDesdeTimestamp(progress.ultimoPrestamoTimestamp);
  },

  obtenerOwner: async () => {
    const { provider } = await getProviderAndSigner();
    try {
      return await contractWith(provider).owner();
    } catch (e) {
      logWarn('owner falló:', e);
      return '0x0000000000000000000000000000000000000000';
    }
  },

  cancelAdminAction: async (id: number) => {
    assertProposalId(id);
    const { signer } = await requireSigner();
    const tx = await contractWith(signer).cancelAdminAction(id);
    return waitMined(tx);
  },

  liquidar: async (debtorAddress: string, tokenAddress: string) => {
    if (!isAddress(debtorAddress)) throw new Error('invalid address');
    assertToken(tokenAddress);
    const { signer } = await requireSigner();
    const credit = contractWith(signer);
    const userAddress = await signer.getAddress();
    // Obtener la deuda total del deudor para aprobar el monto exacto
    const totalDue = await agreedUintAt(credit, 'obtenerDeuda', [debtorAddress], 2);
    if (totalDue <= 0n) throw new Error('no-active-debt');
    const plan = await credit.planPago(debtorAddress);
    const pagado = plan[0] as bigint;
    const remaining = totalDue > pagado ? totalDue - pagado : 0n;
    if (remaining <= 0n) throw new Error('no-active-debt');
    await asegurarAprobacionToken(signer, userAddress, tokenAddress, remaining.toString());
    const tx = await credit.liquidate(debtorAddress, tokenAddress);
    return waitMined(tx);
  },

  marcarMorosoSiVencido: async (debtorAddress: string) => {
    if (!isAddress(debtorAddress)) throw new Error('invalid address');
    const { signer } = await requireSigner();
    const tx = await contractWith(signer).marcarMorosoSiVencido(debtorAddress);
    return waitMined(tx);
  },

  prepareDeposit: async (tokenAddress: string, amountInWei: string) => {
    assertContractConfigured();
    const iface = new Interface(CONTRACT_ABI);
    const data = iface.encodeFunctionData('depositarLiquidez', [tokenAddress, amountInWei]);
    return { to: getContractAddress(), data, value: '0x0' };
  },

  prepareRegistrarHumano: async (_userAddress: string, padre?: string) => {
    assertContractConfigured();
    const iface = new Interface(CONTRACT_ABI);
    const sponsor = padre && isAddress(padre) ? padre : ZeroAddress;
    const data = iface.encodeFunctionData('registrarHumanoConPadre', [sponsor]);
    return { to: getContractAddress(), data, value: '0x0' };
  },
};
