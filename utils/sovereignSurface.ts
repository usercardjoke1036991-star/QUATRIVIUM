/** Reglas visibles de la app soberana. No despliega contratos ni guarda claves de RPC. */

export const ALTA_LUSD = 4;
export const ALTA_FOUNDER_LUSD = 1;
export const ALTA_POOL_LUSD = 3;
export const FOUNDER_INTEREST_BP = 1500;
export const INSURANCE_INFLOW_BP = 500;
export const LIQUIDATION_GRACE_HOURS = 48;
export const RESERVA_LOCK_DAYS = 30;
export const RESERVA_MIN_LEVEL = 10;
export const RESERVA_MAX_APY_BP = 1200;
export const ADMIN_TIMELOCK_HOURS = 72;
export const ADMIN_SEATS = 3;

export function altaBreakdown(): { total: number; founder: number; pool: number } {
  return { total: ALTA_LUSD, founder: ALTA_FOUNDER_LUSD, pool: ALTA_POOL_LUSD };
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

export function apkIntegrity(
  localHash: string,
  publishedHash: string
): 'unpublished' | 'match' | 'mismatch' {
  const status = apkCheck({ localHash, publishedHash });
  return status === 'unverified' ? 'unpublished' : status;
}

/** La mora no sale de la cadena. Nostr solo admite avisos y mensajes cifrados. */
export function nostrMayPublish(topic: string): boolean {
  const key = topic.trim().toLowerCase();
  if (key === 'mora' || key === 'moroso' || key === 'delinquency') return false;
  return key === 'notice' || key === 'message';
}

export function prepareNostrPayload(
  topic: string,
  body: string
): { nip: 'NIP-17' | 'NIP-44'; body: string } | null {
  if (!nostrMayPublish(topic)) return null;
  const text = body.trim();
  if (!text) return null;
  return { nip: topic.trim().toLowerCase() === 'message' ? 'NIP-17' : 'NIP-44', body: text };
}

function normalizeSha256(value: string): string {
  const hex = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(hex) ? hex : '';
}
