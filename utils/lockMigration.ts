import {
  PIN_KDF,
  PIN_PBKDF2_ROUNDS,
  PIN_SPLIT,
  derivePinMaterial,
  pbkdf2Sha256Hex,
} from './pinKdf';
import {
  deriveWrapKeyAsync,
  isSealedBlob,
  openSecret,
  sealSecret,
  timingSafeEqualHex,
} from './secretBox';

export type LockStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
};

export type PinLike = {
  v?: number;
  salt: string;
  hash: string;
  rounds?: number;
  kdf?: string;
  split?: number;
};

export function isSplitKdf(record: { kdf?: string; split?: number }): boolean {
  return record.kdf === PIN_KDF && record.split === PIN_SPLIT;
}

export function isWideKdf(record: { kdf?: string; split?: number }): boolean {
  return record.kdf === PIN_KDF && record.split === 1;
}

/** La vuelta única era el registro que no era v:2. Solo sirve para abrir el sello viejo. */
export function legacyPinWrapRounds(record: { v?: number; rounds?: number }): number {
  if (record.v !== 2) return 1;
  const n = Math.floor(Number(record.rounds) || 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function assertSessionBeforePinWrite(passwordSet: boolean, wrap: string | null): void {
  if (passwordSet && !wrap) throw new Error('locked');
}

/** El formato sin HKDF guardaba sus propias vueltas. No usa la cifra nueva. */
export async function wrapKeyFromPbkdf2(
  secret: string,
  salt: string,
  rounds = 600_000
): Promise<string> {
  const hex = await pbkdf2Sha256Hex(secret, `${salt}:wrap`, rounds);
  return `0x${hex}`;
}

export async function pinVerifier(pin: string, record: PinLike): Promise<string> {
  if (record.kdf !== PIN_KDF) return '';
  const rounds = record.rounds || (isSplitKdf(record) ? PIN_PBKDF2_ROUNDS : 600_000);
  if (isSplitKdf(record)) {
    return (await derivePinMaterial(pin, record.salt, rounds)).verifier;
  }
  return pbkdf2Sha256Hex(pin, record.salt, rounds);
}

export function verifierMatches(actual: string, expected: string): boolean {
  return timingSafeEqualHex(
    actual.startsWith('0x') ? actual : `0x${actual}`,
    expected.startsWith('0x') ? expected : `0x${expected}`
  );
}

/**
 * Abre con una llave vieja, sella con la nueva y solo entonces reemplaza.
 * Si el reemplazo falla, el valor anterior sigue en su sitio.
 */
export async function migrateSealedValue(
  store: LockStore,
  liveKey: string,
  stagingKey: string,
  oldKeys: readonly string[],
  newKey: string
): Promise<string> {
  const raw = await store.get(liveKey);
  if (!raw || !isSealedBlob(raw)) throw new Error('locked');
  let plain = '';
  let opened = false;
  for (const key of oldKeys) {
    try {
      plain = openSecret(raw, key);
      opened = true;
      break;
    } catch {
      opened = false;
    }
  }
  if (!opened) throw new Error('locked');
  const staged = sealSecret(plain, newKey);
  if (openSecret(staged, newKey) !== plain) throw new Error('migrate-verify');
  await store.set(stagingKey, staged);
  const back = await store.get(stagingKey);
  if (!back || openSecret(back, newKey) !== plain) throw new Error('migrate-verify');
  await store.set(liveKey, staged);
  await store.del(stagingKey);
  return plain;
}

export async function legacyPasswordWrap(
  password: string,
  salt: string,
  rounds: number
): Promise<string> {
  return deriveWrapKeyAsync(password, salt, rounds);
}
