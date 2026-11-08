import { getBoundWallet } from './deviceBinding';

/** Devuelve la billetera vinculada localmente en este dispositivo (o vacío si no existe). */
export async function lookupBoundWalletOnThisDevice(): Promise<string> {
  const localBound = await getBoundWallet();
  return localBound ? String(localBound).toLowerCase() : '';
}

/** Bloquea traer otra billetera a un teléfono que ya tiene dueño local (sin consulta on-chain). */
export async function assertRestoreFitsThisDevice(phraseWallet: string): Promise<void> {
  const next = String(phraseWallet || '').toLowerCase();
  const localBound = await getBoundWallet();
  if (localBound && localBound !== next) {
    throw new Error('device-bound');
  }
}
