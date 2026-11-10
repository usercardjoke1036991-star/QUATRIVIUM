/** PBKDF2-HMAC-SHA256. La app usa al menos 600000 rondas. */

export const PIN_PBKDF2_ROUNDS = 600_000;
export const PIN_KDF = 'pbkdf2-sha256';

export async function pbkdf2Sha256Hex(
  secret: string,
  salt: string,
  rounds: number
): Promise<string> {
  const iterations = Math.max(1, Math.floor(rounds));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('pbkdf2-missing');
  const enc = new TextEncoder();
  const key = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function needsPinUpgrade(record: { kdf?: string; rounds?: number } | null): boolean {
  if (!record) return false;
  return record.kdf !== PIN_KDF || Number(record.rounds || 0) < PIN_PBKDF2_ROUNDS;
}

export type WrapStoreMode = 'hardware' | 'software';

/** Con hardware seguro, la clave pide autenticación. Si no hay, se queda el almacén actual. */
export function wrapStoreMode(hardwareSecure: boolean): WrapStoreMode {
  return hardwareSecure ? 'hardware' : 'software';
}
