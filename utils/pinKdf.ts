import { hkdf } from '@noble/hashes/hkdf';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';

/**
 * PBKDF2-HMAC-SHA256 de un solo bloque de 32 bytes.
 * 9000 vueltas: sjcl en un Android API 27 midió 5431,5 ms para 10001 vueltas
 * (Joplin, discourse.joplinapp.org/t/38622), así que 9000 quedan en unos 4,9 s.
 * 100000 vueltas en ese mismo JavaScript serían unos 54 s, no 2 a 5.
 * El registro guarda las vueltas para poder subirlas después.
 *
 * Un registro viejo de 600000 vueltas baja a 9000 al abrir. Esas 600000 se
 * pensaron para un KDF nativo: en este JavaScript (Hermes) serían cerca de un
 * minuto por bloque. El PIN de 6 dígitos no queda solo: la misma pasada mezcla
 * un secreto de 32 bytes que vive en el llavero del teléfono.
 */

export const PIN_PBKDF2_ROUNDS = 9_000;
export const PIN_KDF = 'pbkdf2-sha256';
/** 2 = un bloque y HKDF. 1 = el formato viejo de 64 bytes. */
export const PIN_SPLIT = 2;
export const PIN_SPLIT_WIDE = 1;
/** 1 = el verificador se calculó con el secreto del teléfono. */
export const PIN_DEVICE = 1;

/** El secreto no se guarda junto al verificador. Entra en la contraseña del KDF. */
export function boundPin(pin: string, deviceHex: string): string {
  return `${pin}:${deviceHex}`;
}

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
let kdfBlocks = 0;

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

export function takeKdfBlocks(): number {
  const seen = kdfBlocks;
  kdfBlocks = 0;
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

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  if (clean.length % 2 !== 0) throw new Error('pbkdf2-missing');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) throw new Error('pbkdf2-missing');
    out[i] = byte;
  }
  return out;
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
  kdfBlocks += Math.ceil(dkLen / 32);
  return toHex(bytes);
}

export type PinMaterial = { verifier: string; wrap: string };

const INFO_VERIFIER = 'quatrivium-pin-verifier';
const INFO_WRAP = 'quatrivium-pin-wrap';

function splitWithHkdf(ikmHex: string, salt: string): PinMaterial {
  const ikm = fromHex(ikmHex);
  let verifier: Uint8Array;
  let wrap: Uint8Array;
  try {
    verifier = hkdf(sha256, ikm, utf8(salt), utf8(INFO_VERIFIER), 32);
    wrap = hkdf(sha256, ikm, utf8(salt), utf8(INFO_WRAP), 32);
  } catch {
    throw new Error('pbkdf2-missing');
  }
  if (verifier.length !== 32 || wrap.length !== 32) throw new Error('pbkdf2-missing');
  return { verifier: toHex(verifier), wrap: `0x${toHex(wrap)}` };
}

/** Una pasada de 32 bytes. HKDF separa el verificador y la llave. */
export async function derivePinMaterial(
  secret: string,
  salt: string,
  rounds = PIN_PBKDF2_ROUNDS
): Promise<PinMaterial> {
  const hex = await pbkdf2Sha256Hex(secret, salt, rounds, 256);
  if (hex.length !== 64) throw new Error('pbkdf2-missing');
  const material = splitWithHkdf(hex, salt);
  if (material.verifier === material.wrap.slice(2)) throw new Error('pbkdf2-missing');
  return material;
}

/** Formato viejo: 64 bytes. El verificador es el primer bloque y la llave el segundo. */
export async function deriveWidePinMaterial(
  secret: string,
  salt: string,
  rounds: number
): Promise<PinMaterial> {
  const hex = await pbkdf2Sha256Hex(secret, salt, rounds, 512);
  if (hex.length !== 128) throw new Error('pbkdf2-missing');
  return { verifier: hex.slice(0, 64), wrap: `0x${hex.slice(64)}` };
}

export function needsPinUpgrade(
  record: { kdf?: string; rounds?: number; split?: number; device?: number } | null
): boolean {
  if (!record) return false;
  // 600000 no se queda: en JS puro no cabe en unos segundos, y el secreto del
  // teléfono ya iguala el costo de quien prueba el PIN con el de quien lo pone.
  return (
    record.kdf !== PIN_KDF ||
    Number(record.rounds || 0) !== PIN_PBKDF2_ROUNDS ||
    record.split !== PIN_SPLIT ||
    record.device !== PIN_DEVICE
  );
}

export type WrapStoreMode = 'hardware' | 'software';

/** Con hardware seguro, la clave pide autenticación. Si no hay, se queda el almacén actual. */
export function wrapStoreMode(hardwareSecure: boolean): WrapStoreMode {
  return hardwareSecure ? 'hardware' : 'software';
}
