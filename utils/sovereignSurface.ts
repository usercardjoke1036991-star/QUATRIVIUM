/** Reglas visibles de la app soberana. No despliega contratos ni guarda claves de RPC. */

export const ALTA_LUSD = 4;
export const ALTA_FOUNDER_LUSD = 1;
export const ALTA_RESERVA_LUSD = 1;
export const ALTA_PADRINO_LUSD = 1;
export const ALTA_SEAL_LUSD = 1;
export const FOUNDER_INTEREST_BP = 1500;
export const INSURANCE_INFLOW_BP = 500;
export const LIQUIDATION_GRACE_HOURS = 48;
export const RESERVA_LOCK_DAYS = 30;
export const RESERVA_MIN_LEVEL = 10;
export const RESERVA_MAX_APY_BP = 1200;
export const ADMIN_TIMELOCK_HOURS = 72;
export const ADMIN_SEATS = 3;

/** Lo que hace pagarRegistro: cuatro destinos de 1 LUSD. El sello pasa por Credit y deja el 5 % en el seguro. */
export function altaBreakdown(): {
  total: number;
  founder: number;
  reserva: number;
  padrino: number;
  seal: number;
} {
  return {
    total: ALTA_LUSD,
    founder: ALTA_FOUNDER_LUSD,
    reserva: ALTA_RESERVA_LUSD,
    padrino: ALTA_PADRINO_LUSD,
    seal: ALTA_SEAL_LUSD,
  };
}

export function interestToFounder(interest: number): number {
  if (!Number.isFinite(interest) || interest <= 0) return 0;
  return (interest * FOUNDER_INTEREST_BP) / 10000;
}

export function insuranceOfInflow(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return (amount * INSURANCE_INFLOW_BP) / 10000;
}

/** El siguiente RPC público. Si el último también falla, no inventa otro. */
export function nextPublicRpc(urls: readonly string[], failed: string): string | null {
  const list = urls.map((url) => url.trim()).filter((url) => url.startsWith('https://'));
  if (list.length === 0) return null;
  const index = list.indexOf(failed.trim());
  if (index < 0) return list[0];
  return list[index + 1] ?? null;
}

/** Relés públicos. Nadie los configura; una lista avanzada solo sustituye esta si trae cinco o más. */
export const PUBLIC_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://offchain.pub',
] as const;

export function nostrRelays(advanced?: readonly string[]): string[] {
  const extra = (advanced || []).map((url) => url.trim()).filter((url) => url.startsWith('wss://'));
  return extra.length >= 5 ? [...extra] : [...PUBLIC_NOSTR_RELAYS];
}

/** Si un relé falla, el siguiente. El último no inventa otro. */
export function nextNostrRelay(failed: string, advanced?: readonly string[]): string | null {
  const list = nostrRelays(advanced);
  if (list.length === 0) return null;
  const index = list.indexOf(failed.trim());
  if (index < 0) return list[0];
  return list[index + 1] ?? null;
}

export type ApkCheck = 'match' | 'mismatch' | 'unverified';

/** Registro vacío o sin respuesta: no verificada. Hash distinto: no coincide. */
export function apkCheck(input: {
  registryEmpty?: boolean;
  readFailed?: boolean;
  localHash?: string;
  publishedHash?: string;
}): ApkCheck {
  if (input.readFailed || input.registryEmpty) return 'unverified';
  const published = normalizeSha256(input.publishedHash || '');
  if (!published) return 'unverified';
  const local = normalizeSha256(input.localHash || '');
  if (!local || local !== published) return 'mismatch';
  return 'match';
}

/** Huella del certificado de firma: vacío o sin lectura = no verificada. */
/** Sin dirección de registro: no verificada. Con huellas, coincide o no. */
export function apkRegistryStatus(input: {
  registryAddress?: string;
  publishedCert?: string;
  localCert?: string;
  readFailed?: boolean;
}): ApkCheck {
  const address = String(input.registryAddress || '')
    .trim()
    .toLowerCase();
  if (!address || address === '0x0000000000000000000000000000000000000000') return 'unverified';
  return apkCertCheck({
    registryEmpty: !normalizeSha256(input.publishedCert || ''),
    readFailed: input.readFailed,
    localCert: input.localCert,
    publishedCert: input.publishedCert,
  });
}

export function apkCertCheck(input: {
  registryEmpty?: boolean;
  readFailed?: boolean;
  localCert?: string;
  publishedCert?: string;
}): ApkCheck {
  return apkCheck({
    registryEmpty: input.registryEmpty,
    readFailed: input.readFailed,
    localHash: input.localCert,
    publishedHash: input.publishedCert,
  });
}

export function apkIntegrity(
  localHash: string,
  publishedHash: string
): 'unpublished' | 'match' | 'mismatch' {
  const status = apkCheck({ localHash, publishedHash });
  return status === 'unverified' ? 'unpublished' : status;
}

/** Mensaje privado apagado: aún no hay cifrado NIP-17 ni NIP-44. La mora tampoco sale. */
export function nostrPrivateReady(): boolean {
  return false;
}

export function nostrMayPublish(topic: string): boolean {
  if (!nostrPrivateReady()) return false;
  const key = topic.trim().toLowerCase();
  return key !== 'mora' && key !== 'moroso' && key !== 'delinquency';
}

export function prepareNostrPayload(_topic: string, _body: string): null {
  return null;
}

function normalizeSha256(value: string): string {
  const hex = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(hex) ? hex : '';
}
