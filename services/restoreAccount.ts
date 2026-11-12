import { BOUND_UNKNOWN, getBoundWallet } from './deviceBinding';
import {
  abortPasswordSetup,
  clearLockAfterSuccess,
  preparePasswordReplace,
  setPassword,
} from './appLock';
import { addressFromPhrase, importFromPhrase } from './appWallet';
import type { HDNodeWallet } from 'ethers';

export type RestoreAccountResult =
  | { ok: true; wallet: HDNodeWallet }
  | {
      ok: false;
      reason: 'store-unknown' | 'wallet-other-app' | 'phrase' | 'password' | 'import' | string;
    };

/**
 * Restaura solo si la frase es de este teléfono (o no hay vinculada).
 * No escribe nada hasta pasar esa comprobación. Si falla a mitad, restaura la contraseña.
 */
export async function restoreAccountOnDevice(input: {
  phrase: string;
  password: string;
}): Promise<RestoreAccountResult> {
  let address = '';
  try {
    address = addressFromPhrase(input.phrase);
  } catch {
    return { ok: false, reason: 'phrase' };
  }
  const bound = await getBoundWallet();
  if (bound === BOUND_UNKNOWN) return { ok: false, reason: 'store-unknown' };
  if (bound && bound !== address) return { ok: false, reason: 'wallet-other-app' };

  let token = '';
  try {
    token = await preparePasswordReplace();
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'password' };
  }
  try {
    await setPassword(input.password, undefined, {
      replaceToken: token,
      keepLockCounters: true,
    });
    const wallet = await importFromPhrase(input.phrase);
    await clearLockAfterSuccess();
    return { ok: true, wallet };
  } catch (error) {
    await abortPasswordSetup().catch(() => {});
    const code = error instanceof Error ? error.message : 'import';
    if (code === 'device-bound') return { ok: false, reason: 'wallet-other-app' };
    if (code === 'phrase' || code.includes('phrase')) return { ok: false, reason: 'phrase' };
    return { ok: false, reason: code || 'import' };
  }
}
