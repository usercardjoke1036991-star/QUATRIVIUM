import { addressFromPhrase, importFromPhrase } from './appWallet';
import {
  clearLockAfterSuccess,
  clearRestorePasswordBackup,
  restorePasswordForPhrase,
} from './appLock';
import type { HDNodeWallet } from 'ethers';

export type RestoreAccountResult =
  | { ok: true; wallet: HDNodeWallet }
  | {
      ok: false;
      reason: 'store-unknown' | 'wallet-other-app' | 'phrase' | 'password' | 'import' | string;
    };

/**
 * Restaura solo si la frase es de este teléfono (o no hay vinculada).
 * La comprobación del vínculo y el token viven en appLock.
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
  try {
    await restorePasswordForPhrase({ phraseAddress: address, password: input.password });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'password';
    if (code === 'store-unknown' || code === 'wallet-other-app' || code === 'phrase') {
      return { ok: false, reason: code };
    }
    return { ok: false, reason: code || 'password' };
  }
  try {
    const wallet = await importFromPhrase(input.phrase);
    await clearLockAfterSuccess();
    clearRestorePasswordBackup();
    return { ok: true, wallet };
  } catch (error) {
    const { abortOpenAttempt } = await import('./appLock');
    await abortOpenAttempt().catch(() => {});
    const code = error instanceof Error ? error.message : 'import';
    if (code === 'device-bound') return { ok: false, reason: 'wallet-other-app' };
    if (code === 'store-unknown') return { ok: false, reason: 'store-unknown' };
    if (code === 'phrase' || code.includes('phrase')) return { ok: false, reason: 'phrase' };
    return { ok: false, reason: code || 'import' };
  }
}
