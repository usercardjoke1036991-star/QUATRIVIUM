import { isValidEmail, normalizeEmail } from './emailPolicy';
import { isValidMasterPassword } from './passwordPolicy';
import { isValidUsername, normalizeUsername } from './usernamePolicy';

export function canSubmitCreateSecrets(password: string, email: string): boolean {
  return isValidMasterPassword(password) && isValidEmail(normalizeEmail(email));
}

export function canSubmitDeviceCredentials(password: string, username: string): boolean {
  return isValidMasterPassword(password) && isValidUsername(username);
}

export function canSubmitCreateCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function canSubmitSignIn(password: string, username: string): boolean {
  return Boolean(password) && isValidUsername(username);
}

export function signInEmailMatches(typed: string, saved: string): boolean {
  const left = normalizeEmail(typed);
  const right = normalizeEmail(saved);
  return Boolean(right) && left === right;
}

export function signInEmailAllowed(typed: string, saved: string): boolean {
  if (!isValidEmail(normalizeEmail(typed))) return false;
  if (!normalizeEmail(saved)) return true;
  return signInEmailMatches(typed, saved);
}

/** Crear cuenta solo si este teléfono aún no tiene una y el dispositivo no está ya atado. */
export function welcomeShowsCreate(accountOnPhone: boolean, deviceClaimed = false): boolean {
  return !accountOnPhone && !deviceClaimed;
}

/** Si este aparato ya tuvo cuenta y no queda nada local, solo Iniciar sesión. */
export function welcomeShowsSignIn(accountOnPhone: boolean, deviceClaimed = false): boolean {
  return !accountOnPhone && deviceClaimed;
}

export type EntryScreen = 'welcome' | 'signIn' | 'unlock' | 'app';

/** SecureStore/MIUI: true hay cuenta, false vacío, null no se pudo leer. */
export function accountOnPhoneFromProbes(
  password: boolean | null,
  pin: boolean | null
): boolean | null {
  if (password === true || pin === true) return true;
  if (password === null || pin === null) return null;
  return false;
}

/** Una llave en memoria no abre la app si no descifra el sobre de este teléfono. */
export function wrapReadyForApp(wrapPresent: boolean, walletOpened: boolean): boolean {
  return Boolean(wrapPresent && walletOpened);
}

/**
 * Hay cuenta en este teléfono: un arranque en frío siempre pide el candado.
 * Iniciar sesión solo si el almacén no responde. La llave en memoria no salta el candado.
 */
export function nextEntryScreen(input: {
  accountOnPhone: boolean | null;
  sessionSaved: boolean;
  wrapReady: boolean;
  unlockOn: boolean;
}): EntryScreen {
  if (input.accountOnPhone === null) return 'signIn';
  if (!input.accountOnPhone) return 'welcome';
  return 'unlock';
}

/**
 * La contraseña abrió la sesión y el cofre no cargó: en esa pantalla se ofrece la frase.
 * Si la billetera cargó, o la sesión no está abierta, no.
 */
export function phraseRestoreAfterPasswordUnlock(input: {
  sessionOpen: boolean;
  walletLoaded: boolean;
}): 'phrase' | null {
  if (input.sessionOpen && !input.walletLoaded) return 'phrase';
  return null;
}

/** Desde la pantalla de bloqueo se puede recuperar la cuenta con la frase. */
export function restoreFromLockScreen(screen: 'lock' | 'welcome' | 'app'): 'restore' | null {
  if (screen === 'lock' || screen === 'welcome') return 'restore';
  return null;
}

export type WelcomeAction = 'createPhrase' | 'restoreAccount' | 'signIn';

export function welcomeActions(accountOnPhone: boolean, deviceClaimed = false): WelcomeAction[] {
  if (accountOnPhone) return [];
  if (deviceClaimed) return ['signIn'];
  return ['createPhrase', 'restoreAccount'];
}

function restoreMatchesDevice(claimedWallet: string, phraseWallet: string): boolean {
  const claimed = String(claimedWallet || '').toLowerCase();
  const phrase = String(phraseWallet || '').toLowerCase();
  if (!claimed || claimed === '0x0000000000000000000000000000000000000000') return true;
  return Boolean(phrase) && claimed === phrase;
}

export function walletRunsOnThisDevice(
  onChainDeviceHash: string,
  localDeviceHash: string
): boolean {
  const bound = String(onChainDeviceHash || '');
  if (!bound || /^0x0+$/i.test(bound)) return true;
  return bound.toLowerCase() === String(localDeviceHash || '').toLowerCase();
}

/** Recuperar: si este aparato ya tiene dueño on-chain, solo esa frase. Un teléfono nuevo (hash distinto) sí recupera y luego vuelve a vincular. */
export function restoreAllowedOnThisDevice(input: {
  claimedWallet: string;
  phraseWallet: string;
  onChainDeviceHash?: string;
  localDeviceHash?: string;
}): boolean {
  return restoreMatchesDevice(input.claimedWallet, input.phraseWallet);
}

/** El primero es el principal. Si no hay ninguno, contraseña. */
export function orderUnlockMethods(selected: readonly string[], primary?: string): string[] {
  const unique = [...new Set((selected || []).filter(Boolean))];
  if (!unique.length) return ['password'];
  const head = primary && unique.includes(primary) ? primary : unique[0];
  return [head, ...unique.filter((method) => method !== head)];
}

/** Solo la principal, o todas como opciones. */
export function unlockPromptMethods(
  selected: readonly string[],
  primary: string | undefined,
  primaryOnly: boolean
): string[] {
  const ordered = orderUnlockMethods(selected, primary);
  return primaryOnly ? [ordered[0]] : ordered;
}

/** Si el cofre de huella no abre, no se desbloquea: PIN, luego contraseña. */
export function nextUnlockAfterBiometricFail(
  choices: readonly string[],
  flags: { pinSet: boolean; passwordSet: boolean; authOn: boolean }
): 'pin' | 'password' | 'authenticator' | null {
  const allowed = new Set(choices.filter(Boolean));
  if (flags.pinSet && (allowed.has('pin') || !allowed.size)) return 'pin';
  if (flags.passwordSet && (allowed.has('password') || !allowed.size)) return 'password';
  if (flags.authOn && allowed.has('authenticator')) return 'authenticator';
  if (flags.pinSet) return 'pin';
  if (flags.passwordSet) return 'password';
  return null;
}

/** La app no ofrece destruir ni generar otra cuenta. */
export function appOffersDestroyAccount(): boolean {
  return false;
}

/** Cambiar de red o VPN no crea otra cuenta. */
export function networkChangeCreatesAccount(): boolean {
  return false;
}

/** Tras formatear, el mismo teléfono o dispositivo on-chain no abre otra línea Real. */
export function liveSecondCreditAllowed(flags: {
  phoneTaken: boolean;
  deviceTaken: boolean;
}): boolean {
  return !flags.phoneTaken && !flags.deviceTaken;
}

export function signInUsernameMatches(typed: string, saved: string): boolean {
  const left = normalizeUsername(typed);
  const right = normalizeUsername(saved);
  return Boolean(right) && left === right;
}

export function signInUsernameAllowed(typed: string, saved: string): boolean {
  if (!isValidUsername(typed)) return false;
  if (!normalizeUsername(saved)) return true;
  return signInUsernameMatches(typed, saved);
}

/** Si no hay dueño, este aparato puede reclamar. Si hay dueño, solo el mismo hash. */
export function sessionOwnedHere(claimedDeviceHash: string, localDeviceHash: string): boolean {
  const claimed = String(claimedDeviceHash || '').toLowerCase();
  const local = String(localDeviceHash || '').toLowerCase();
  if (!claimed || /^0x0+$/i.test(claimed)) return true;
  return Boolean(local) && claimed === local;
}

export function canSubmitReinstall(phrase: string, password: string, username: string): boolean {
  return canSubmitRestorePhrase(phrase) && canSubmitDeviceCredentials(password, username);
}

export function canSubmitRestorePhrase(phrase: string): boolean {
  const words = String(phrase || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return words.length === 12 || words.length === 24;
}

export type WalletFailEscape = 'unlock' | 'restore' | 'create';
export type WalletReadKind = 'empty' | 'unknown' | 'present';

/** Reintentar solo no basta: si el sobre no abre hay que pedir clave o las 24 palabras. */
export function walletFailEscapes(
  passwordSet: boolean,
  detail?: { walletRead?: WalletReadKind; bound?: string }
): WalletFailEscape[] {
  if (!passwordSet) return ['restore'];
  const bound = String(detail?.bound || '')
    .trim()
    .toLowerCase();
  if (detail?.walletRead === 'empty' && !bound) return ['unlock', 'restore', 'create'];
  return ['unlock', 'restore'];
}

/** El alta que no se pudo deshacer no se da por buena. */
export function signupErrorShown(code: string): 'undo' | 'keychain' | 'persist' | 'other' {
  if (code === 'undo-failed') return 'undo';
  if (code === 'keychain-timeout' || code === 'store-unknown') return 'keychain';
  if (code === 'wallet-persist' || code === 'password-persist') return 'persist';
  return 'other';
}

export function signupFailureStage(): 'credentials' {
  return 'credentials';
}

export type FreshAccountChoice = {
  walletRead: WalletReadKind;
  bound: string;
  offers: WalletFailEscape[];
  message: 'keychain' | 'sealed' | 'missing';
};

/** La foto del cofre sale de la lectura, no de que ensureAppWallet haya fallado. */
export async function resolveFreshAccount(input: {
  passwordSet: boolean;
  readWallet: () => Promise<string | null>;
  readBound: () => Promise<string>;
}): Promise<FreshAccountChoice> {
  let walletRead: WalletReadKind = 'unknown';
  try {
    const raw = await input.readWallet();
    walletRead = raw == null ? 'empty' : 'present';
  } catch {
    walletRead = 'unknown';
  }
  let bound = '';
  try {
    bound = String((await input.readBound()) || '');
  } catch {
    bound = 'desconocido';
  }
  if (bound.trim().toLowerCase() === 'desconocido') {
    walletRead = 'unknown';
    bound = '';
  }
  const offers = walletFailEscapes(input.passwordSet, { walletRead, bound });
  const message =
    walletRead === 'unknown' ? 'keychain' : walletRead === 'present' ? 'sealed' : 'missing';
  return { walletRead, bound, offers, message };
}

/** Mismo cierre que el alta: padrino una vez, y el usuario solo si aún no hay uno. */
export async function finishFreshAccount(input: {
  address: string;
  username: string;
  invite: string;
}): Promise<void> {
  const { lockSponsorOnce } = await import('../services/sponsorLock');
  const { isValidUsername, normalizeUsername } = await import('./usernamePolicy');
  const { loadClaimedUsername, saveClaimedUsername } = await import('../services/accountUsername');
  const invite = String(input.invite || '').trim();
  await lockSponsorOnce(input.address, invite, invite.length > 0);
  if (await loadClaimedUsername()) return;
  if (!isValidUsername(normalizeUsername(input.username))) return;
  await saveClaimedUsername(input.username);
}

/** Tras desbloquear, no entrar a la app si el cofre sigue cerrado o faltan las 24 palabras. */
export function afterUnlockNext(input: {
  walletOpened: boolean;
  phraseAcked: boolean;
  hasPhrase: boolean;
}): 'restore' | 'phraseReveal' | 'app' {
  if (!input.walletOpened) return 'restore';
  if (!input.phraseAcked && input.hasPhrase) return 'phraseReveal';
  return 'app';
}

if (__DEV__) {
  const host = globalThis as { __qcDev?: Record<string, Record<string, unknown>> };
  (host.__qcDev ??= {}).entry = { restoreMatchesDevice };
}
