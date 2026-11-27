import { BOUND_UNKNOWN, getBoundWallet } from './deviceBinding';

export type BoundLookup =
  | { status: 'none' }
  | { status: 'wallet'; address: string }
  | { status: 'unknown' };

/** Billetera vinculada en este dispositivo, o unknown si el almacén no responde. */
export async function lookupBoundWalletOnThisDevice(): Promise<BoundLookup> {
  const localBound = await getBoundWallet();
  if (localBound === BOUND_UNKNOWN) return { status: 'unknown' };
  if (!localBound) return { status: 'none' };
  return { status: 'wallet', address: String(localBound).toLowerCase() };
}

/** Bloquea traer otra billetera a un teléfono que ya tiene dueño local (sin consulta on-chain). */
export async function assertRestoreFitsThisDevice(phraseWallet: string): Promise<void> {
  const next = String(phraseWallet || '').toLowerCase();
  const localBound = await getBoundWallet();
  if (localBound === BOUND_UNKNOWN) throw new Error('store-unknown');
  if (localBound && localBound !== next) {
    throw new Error('device-bound');
  }
}
