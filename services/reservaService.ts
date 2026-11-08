import { Contract, formatUnits, isAddress, parseUnits, type Signer } from 'ethers';
import { ERC20_ABI, getContractAddress, getUsdtAddress } from '../constants/contractConfig';
import { assertTrustedRpc, getProviderWithFallback, isDemoAccount } from '../constants/rpcConfig';
import {
  getReservaAddress,
  isReservaConfigured,
  reservaUsesPracticeLedger,
  RESERVA_ABI,
} from '../constants/reservaConfig';
import {
  RESERVA_LOCK_SECONDS,
  RESERVA_MIN_LEVEL,
  RESERVA_MIN_LOCK_WEI,
  reservaBoostRedBp,
  reservaCorteFundadorBp,
  reservaTechoWei,
  reservaTramoUsd,
} from '../constants/reserva';
import {
  demoAportarBote,
  demoAplicarRetiro,
  demoBloquear,
  demoDesbloquear,
  demoProponerRetiro,
  demoRenovar,
  loadDemoBote,
  loadDemoPosicion,
  loadDemoRetiro,
} from './reservaDemoStore';
import { waitMined } from '../utils/waitMined';

export type ReservaPreview = {
  practice: boolean;
  configured: boolean;
  pausedOnChain: boolean;
  principalWei: bigint;
  desde: number;
  unlockAt: number;
  activa: boolean;
  enRed: boolean;
  boteWei: bigint;
  apyBps: number;
  apyKnown: boolean;
  techoWei: bigint;
  tramo: 1 | 2 | 3;
  boostBp: number;
  founderBp: number;
  ready: boolean;
};

const CREDIT_LEVEL_ABI = [
  'function obtenerProgresoUsuario(address usuario) view returns (uint256 nivelActual, uint256 solicitudesCompletadas, uint256 ultimoPrestamoTimestamp)',
];

async function assertNivelReserva(wallet: string): Promise<void> {
  const creditAddr = getContractAddress();
  if (!creditAddr) throw new Error('reservaNeedLevel');
  try {
    const provider = await assertTrustedRpc(getProviderWithFallback());
    const credit = new Contract(creditAddr, CREDIT_LEVEL_ABI, provider);
    const progress = await credit.obtenerProgresoUsuario(wallet);
    const nivel = Number(progress.nivelActual ?? progress[0] ?? 0);
    if (nivel < RESERVA_MIN_LEVEL) throw new Error('reservaNeedLevel');
  } catch (error) {
    if (String((error as Error).message || '').includes('reservaNeedLevel')) throw error;
    throw new Error('reserva-read');
  }
}

function emptyPreview(practice: boolean, configured: boolean): ReservaPreview {
  return {
    practice,
    configured,
    pausedOnChain: false,
    principalWei: 0n,
    desde: 0,
    unlockAt: 0,
    activa: false,
    enRed: false,
    boteWei: 0n,
    apyBps: 0,
    apyKnown: false,
    techoWei: 0n,
    tramo: 1,
    boostBp: 0,
    founderBp: reservaCorteFundadorBp(1),
    ready: false,
  };
}

export async function loadReservaPreview(
  wallet: string,
  enRedHint = false
): Promise<ReservaPreview> {
  const practice = reservaUsesPracticeLedger();
  const configured = isReservaConfigured();
  if (!wallet) return emptyPreview(practice, configured);
  if (practice) {
    const pos = await loadDemoPosicion(wallet);
    const now = Math.floor(Date.now() / 1000);
    const principal = BigInt(pos.principal || '0');
    const elapsed = pos.activa ? now - pos.desde : 0;
    const tramo = reservaTramoUsd(Number(formatUnits(principal || 0n, 18)));
    const enRed = pos.activa ? pos.enRed : enRedHint;
    return {
      practice: true,
      configured: false,
      pausedOnChain: false,
      principalWei: principal,
      desde: pos.desde,
      unlockAt: pos.activa ? pos.desde + RESERVA_LOCK_SECONDS : 0,
      activa: pos.activa,
      enRed,
      boteWei: await loadDemoBote(),
      apyBps: 0,
      apyKnown: false,
      techoWei: pos.activa ? reservaTechoWei(principal, elapsed) : 0n,
      tramo,
      boostBp: enRed ? reservaBoostRedBp(tramo) : 0,
      founderBp: reservaCorteFundadorBp(tramo),
      ready: pos.activa && now >= pos.desde + RESERVA_LOCK_SECONDS,
    };
  }
  if (!configured) return emptyPreview(false, false);
  const provider = await assertTrustedRpc(getProviderWithFallback());
  const reserva = new Contract(getReservaAddress(), RESERVA_ABI, provider);
  const [pos, bote, unlockAt, salud] = await Promise.all([
    reserva.posiciones(wallet),
    reserva.bote(),
    reserva.desbloqueoDe(wallet),
    reserva.saludReserva().catch(() => null),
  ]);
  const principal = BigInt(pos.principal || 0n);
  const desde = Number(pos.desde || 0n);
  const activa = Boolean(pos.activa);
  const enRed = Boolean(pos.enRed);
  const now = Math.floor(Date.now() / 1000);
  const elapsed = activa ? now - desde : 0;
  const tramo = reservaTramoUsd(Number(formatUnits(principal || 0n, 18)));
  const saludApy = salud ? Number(salud.apyBps ?? salud[2]) : Number.NaN;
  return {
    practice: false,
    configured: true,
    pausedOnChain: false,
    principalWei: principal,
    desde,
    unlockAt: Number(unlockAt || 0n),
    activa,
    enRed,
    boteWei: BigInt(salud ? (salud.bote_ ?? salud[0] ?? bote) : bote || 0n),
    apyBps: Number.isFinite(saludApy) ? saludApy : 0,
    apyKnown: Number.isFinite(saludApy),
    techoWei: activa ? reservaTechoWei(principal, elapsed) : 0n,
    tramo,
    boostBp: enRed ? reservaBoostRedBp(tramo) : 0,
    founderBp: reservaCorteFundadorBp(tramo),
    ready: activa && now >= desde + RESERVA_LOCK_SECONDS,
  };
}

async function withToken(signer: Signer, amount: bigint) {
  const reservaAddr = getReservaAddress();
  const tokenAddr = getUsdtAddress();
  const expectedCredit = getContractAddress().toLowerCase();
  const provider = signer.provider;
  if (!provider) throw new Error('reserva-not-ready');
  const code = await provider.getCode(reservaAddr);
  if (!code || code === '0x') throw new Error('reserva-not-ready');
  const reserva = new Contract(reservaAddr, RESERVA_ABI, signer);
  const [onChainToken, onChainCredit] = await Promise.all([reserva.token(), reserva.credit()]);
  if (String(onChainToken).toLowerCase() !== tokenAddr.toLowerCase()) {
    throw new Error('reserva-not-ready');
  }
  if (String(onChainCredit).toLowerCase() !== expectedCredit) {
    throw new Error('reserva-not-ready');
  }
  const token = new Contract(tokenAddr, ERC20_ABI, signer);
  const allowance = BigInt(await token.allowance(await signer.getAddress(), reservaAddr));
  if (allowance < amount) {
    const tx = await token.approve(reservaAddr, amount);
    await waitMined(tx);
  }
  return reserva;
}

export async function bloquearReserva(
  signer: Signer,
  amountUsd: string,
  enRed: boolean
): Promise<void> {
  const amount = parseUnits(amountUsd, 18);
  if (amount < RESERVA_MIN_LOCK_WEI) throw new Error('reservaMonto');
  await assertNivelReserva(await signer.getAddress());
  if (reservaUsesPracticeLedger()) {
    await demoBloquear(await signer.getAddress(), amount, enRed);
    return;
  }
  if (!isReservaConfigured()) throw new Error('reserva-not-ready');
  const reserva = await withToken(signer, amount);
  const tx = await reserva.bloquear(amount);
  await waitMined(tx);
}

export async function desbloquearReserva(signer: Signer): Promise<void> {
  if (reservaUsesPracticeLedger()) {
    await demoDesbloquear(await signer.getAddress());
    return;
  }
  if (!isReservaConfigured()) throw new Error('reserva-not-ready');
  const reserva = new Contract(getReservaAddress(), RESERVA_ABI, signer);
  const tx = await reserva.desbloquear();
  await waitMined(tx);
}

export async function renovarReserva(signer: Signer, enRed: boolean): Promise<void> {
  await assertNivelReserva(await signer.getAddress());
  if (reservaUsesPracticeLedger()) {
    await demoRenovar(await signer.getAddress(), enRed);
    return;
  }
  if (!isReservaConfigured()) throw new Error('reserva-not-ready');
  const reserva = new Contract(getReservaAddress(), RESERVA_ABI, signer);
  const tx = await reserva.renovar();
  await waitMined(tx);
}

export async function aportarReservaBote(signer: Signer, amountUsd: string): Promise<void> {
  const amount = parseUnits(amountUsd, 18);
  if (amount <= 0n) throw new Error('reservaMonto');
  if (reservaUsesPracticeLedger()) {
    await demoAportarBote(amount);
    return;
  }
  if (!isReservaConfigured()) throw new Error('reserva-not-ready');
  const reserva = await withToken(signer, amount);
  const tx = await reserva.aportarBote(amount);
  await waitMined(tx);
}

export type RetiroBotePendiente = { to: string; amountWei: bigint; desde: number };

export async function leerPendienteRetiroBote(): Promise<RetiroBotePendiente | null> {
  if (reservaUsesPracticeLedger()) {
    const row = await loadDemoRetiro();
    if (!row) return null;
    return { to: row.to, amountWei: BigInt(row.amount), desde: row.desde };
  }
  if (!isReservaConfigured()) return null;
  const provider = await assertTrustedRpc(getProviderWithFallback());
  const reserva = new Contract(getReservaAddress(), RESERVA_ABI, provider);
  const [to, amount, desde] = await Promise.all([
    reserva.pendienteRetiroA(),
    reserva.pendienteRetiroMonto(),
    reserva.pendienteRetiroDesde(),
  ]);
  const destino = String(to || '');
  const monto = BigInt(amount || 0);
  const desdeN = Number(desde || 0);
  if (!isAddress(destino) || /^0x0+$/i.test(destino) || monto <= 0n || desdeN <= 0) return null;
  return { to: destino, amountWei: monto, desde: desdeN };
}

export async function proponerRetiroReserva(
  signer: Signer,
  destino: string,
  amountUsd: string
): Promise<void> {
  if (!isAddress(destino)) throw new Error('reservaMonto');
  const amount = parseUnits(amountUsd, 18);
  if (amount <= 0n) throw new Error('reservaMonto');
  if (reservaUsesPracticeLedger()) {
    await demoProponerRetiro(destino, amount);
    return;
  }
  if (!isReservaConfigured()) throw new Error('reserva-not-ready');
  const reserva = new Contract(getReservaAddress(), RESERVA_ABI, signer);
  const tx = await reserva.proponerRetiroBote(destino, amount);
  await waitMined(tx);
}

export async function aplicarRetiroReserva(signer: Signer): Promise<void> {
  if (reservaUsesPracticeLedger()) {
    await demoAplicarRetiro();
    return;
  }
  if (!isReservaConfigured()) throw new Error('reserva-not-ready');
  const reserva = new Contract(getReservaAddress(), RESERVA_ABI, signer);
  const tx = await reserva.applyRetiroBote();
  await waitMined(tx);
}

export type ReservaErrorKey =
  | 'reservaPeriodoActivo'
  | 'reservaAunBloqueado'
  | 'reservaNada'
  | 'reservaDelinquent'
  | 'reservaNoContract'
  | 'reservaMonto'
  | 'reservaNeedLevel'
  | 'reservaReadFailed'
  | 'reservaAdminOnly'
  | 'reservaRetiroWait'
  | 'reservaRetiroSame'
  | 'securityPausedBanner'
  | 'errEmptyRevertDemo'
  | 'error';

export function reservaErrorKey(error: unknown): ReservaErrorKey {
  const err = error as {
    message?: string;
    shortMessage?: string;
    reason?: string;
    revert?: { name?: string };
  };
  const raw = [err.revert?.name, err.shortMessage, err.reason, err.message, String(error || '')]
    .filter(Boolean)
    .join(' ');
  if (raw.includes('reservaPeriodoActivo') || raw.includes('PeriodoActivo'))
    return 'reservaPeriodoActivo';
  if (raw.includes('reservaAunBloqueado') || raw.includes('AunBloqueado'))
    return 'reservaAunBloqueado';
  if (raw.includes('reservaNada') || raw.includes('NadaQueMover')) return 'reservaNada';
  if (raw.includes('reservaMonto') || raw.includes('MontoCero')) return 'reservaMonto';
  if (raw.includes('reservaDelinquent') || raw.includes('EnMora')) return 'reservaDelinquent';
  if (raw.includes('reserva-read')) return 'reservaReadFailed';
  if (raw.includes('reservaNeedLevel') || raw.includes('NivelInsuficiente'))
    return 'reservaNeedLevel';
  if (raw.includes('reservaAdminOnly') || raw.includes('SoloAdmin')) return 'reservaAdminOnly';
  if (raw.includes('reservaEspera') || raw.includes('EsperaTimelock')) return 'reservaRetiroWait';
  if (raw.includes('reservaMisma') || raw.includes('MismaLlave')) return 'reservaRetiroSame';
  if (raw.includes('CreditoPausado') || raw.includes('EnforcedPause') || raw.includes('Pausable'))
    return 'securityPausedBanner';
  if (raw.includes('SoloEOA')) return 'error';
  if (raw.includes('insufficient') || raw.includes('ERC20InsufficientBalance'))
    return 'reservaMonto';
  if (raw.includes('reserva-not-ready')) return 'reservaNoContract';
  if (isDemoAccount()) return 'errEmptyRevertDemo';
  return 'error';
}
