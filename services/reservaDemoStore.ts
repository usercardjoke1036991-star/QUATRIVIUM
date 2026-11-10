import * as SecureStore from 'expo-secure-store';
import { storeSlot } from '../utils/storeSlot';
import {
  RESERVA_LOCK_SECONDS,
  RESERVA_MIN_LOCK_WEI,
  reservaBoostRedBp,
  reservaCorteFundadorBp,
  reservaTechoWei,
  reservaTramoUsd,
} from '../constants/reserva';

const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const BOTE_KEY = storeSlot(['quatrivium', 'reserva', 'demoBote']);

function posKey(wallet: string): string {
  return storeSlot(['quatrivium', 'reserva', 'demoPos', String(wallet || '').toLowerCase()]);
}

export type DemoPosicion = {
  principal: string;
  desde: number;
  activa: boolean;
  enRed: boolean;
};

const EMPTY: DemoPosicion = { principal: '0', desde: 0, activa: false, enRed: false };

export async function loadDemoPosicion(wallet: string): Promise<DemoPosicion> {
  try {
    const raw = await SecureStore.getItemAsync(posKey(wallet));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as DemoPosicion;
    if (!parsed || typeof parsed.principal !== 'string') return { ...EMPTY };
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

async function saveDemoPosicion(wallet: string, pos: DemoPosicion): Promise<void> {
  await SecureStore.setItemAsync(posKey(wallet), JSON.stringify(pos), OPTIONS);
}

export async function loadDemoBote(): Promise<bigint> {
  try {
    const raw = await SecureStore.getItemAsync(BOTE_KEY);
    if (!raw) return 10n * 10n ** 18n;
    return BigInt(raw);
  } catch {
    return 10n * 10n ** 18n;
  }
}

async function saveDemoBote(value: bigint): Promise<void> {
  await SecureStore.setItemAsync(BOTE_KEY, value.toString(), OPTIONS);
}

export async function demoAportarBote(montoWei: bigint): Promise<void> {
  if (montoWei <= 0n) throw new Error('reservaMonto');
  const bote = await loadDemoBote();
  await saveDemoBote(bote + montoWei);
}

function settle(
  pos: DemoPosicion,
  now: number,
  bote: bigint
): { userPay: bigint; founderCut: bigint; nextBote: bigint } {
  const principal = BigInt(pos.principal || '0');
  const elapsed = now - pos.desde;
  const techo = reservaTechoWei(principal, elapsed);
  const usd = Number(principal / 10n ** 18n);
  const tramo = reservaTramoUsd(usd);
  const grosso0 = techo < bote ? techo : bote;
  const founderCut = (grosso0 * BigInt(reservaCorteFundadorBp(tramo))) / 10000n;
  let userPay = grosso0 - founderCut;
  let grosso = grosso0;
  if (pos.enRed) {
    let extra = (userPay * BigInt(reservaBoostRedBp(tramo))) / 10000n;
    const leftover = bote - grosso;
    if (extra > leftover) extra = leftover;
    if (userPay + extra > techo) extra = techo - userPay;
    userPay += extra;
    grosso += extra;
  }
  return { userPay, founderCut, nextBote: bote - grosso };
}

export async function demoBloquear(
  wallet: string,
  principalWei: bigint,
  enRed: boolean
): Promise<void> {
  const pos = await loadDemoPosicion(wallet);
  if (pos.activa) throw new Error('reservaPeriodoActivo');
  if (principalWei < RESERVA_MIN_LOCK_WEI) throw new Error('reservaMonto');
  await saveDemoPosicion(wallet, {
    principal: principalWei.toString(),
    desde: Math.floor(Date.now() / 1000),
    activa: true,
    enRed,
  });
}

export async function demoDesbloquear(
  wallet: string
): Promise<{ userPay: bigint; founderCut: bigint }> {
  const pos = await loadDemoPosicion(wallet);
  if (!pos.activa) throw new Error('reservaNada');
  const now = Math.floor(Date.now() / 1000);
  if (now < pos.desde + RESERVA_LOCK_SECONDS) throw new Error('reservaAunBloqueado');
  const bote = await loadDemoBote();
  const paid = settle(pos, now, bote);
  await saveDemoBote(paid.nextBote);
  await saveDemoPosicion(wallet, EMPTY);
  return paid;
}

export async function demoRenovar(
  wallet: string,
  enRed: boolean
): Promise<{ userPay: bigint; founderCut: bigint }> {
  const pos = await loadDemoPosicion(wallet);
  if (!pos.activa) throw new Error('reservaNada');
  const now = Math.floor(Date.now() / 1000);
  if (now < pos.desde + RESERVA_LOCK_SECONDS) throw new Error('reservaAunBloqueado');
  const bote = await loadDemoBote();
  const paid = settle(pos, now, bote);
  await saveDemoBote(paid.nextBote);
  await saveDemoPosicion(wallet, {
    principal: pos.principal,
    desde: now,
    activa: true,
    enRed,
  });
  return paid;
}
