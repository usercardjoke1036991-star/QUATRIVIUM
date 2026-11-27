import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAddress, isAddress } from 'ethers';
import { publicJsonRpc, type RpcCall } from '../utils/broadcastRpc';
import { NETWORK_CONFIG, publicRpcList } from '../constants/rpcConfig';
import { storeSlot } from '../utils/storeSlot';
/**
 * Vínculo de la billetera de retiro por transferencia de prueba.
 * El usuario envía un monto único de LUSD desde su billetera externa a la de la app.
 * La app lo busca en cadena con sus RPC públicos y exige que dos de ellos lo confirmen.
 */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Tiempo de cadena para enviar la prueba, desde el bloque de inicio. */
export const LINK_TTL_SECONDS = 3600;
/** Bloques encima del de la transferencia antes de aceptarla (Arbitrum: unos 5 s). */
export const LINK_CONFIRMATIONS = 20;
/** Tope de bloques a revisar: 1 h de Arbitrum son unos 14 400; el tope deja margen. */
export const LINK_MAX_SCAN_BLOCKS = 40_000;
/** Bloques por eth_getLogs. Si el RPC lo rechaza, se parte a la mitad hasta 250. */
export const LINK_LOG_CHUNK = 5_000;
const LINK_LOG_CHUNK_MIN = 250;
const LINK_LOG_CALLS_MAX = 200;
/** Monto = 0,01 + n × 0,00000001 con n entre 1 y 999 999. */
export const LINK_AMOUNT_SLOTS = 999_999;
const USED_KEEP = 50;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
export type LinkChallenge = {
  v: 1;
  chainId: number;
  internal: string;
  external: string;
  token: string;
  decimals: number;
  amountWei: string;
  startBlock: number;
  startTime: number;
};
export type LinkProof = { external: string; txHash: string; chainId: number };
export type LinkCheck =
  | { status: 'linked'; proof: LinkProof }
  | { status: 'waiting' }
  | { status: 'unconfirmed' }
  | { status: 'expired' }
  | { status: 'offline' };
export type ExternalCheck =
  | { ok: true; address: string }
  | { ok: false; error: 'linkWalletAddressInvalid' | 'linkWalletAddressSelf' };
type RpcOptions = { urls?: readonly string[]; call?: RpcCall };
type RawLog = {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  blockHash?: string;
  transactionHash?: string;
  removed?: boolean;
};
type Candidate = { txHash: string; blockNumber: number };
function realAddress(value: string): boolean {
  return isAddress(value) && !/^0x0+$/i.test(value);
}
/** Formato, checksum si viene con mayúsculas mezcladas, y que no sea la billetera de la app. */
export function checkExternalAddress(internalWallet: string, input: string): ExternalCheck {
  const value = String(input || '').trim();
  if (!realAddress(value)) return { ok: false, error: 'linkWalletAddressInvalid' };
  if (isAddress(internalWallet) && getAddress(value) === getAddress(internalWallet)) {
    return { ok: false, error: 'linkWalletAddressSelf' };
  }
  return { ok: true, address: getAddress(value) };
}
export function linkTestAmountWei(decimals: number, slot: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 8) throw new Error('decimals');
  if (!Number.isInteger(slot) || slot < 1 || slot > LINK_AMOUNT_SLOTS) throw new Error('slot');
  const unit = 10n ** BigInt(decimals - 8);
  return (1_000_000n + BigInt(slot)) * unit;
}
/** n uniforme entre 1 y LINK_AMOUNT_SLOTS, con el generador seguro del sistema. */
export function randomLinkSlot(): number {
  const limit = Math.floor(0x1_0000_0000 / LINK_AMOUNT_SLOTS) * LINK_AMOUNT_SLOTS;
  const box = new Uint32Array(1);
  for (let i = 0; i < 64; i += 1) {
    globalThis.crypto.getRandomValues(box);
    if (box[0] < limit) return (box[0] % LINK_AMOUNT_SLOTS) + 1;
  }
  throw new Error('random');
}
function hex(value: number): string {
  return `0x${value.toString(16)}`;
}
function toNumber(value: unknown): number {
  const text = String(value ?? '');
  if (!/^0x[0-9a-fA-F]+$/.test(text)) throw new Error('rpc-number');
  const out = Number.parseInt(text, 16);
  if (!Number.isSafeInteger(out)) throw new Error('rpc-number');
  return out;
}
function topicFor(address: string): string {
  return `0x${'0'.repeat(24)}${getAddress(address).slice(2).toLowerCase()}`;
}
/** Mediana baja: un solo RPC que miente no fija el bloque de inicio. */
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
async function settle<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}
async function readHead(url: string, call: RpcCall): Promise<number | null> {
  return settle(async () => toNumber(await call(url, 'eth_blockNumber', [])));
}
async function readBlock(
  url: string,
  call: RpcCall,
  block: number
): Promise<{ hash: string; timestamp: number } | null> {
  return settle(async () => {
    const raw = (await call(url, 'eth_getBlockByNumber', [hex(block), false])) as {
      hash?: string;
      timestamp?: string;
      number?: string;
    } | null;
    if (!raw || toNumber(raw.number) !== block || !HASH.test(String(raw.hash || ''))) {
      throw new Error('block');
    }
    return { hash: String(raw.hash).toLowerCase(), timestamp: toNumber(raw.timestamp) };
  });
}
/** El log tiene que ser exactamente el Transfer pedido: token, remitente, destino y monto. */
export function matchesLinkLog(challenge: LinkChallenge, log: RawLog): boolean {
  try {
    if (log.removed === true) return false;
    if (String(log.address || '').toLowerCase() !== challenge.token.toLowerCase()) return false;
    const topics = (log.topics || []).map((topic) => String(topic).toLowerCase());
    if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC) return false;
    if (topics[1] !== topicFor(challenge.external)) return false;
    if (topics[2] !== topicFor(challenge.internal)) return false;
    if (!WORD.test(String(log.data || ''))) return false;
    if (BigInt(String(log.data)) !== BigInt(challenge.amountWei)) return false;
    if (toNumber(log.blockNumber) < challenge.startBlock) return false;
    return HASH.test(String(log.transactionHash || ''));
  } catch {
    return false;
  }
}
/** eth_getLogs por tramos. Devuelve null si este RPC no puede cubrir el rango. */
async function scanLogs(
  url: string,
  call: RpcCall,
  challenge: LinkChallenge,
  from: number,
  to: number
): Promise<RawLog[] | null> {
  const topics = [TRANSFER_TOPIC, topicFor(challenge.external), topicFor(challenge.internal)];
  const out: RawLog[] = [];
  let chunk = LINK_LOG_CHUNK;
  let cursor = from;
  for (let calls = 0; cursor <= to; calls += 1) {
    if (calls >= LINK_LOG_CALLS_MAX) return null;
    const end = Math.min(to, cursor + chunk - 1);
    try {
      const rows = await call(url, 'eth_getLogs', [
        { address: challenge.token, topics, fromBlock: hex(cursor), toBlock: hex(end) },
      ]);
      if (!Array.isArray(rows)) throw new Error('logs');
      out.push(...(rows as RawLog[]));
      cursor = end + 1;
    } catch {
      if (chunk <= LINK_LOG_CHUNK_MIN) return null;
      chunk = Math.max(LINK_LOG_CHUNK_MIN, Math.floor(chunk / 2));
    }
  }
  return out;
}
type Sighting = { blockHash: string; inTime: boolean };
/** Un RPC confirma el candidato con su propio recibo y su propio bloque. */
async function sightCandidate(
  url: string,
  head: number,
  call: RpcCall,
  challenge: LinkChallenge,
  candidate: Candidate
): Promise<Sighting | null> {
  return settle(async () => {
    const receipt = (await call(url, 'eth_getTransactionReceipt', [candidate.txHash])) as {
      status?: string;
      blockNumber?: string;
      blockHash?: string;
      transactionHash?: string;
      logs?: RawLog[];
    } | null;
    if (!receipt || String(receipt.status) !== '0x1') throw new Error('receipt');
    if (String(receipt.transactionHash || '').toLowerCase() !== candidate.txHash) {
      throw new Error('receipt');
    }
    const blockNumber = toNumber(receipt.blockNumber);
    if (blockNumber !== candidate.blockNumber) throw new Error('receipt');
    if (head - blockNumber < LINK_CONFIRMATIONS) throw new Error('young');
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    if (!logs.some((log) => matchesLinkLog(challenge, log))) throw new Error('receipt');
    const block = await readBlock(url, call, blockNumber);
    const blockHash = String(receipt.blockHash || '').toLowerCase();
    if (!block || block.hash !== blockHash) throw new Error('block');
    const inTime =
      block.timestamp >= challenge.startTime &&
      block.timestamp <= challenge.startTime + LINK_TTL_SECONDS;
    return { blockHash, inTime };
  });
}
export async function createLinkChallenge(input: {
  internal: string;
  external: string;
  token: string;
  decimals: number;
  used?: readonly string[];
  chainId?: number;
  slot?: () => number;
  rpc?: RpcOptions;
}): Promise<LinkChallenge> {
  const urls = input.rpc?.urls ?? publicRpcList();
  const call = input.rpc?.call ?? publicJsonRpc;
  const check = checkExternalAddress(input.internal, input.external);
  if (!check.ok || !realAddress(input.internal) || !realAddress(input.token)) {
    throw new Error('wallet');
  }
  const heads = (await Promise.all(urls.map((url) => readHead(url, call)))).filter(
    (head): head is number => head !== null
  );
  if (!heads.length) throw new Error('offline');
  const startBlock = lowerMedian(heads);
  let startTime = 0;
  for (const url of urls) {
    const block = await readBlock(url, call, startBlock);
    if (block) {
      startTime = block.timestamp;
      break;
    }
  }
  if (!startTime) throw new Error('offline');
  const used = new Set((input.used || []).map(String));
  const pick = input.slot ?? randomLinkSlot;
  let amount = '';
  for (let i = 0; i < 32 && !amount; i += 1) {
    const next = linkTestAmountWei(input.decimals, pick()).toString();
    if (!used.has(next)) amount = next;
  }
  if (!amount) throw new Error('random');
  return {
    v: 1,
    chainId: input.chainId ?? NETWORK_CONFIG.chainId,
    internal: getAddress(input.internal),
    external: check.address,
    token: getAddress(input.token),
    decimals: input.decimals,
    amountWei: amount,
    startBlock,
    startTime,
  };
}
/**
 * Busca la prueba. Solo da «linked» si dos RPC distintos devuelven el mismo recibo
 * (estado 1, mismo bloque, mismo log exacto), con LINK_CONFIRMATIONS encima y dentro del plazo.
 * Un RPC que inventa logs no basta; uno que oculta logs no impide que otros dos la vean.
 */
export async function checkLinkChallenge(
  challenge: LinkChallenge,
  rpc: RpcOptions = {}
): Promise<LinkCheck> {
  const urls = rpc.urls ?? publicRpcList();
  const call = rpc.call ?? publicJsonRpc;
  const views = (
    await Promise.all(
      urls.map(async (url) => {
        const head = await readHead(url, call);
        return head === null ? null : { url, head };
      })
    )
  ).filter((view): view is { url: string; head: number } => view !== null);
  if (!views.length) return { status: 'offline' };
  const candidates = new Map<string, Candidate>();
  let closedVotes = 0;
  await Promise.all(
    views.map(async ({ url, head }) => {
      const cap = challenge.startBlock + LINK_MAX_SCAN_BLOCKS;
      const end = Math.min(head - LINK_CONFIRMATIONS, cap);
      if (end < challenge.startBlock) return;
      const logs = await scanLogs(url, call, challenge, challenge.startBlock, end);
      if (!logs) return;
      for (const log of logs) {
        if (!matchesLinkLog(challenge, log)) continue;
        const txHash = String(log.transactionHash).toLowerCase();
        candidates.set(txHash, { txHash, blockNumber: toNumber(log.blockNumber) });
      }
      if (end === cap) {
        closedVotes += 1;
        return;
      }
      const last = await readBlock(url, call, end);
      if (last && last.timestamp > challenge.startTime + LINK_TTL_SECONDS) closedVotes += 1;
    })
  );
  let pending = false;
  for (const candidate of candidates.values()) {
    const sightings = (
      await Promise.all(
        views.map(({ url, head }) => sightCandidate(url, head, call, challenge, candidate))
      )
    ).filter((row): row is Sighting => row !== null && row.inTime);
    const byBlock = new Map<string, number>();
    for (const row of sightings) byBlock.set(row.blockHash, (byBlock.get(row.blockHash) || 0) + 1);
    if ([...byBlock.values()].some((count) => count >= 2)) {
      return {
        status: 'linked',
        proof: {
          external: challenge.external,
          txHash: candidate.txHash,
          chainId: challenge.chainId,
        },
      };
    }
    if (sightings.length) pending = true;
  }
  // Plazo cerrado y nada válido a tiempo: una transferencia tardía o solo vista por un RPC no cuenta.
  if (closedVotes >= Math.min(2, views.length) && !pending) return { status: 'expired' };
  return { status: candidates.size ? 'unconfirmed' : 'waiting' };
}
const CHALLENGE_PREFIX = `${storeSlot(['quatrivium', 'linkChallenge', 'v1'])}:`;
export function linkChallengeKey(internalWallet: string, chainId = NETWORK_CONFIG.chainId): string {
  return `${CHALLENGE_PREFIX}${chainId}:${String(internalWallet || '')
    .trim()
    .toLowerCase()}`;
}
type StoredChallenge = { challenge: LinkChallenge | null; used: string[] };
function validChallenge(value: unknown, internalWallet: string): value is LinkChallenge {
  const row = value as LinkChallenge;
  return Boolean(
    row &&
      row.v === 1 &&
      row.chainId === NETWORK_CONFIG.chainId &&
      realAddress(row.internal) &&
      row.internal.toLowerCase() === String(internalWallet || '').toLowerCase() &&
      realAddress(row.external) &&
      realAddress(row.token) &&
      Number.isInteger(row.decimals) &&
      /^[1-9][0-9]*$/.test(String(row.amountWei)) &&
      Number.isSafeInteger(row.startBlock) &&
      row.startBlock >= 0 &&
      Number.isSafeInteger(row.startTime) &&
      row.startTime > 0
  );
}
async function readStored(internalWallet: string): Promise<StoredChallenge> {
  try {
    const raw = await AsyncStorage.getItem(linkChallengeKey(internalWallet));
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredChallenge>) : {};
    const used = Array.isArray(parsed.used) ? parsed.used.map(String).slice(-USED_KEEP) : [];
    const challenge = validChallenge(parsed.challenge, internalWallet) ? parsed.challenge : null;
    return { challenge, used };
  } catch {
    return { challenge: null, used: [] };
  }
}
/** El desafío sobrevive a cerrar la app. Un dato roto o de otra red se ignora. */
export async function loadLinkChallenge(internalWallet: string): Promise<LinkChallenge | null> {
  return (await readStored(internalWallet)).challenge;
}
export async function usedLinkAmounts(internalWallet: string): Promise<string[]> {
  return (await readStored(internalWallet)).used;
}
/** Guarda el desafío y anota su monto para no repetirlo. */
export async function saveLinkChallenge(challenge: LinkChallenge): Promise<void> {
  const { used } = await readStored(challenge.internal);
  const next = [...used.filter((amount) => amount !== challenge.amountWei), challenge.amountWei];
  await AsyncStorage.setItem(
    linkChallengeKey(challenge.internal),
    JSON.stringify({ challenge, used: next.slice(-USED_KEEP) })
  );
}
/** Borra el desafío; los montos usados se quedan para no repetirlos. */
export async function clearLinkChallenge(internalWallet: string): Promise<void> {
  const { used } = await readStored(internalWallet);
  await AsyncStorage.setItem(
    linkChallengeKey(internalWallet),
    JSON.stringify({ challenge: null, used })
  );
}
