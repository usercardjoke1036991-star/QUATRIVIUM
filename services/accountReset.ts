import { clearClaimedUsername } from './accountUsername';
import { clearOwnProfile } from './userProfile';
import { clearSavedSession } from './savedSession';

/** Solo al recuperar otra frase en este teléfono. No hay destruir cuenta en la app. */
export async function wipeLocalAccount(wallet: string): Promise<void> {
  await Promise.all([clearClaimedUsername(), clearOwnProfile(wallet), clearSavedSession()]);
}
