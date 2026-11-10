import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';

/** PBKDF2-HMAC-SHA256. La app usa 600000 rondas y no baja a una derivación débil. */

export const PIN_PBKDF2_ROUNDS = 600_000;
export const PIN_KDF = 'pbkdf2-sha256';
export const PIN_SPLIT = 1;

type DeriveFn = (
  secret: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number
) => Promise<Uint8Array>;

const nobleDerive: DeriveFn = (secret, salt, iterations, dkLen) =>
  pbkdf2Async(sha256, secret, salt, { c: iterations, dkLen, asyncTick: 10_000 });

let derive: DeriveFn | null = nobleDerive;

let kdfCalls = 0;

/** Solo pruebas: null simula un teléfono sin PBKDF2. */
export function setPbkdf2ForTests(next: DeriveFn | null): void {
  derive = next;
}

export function resetPbkdf2ForTests(): void {
  derive = nobleDerive;
}

export function takeKdfCalls(): number {
  const seen = kdfCalls;
  kdfCalls = 0;
  return seen;
}

function utf8(text: string): Uint8Array {
  if (typeof TextEncoder === 'undefined') throw new Error('pbkdf2-missing');
  return new TextEncoder().encode(text);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function pbkdf2Sha256Hex(
  secret: string,
  salt: string,
  rounds: number,
  bits = 256
): Promise<string> {
  const iterations = Math.max(1, Math.floor(rounds));
  const dkLen = Math.max(1, Math.floor(bits / 8));
  if (!derive) throw new Error('pbkdf2-missing');
  let bytes: Uint8Array;
  try {
    bytes = await derive(utf8(secret), utf8(salt), iterations, dkLen);
  } catch (error) {
    if (error instanceof Error && error.message === 'pbkdf2-missing') throw error;
    throw new Error('pbkdf2-missing');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== dkLen) throw new Error('pbkdf2-missing');
  kdfCalls += 1;
  return toHex(bytes);
}

export type PinMaterial = { verifier: string; wrap: string };

/** Una sola pasada de 600000. Los primeros 32 bytes verifican; los otros 32 abren. */
export async function derivePinMaterial(
  secret: string,
  salt: string,
  rounds = PIN_PBKDF2_ROUNDS
): Promise<PinMaterial> {
  const hex = await pbkdf2Sha256Hex(secret, salt, rounds, 512);
  if (hex.length !== 128) throw new Error('pbkdf2-missing');
  return { verifier: hex.slice(0, 64), wrap: `0x${hex.slice(64)}` };
}

export function needsPinUpgrade(
  record: { kdf?: string; rounds?: number; split?: number } | null
): boolean {
  if (!record) return false;
  return (
    record.kdf !== PIN_KDF ||
    Number(record.rounds || 0) < PIN_PBKDF2_ROUNDS ||
    record.split !== PIN_SPLIT
  );
}

export type WrapStoreMode = 'hardware' | 'software';

/** Con hardware seguro, la clave pide autenticación. Si no hay, se queda el almacén actual. */
export function wrapStoreMode(hardwareSecure: boolean): WrapStoreMode {
  return hardwareSecure ? 'hardware' : 'software';
}
