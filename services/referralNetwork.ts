import { Contract, formatUnits, getAddress, type AbstractProvider } from 'ethers';
import { CONTRACT_ABI, getContractAddress } from '../constants/contractConfig';
import { DEPLOYED_TESTNET, getKnownStartBlock } from '../constants/deployedAddresses';
import {
  assertTrustedRpc,
  getProviderWithFallback,
  isContractConfigured,
  NETWORK_CONFIG,
} from '../constants/rpcConfig';
import { getTokenMeta } from '../constants/tokens';
import { addressToInviteCode } from '../utils/inviteCode';
import { creditDirectWei, sumReferralEarnings } from '../utils/referralEarnings';

const ZERO = '0x0000000000000000000000000000000000000000';
const CHUNK = 4_000;
const RECENT_SPAN = 50_000;
const CHUNK_ATTEMPTS = 2;
const CHUNK_TIMEOUT_MS = 6_000;
const SCAN_BUDGET_MS = 18_000;
const DIRECT_SCAN_BUDGET_MS = 28_000;
const DEFAULT_LOOKBACK = 80_000;
const MAX_SCAN_SPAN = 120_000; // RPC públicos no aguantan el rango completo desde el deploy.
const FALLBACK_BLOCK_SECONDS = 0.45;
const YESTERDAY_FROM_S = 18 * 60 * 60;
const YESTERDAY_TO_S = 36 * 60 * 60;
const PRIORITY_FROM_S = 24 * 60 * 60;
const PRIORITY_TO_S = 30 * 60 * 60;
const WEEK_S = 7 * 24 * 60 * 60;
const DIRECT_CHUNK = 4_000;

export interface ReferralChild {
  address: string;
  code: string;
  level: number;
}

export interface ReferralNode {
  address: string;
  code: string;
  earnedWei: string;
  earnedLabel: string;
  bonusWei: string;
  bonusLabel: string;
  commissionWei: string;
  commissionLabel: string;
  level: number;
  registeredBlock: number;
  registeredAt: number;
  lastEarnBlock: number;
  lastEarnAt: number;
  children: ReferralChild[];
}

export interface ReferralActivity {
  id: string;
  type: 'signup' | 'commission' | 'bonus';
  titleKey: 'activitySignup' | 'activityCommission' | 'activityBonus';
  code: string;
  amountLabel?: string;
  generation?: number;
  timestamp: number;
}

export interface ReferralNetworkSnapshot {
  directs: ReferralNode[];
  totalEarnedWei: string;
  totalEarnedLabel: string;
  commissionTotalWei: string;
  commissionTotalLabel: string;
  bonusTotalWei: string;
  bonusTotalLabel: string;
  activity: ReferralActivity[];
  partial: boolean;
}

const EMPTY: ReferralNetworkSnapshot = {
  directs: [],
  totalEarnedWei: '0',
  totalEarnedLabel: '0.00 USDT',
  commissionTotalWei: '0',
  commissionTotalLabel: '0.00 USDT',
  bonusTotalWei: '0',
  bonusTotalLabel: '0.00 USDT',
  activity: [],
  partial: false,
};

function normalizeAddress(value: string): string {
  try {
    return getAddress(value);
  } catch {
    return '';
  }
}

function eventArgs(event: object): Record<string, unknown> {
  const args = 'args' in event ? (event as { args?: unknown }).args : undefined;
  if (!args || typeof args !== 'object') return {};
  return args as Record<string, unknown>;
}

function argValue(args: Record<string, unknown>, name: string, index: number): unknown {
  if (args[name] !== undefined) return args[name];
  return (args as unknown as unknown[])[index];
}

function asBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' && value !== '') return BigInt(value);
  return 0n;
}

function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function formatToken(amount: bigint, token?: string): string {
  const meta = token ? getTokenMeta(token) : undefined;
  const decimals = meta?.decimals ?? 18;
  const symbol = meta?.symbol ?? 'USDT';
  return `${Number(formatUnits(amount, decimals)).toFixed(4)} ${symbol}`;
}

function eventFilter(contract: Contract, name: string, ...params: unknown[]) {
  const factory = (contract.filters as Record<string, unknown>)[name];
  if (typeof factory !== 'function') return null;
  return (factory as (...args: unknown[]) => unknown)(...params);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type LogPack = {
  events: Awaited<ReturnType<Contract['queryFilter']>>;
  failed: number;
  cut: boolean;
};

async function queryFilterChunked(
  contract: Contract,
  filter: unknown,
  fromBlock: number,
  toBlock: number,
  deadline = 0
): Promise<LogPack> {
  if (!filter || fromBlock > toBlock) return { events: [], failed: 0, cut: false };
  const ranges: Array<[number, number]> = [];
  for (let end = toBlock; end >= fromBlock; end -= CHUNK) {
    ranges.push([Math.max(fromBlock, end - CHUNK + 1), end]);
  }

  const events: Awaited<ReturnType<Contract['queryFilter']>> = [];
  let failed = 0;
  let cut = false;
  for (let index = 0; index < ranges.length; index += 1) {
    if (deadline > 0 && Date.now() > deadline) {
      cut = true;
      break;
    }
    const [start, end] = ranges[index];
    let got = false;
    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
      if (deadline > 0 && Date.now() > deadline) {
        cut = true;
        break;
      }
      try {
        const page = await withTimeout(
          contract.queryFilter(filter as Parameters<Contract['queryFilter']>[0], start, end),
          CHUNK_TIMEOUT_MS
        );
        events.push(...page);
        got = true;
        break;
      } catch {
        if (attempt < CHUNK_ATTEMPTS - 1) await pause(200);
      }
    }
    if (cut) break;
    if (!got) failed += 1;
  }
  return { events, failed, cut };
}

function mergeLogPacks(packs: LogPack[]): LogPack {
  const seen = new Set<string>();
  const events: LogPack['events'] = [];
  let failed = 0;
  let cut = false;
  for (const pack of packs) {
    failed += pack.failed;
    cut = cut || pack.cut;
    for (const event of pack.events) {
      const id = `${event.transactionHash || ''}:${event.index ?? ''}:${event.blockNumber || 0}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push(event);
    }
  }
  return { events, failed, cut };
}

async function secondsPerBlock(provider: AbstractProvider, latest: number): Promise<number> {
  const behind = Math.max(0, latest - 3_000);
  if (behind >= latest) return FALLBACK_BLOCK_SECONDS;
  try {
    const [head, prev] = await Promise.all([
      withTimeout(provider.getBlock(latest), CHUNK_TIMEOUT_MS),
      withTimeout(provider.getBlock(behind), CHUNK_TIMEOUT_MS),
    ]);
    const elapsed = Number(head?.timestamp || 0) - Number(prev?.timestamp || 0);
    const span = latest - behind;
    if (elapsed > 0 && span > 0) return elapsed / span;
  } catch {
    // Si el ritmo no se lee, se usa el de la red rápida actual.
  }
  return FALLBACK_BLOCK_SECONDS;
}

function blocksAgo(latest: number, seconds: number, perBlock: number): number {
  const step = perBlock > 0 ? perBlock : FALLBACK_BLOCK_SECONDS;
  return Math.max(0, latest - Math.ceil(seconds / step));
}

function chunkRanges(fromBlock: number, toBlock: number, step = CHUNK): Array<[number, number]> {
  if (fromBlock > toBlock) return [];
  const size = step > 0 ? step : CHUNK;
  const ranges: Array<[number, number]> = [];
  for (let end = toBlock; end >= fromBlock; end -= size) {
    ranges.push([Math.max(fromBlock, end - size + 1), end]);
  }
  return ranges;
}

function logId(event: object): string {
  const row = event as { transactionHash?: string; index?: number; blockNumber?: number };
  return `${row.transactionHash || ''}:${row.index ?? ''}:${row.blockNumber || 0}`;
}

function eventName(event: object): string {
  if ('eventName' in event && (event as { eventName?: unknown }).eventName) {
    return String((event as { eventName?: unknown }).eventName);
  }
  const fragment =
    'fragment' in event ? (event as { fragment?: { name?: string } }).fragment : undefined;
  return fragment?.name ? String(fragment.name) : '';
}

/** El trozo que contiene el bloque pedido pasa delante. El resto conserva su orden. */
function focusFirst(ranges: Array<[number, number]>, focus: number): Array<[number, number]> {
  const index = ranges.findIndex(([start, end]) => focus >= start && focus <= end);
  if (index <= 0) return ranges;
  return [ranges[index], ...ranges.slice(0, index), ...ranges.slice(index + 1)];
}

/** Si el trozo se parte, la mitad que contiene el bloque pedido sale primero. */
function orderHalves(start: number, end: number, focus?: number): Array<[number, number]> {
  const mid = start + Math.floor((end - start + 1) / 2);
  const newer: [number, number] = [mid, end];
  const older: [number, number] = [start, mid - 1];
  if (focus !== undefined && focus >= start && focus < mid) return [older, newer];
  return [newer, older];
}

/** Un trozo ancho se parte al primer fallo. El tamaño que el nodo acepta se reintenta. */
async function readWindow(
  contract: Contract,
  filters: unknown[],
  start: number,
  end: number,
  deadline: number,
  focus?: number
): Promise<{
  events: LogPack['events'];
  failed: number;
  cut: boolean;
  split: Array<[number, number]>;
}> {
  const events: LogPack['events'] = [];
  const split: Array<[number, number]> = [];
  let failed = 0;
  let cut = false;
  const span = end - start + 1;
  const attempts = span > CHUNK ? 1 : CHUNK_ATTEMPTS;
  for (const filter of filters) {
    if (!filter) continue;
    if (Date.now() > deadline) {
      cut = true;
      break;
    }
    let got = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (Date.now() > deadline) {
        cut = true;
        break;
      }
      const left = deadline - Date.now();
      try {
        const page = await withTimeout(
          contract.queryFilter(filter as Parameters<Contract['queryFilter']>[0], start, end),
          Math.min(CHUNK_TIMEOUT_MS, left)
        );
        events.push(...page);
        got = true;
        break;
      } catch {
        if (attempt < attempts - 1) await pause(200);
      }
    }
    if (cut) break;
    if (!got) {
      if (span > CHUNK) {
        split.push(...orderHalves(start, end, focus));
        break;
      }
      failed += 1;
    }
  }
  return { events, failed, cut, split };
}

/** La franja de ayer va primero. El bloque de unas 25 horas es la primera petición. */
async function queryFilterRanges(
  contract: Contract,
  filters: unknown[],
  ranges: Array<[number, number]>,
  deadline: number,
  focus?: number
): Promise<LogPack> {
  const events: LogPack['events'] = [];
  const seen = new Set<string>();
  let failed = 0;
  let cut = false;
  const pending: Array<[number, number]> = ranges.filter(([start, end]) => start <= end);
  while (pending.length > 0) {
    if (Date.now() > deadline) {
      cut = true;
      break;
    }
    const next = pending.shift();
    if (!next) break;
    const [start, end] = next;
    const out = await readWindow(contract, filters, start, end, deadline, focus);
    failed += out.failed;
    if (out.cut) cut = true;
    for (const event of out.events) {
      const id = logId(event);
      if (seen.has(id)) continue;
      seen.add(id);
      events.push(event);
    }
    if (out.split.length > 0) pending.unshift(...out.split);
    if (cut) break;
  }
  return { events, failed, cut };
}

/** Los bloques de hoy van primero. Si el tramo viejo falla, el pago reciente se conserva. */
async function queryFilterReliable(
  contract: Contract,
  filter: unknown,
  fromBlock: number,
  toBlock: number,
  deadline = 0
): Promise<LogPack> {
  const recentFrom = Math.max(fromBlock, toBlock - RECENT_SPAN);
  const recent = await queryFilterChunked(contract, filter, recentFrom, toBlock, deadline);
  if (fromBlock >= recentFrom || (deadline > 0 && Date.now() > deadline)) return recent;
  const older = await queryFilterChunked(contract, filter, fromBlock, recentFrom - 1, deadline);
  return mergeLogPacks([recent, older]);
}

async function resolveStartBlock(
  provider: AbstractProvider,
  contractAddress: string
): Promise<{
  fromBlock: number;
  toBlock: number;
  partial: boolean;
}> {
  const latest = await withTimeout(provider.getBlockNumber(), CHUNK_TIMEOUT_MS);
  const configured = Number(process.env.EXPO_PUBLIC_CONTRACT_START_BLOCK || 0);
  const fromEnv = Number.isFinite(configured) && configured > 0 ? configured : 0;
  const fromKnown = getKnownStartBlock(contractAddress);
  const demoContract = contractAddress.toLowerCase() === DEPLOYED_TESTNET.contract.toLowerCase();
  const fromConfigured = fromKnown > 0 ? fromKnown : demoContract ? fromEnv : 0;
  const fromLookback = Math.max(0, latest - DEFAULT_LOOKBACK);
  let fromBlock = fromConfigured > 0 ? fromConfigured : fromLookback;
  let truncated = fromConfigured === 0 && fromLookback > 0;
  if (fromBlock > latest) {
    fromBlock = fromLookback;
    truncated = true;
  }
  if (latest - fromBlock > MAX_SCAN_SPAN) {
    fromBlock = Math.max(0, latest - MAX_SCAN_SPAN);
    truncated = true;
  }
  return {
    fromBlock,
    toBlock: latest,
    partial: truncated,
  };
}

async function resolveTimestamps(
  provider: AbstractProvider,
  blockNumbers: number[],
  deadline = 0
): Promise<Map<number, number>> {
  const unique = [...new Set(blockNumbers.filter((block) => Number.isFinite(block) && block > 0))];
  const stamps = new Map<number, number>();
  const CONCURRENCY = 6;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    if (deadline > 0 && Date.now() > deadline) break;
    const batch = unique.slice(i, i + CONCURRENCY);
    const blocks = await Promise.all(
      batch.map(async (blockNumber) => {
        try {
          const block = await withTimeout(provider.getBlock(blockNumber), CHUNK_TIMEOUT_MS);
          return [blockNumber, Number(block?.timestamp || 0)] as const;
        } catch {
          return [blockNumber, 0] as const;
        }
      })
    );
    for (const [blockNumber, timestamp] of blocks) stamps.set(blockNumber, timestamp);
  }
  return stamps;
}

async function readLevel(contract: Contract, address: string, deadline: number): Promise<number> {
  if (deadline > 0 && Date.now() > deadline) return 1;
  try {
    const progress = await withTimeout(contract.obtenerProgresoUsuario(address), CHUNK_TIMEOUT_MS);
    return Math.min(100, Math.max(1, Number(progress.nivelActual ?? progress[0] ?? 1) || 1));
  } catch {
    return 1;
  }
}

async function parentOf(
  contract: Contract,
  wallet: string,
  cache: Map<string, string>,
  deadline = 0
): Promise<string> {
  const key = wallet.toLowerCase();
  if (cache.has(key)) return cache.get(key) || '';
  if (deadline > 0 && Date.now() > deadline) return '';
  try {
    const node = await withTimeout(contract.redGenealogica(wallet), CHUNK_TIMEOUT_MS);
    const padre = normalizeAddress(String(node.padre ?? node[0] ?? ''));
    cache.set(key, padre);
    return padre;
  } catch {
    return '';
  }
}

async function nearestDirect(
  contract: Contract,
  source: string,
  self: string,
  directs: Set<string>,
  cache: Map<string, string>,
  deadline = 0
): Promise<string> {
  let cursor = normalizeAddress(source);
  const seen = new Set<string>();
  for (let i = 0; i < 8 && cursor && !seen.has(cursor.toLowerCase()); i += 1) {
    if (deadline > 0 && Date.now() > deadline) return '';
    if (directs.has(cursor.toLowerCase())) return cursor;
    seen.add(cursor.toLowerCase());
    const next = await parentOf(contract, cursor, cache, deadline);
    if (!next || next.toLowerCase() === self.toLowerCase() || next === ZERO) break;
    cursor = next;
  }
  return '';
}

const branchCache = new Map<string, ReferralChild[]>();
const snapshotCache = new Map<string, ReferralNetworkSnapshot>();

function snapshotCacheKey(wallet: string): string {
  return `${NETWORK_CONFIG.chainId}:${getContractAddress().toLowerCase()}:${wallet.toLowerCase()}`;
}

export function peekReferralNetwork(walletAddress: string): ReferralNetworkSnapshot | null {
  if (!walletAddress || !isContractConfigured()) return null;
  const self = normalizeAddress(walletAddress);
  if (!self) return null;
  return snapshotCache.get(snapshotCacheKey(self)) || null;
}

export function clearReferralNetworkCache(): void {
  snapshotCache.clear();
}

export function clearReferralBranchCache(): void {
  branchCache.clear();
}

export async function loadReferralChildren(parentAddress: string): Promise<ReferralChild[]> {
  const parent = normalizeAddress(parentAddress);
  if (!parent || !isContractConfigured()) return [];
  const cached = branchCache.get(parent.toLowerCase());
  if (cached) return cached;

  const provider = await assertTrustedRpc(getProviderWithFallback());
  const contractAddress = getContractAddress();
  const contract = new Contract(contractAddress, CONTRACT_ABI, provider);
  let fromBlock = 0;
  let toBlock = 0;
  try {
    const range = await resolveStartBlock(provider, contractAddress);
    fromBlock = range.fromBlock;
    toBlock = range.toBlock;
  } catch {
    return [];
  }
  const pack = await queryFilterChunked(
    contract,
    eventFilter(contract, 'AfiliadoRegistrado', null, parent),
    fromBlock,
    toBlock,
    Date.now() + SCAN_BUDGET_MS
  );
  const seen = new Set<string>();
  const people: ReferralChild[] = [];
  for (const event of pack.events) {
    const args = eventArgs(event);
    const usuario = normalizeAddress(asText(argValue(args, 'usuario', 0)));
    const key = usuario.toLowerCase();
    if (!usuario || key === parent.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    people.push({ address: usuario, code: addressToInviteCode(usuario), level: 1 });
  }
  const levelDeadline = Date.now() + CHUNK_TIMEOUT_MS;
  const levels = await Promise.all(
    people.map((person) => readLevel(contract, person.address, levelDeadline))
  );
  const next = people.map((person, index) => ({ ...person, level: levels[index] || 1 }));
  if (pack.failed === 0 || next.length > 0) {
    branchCache.set(parent.toLowerCase(), next);
  }
  return next;
}

export async function fillReferralTimestamps(
  nodes: ReferralNode[]
): Promise<Map<string, { registeredAt: number; lastEarnAt: number }>> {
  const out = new Map<string, { registeredAt: number; lastEarnAt: number }>();
  const list = Array.isArray(nodes) ? nodes : [];
  const blocks = list.flatMap((node) =>
    [node.registeredBlock, node.lastEarnBlock].filter((block) => block > 0)
  );
  if (!blocks.length) {
    for (const node of list) {
      out.set(node.address.toLowerCase(), {
        registeredAt: node.registeredAt || 0,
        lastEarnAt: node.lastEarnAt || 0,
      });
    }
    return out;
  }
  try {
    const provider = await assertTrustedRpc(getProviderWithFallback());
    const stamps = await resolveTimestamps(provider, blocks, Date.now() + CHUNK_TIMEOUT_MS);
    for (const node of list) {
      out.set(node.address.toLowerCase(), {
        registeredAt: stamps.get(node.registeredBlock) || node.registeredAt || 0,
        lastEarnAt: stamps.get(node.lastEarnBlock) || node.lastEarnAt || 0,
      });
    }
    return out;
  } catch {
    for (const node of list) {
      out.set(node.address.toLowerCase(), { registeredAt: 0, lastEarnAt: 0 });
    }
    return out;
  }
}

export async function loadReferralNetwork(walletAddress: string): Promise<ReferralNetworkSnapshot> {
  if (!walletAddress || !isContractConfigured()) return EMPTY;

  const self = normalizeAddress(walletAddress);
  if (!self) return EMPTY;

  const provider = await assertTrustedRpc(getProviderWithFallback());
  const contractAddress = getContractAddress();
  const contract = new Contract(contractAddress, CONTRACT_ABI, provider);
  const cacheKey = snapshotCacheKey(self);
  const previous = snapshotCache.get(cacheKey);
  let toBlock = 0;
  try {
    const range = await resolveStartBlock(provider, contractAddress);
    toBlock = range.toBlock;
  } catch {
    if (previous && previous.directs.length > 0) return { ...previous, partial: true };
    return { ...EMPTY, partial: true };
  }
  clearReferralBranchCache();

  const signupFilter = eventFilter(contract, 'AfiliadoRegistrado', null, self);
  const bonusFilter = eventFilter(contract, 'BonoActivacionPagado', self);
  const commissionFilter = eventFilter(contract, 'ComisionGeneracional', self);

  const perBlock = await secondsPerBlock(provider, toBlock);
  const floor = Math.max(0, getKnownStartBlock(contractAddress));
  const recentFrom = Math.max(floor, toBlock - RECENT_SPAN);
  const yesterdayEnd = Math.min(blocksAgo(toBlock, YESTERDAY_FROM_S, perBlock), recentFrom - 1);
  const yesterdayStart = Math.max(floor, blocksAgo(toBlock, YESTERDAY_TO_S, perBlock));
  const priorityEnd = Math.min(yesterdayEnd, blocksAgo(toBlock, PRIORITY_FROM_S, perBlock));
  const priorityStart = Math.max(yesterdayStart, blocksAgo(toBlock, PRIORITY_TO_S, perBlock));
  const weekFrom = Math.max(floor, blocksAgo(toBlock, WEEK_S, perBlock));
  const focusBlock = blocksAgo(toBlock, PRIORITY_FROM_S + 60 * 60, perBlock);
  const ranges = [
    ...focusFirst(chunkRanges(priorityStart, priorityEnd, DIRECT_CHUNK), focusBlock),
    ...chunkRanges(priorityEnd + 1, yesterdayEnd, DIRECT_CHUNK),
    ...chunkRanges(yesterdayStart, priorityStart - 1, DIRECT_CHUNK),
    ...chunkRanges(recentFrom, toBlock, DIRECT_CHUNK),
    ...chunkRanges(yesterdayEnd + 1, recentFrom - 1, DIRECT_CHUNK),
    ...chunkRanges(weekFrom, yesterdayStart - 1, DIRECT_CHUNK),
  ];
  const peoplePack = await queryFilterRanges(
    contract,
    [signupFilter, bonusFilter],
    ranges,
    Date.now() + DIRECT_SCAN_BUDGET_MS,
    focusBlock
  );
  const commissionPack = await queryFilterReliable(
    contract,
    commissionFilter,
    recentFrom,
    toBlock,
    Date.now() + SCAN_BUDGET_MS
  );
  const signups = peoplePack.events.filter((event) => eventName(event) === 'AfiliadoRegistrado');
  const bonuses = peoplePack.events.filter((event) => eventName(event) === 'BonoActivacionPagado');
  const commissions = commissionPack.events;

  const directSet = new Set<string>();
  const nodes = new Map<string, ReferralNode>();

  const blankDirect = (usuario: string, registeredBlock: number): ReferralNode => ({
    address: usuario,
    code: addressToInviteCode(usuario),
    earnedWei: '0',
    earnedLabel: formatToken(0n),
    bonusWei: '0',
    bonusLabel: formatToken(0n),
    commissionWei: '0',
    commissionLabel: formatToken(0n),
    level: 1,
    registeredBlock,
    registeredAt: 0,
    lastEarnBlock: 0,
    lastEarnAt: 0,
    children: [],
  });

  const ensureDirect = (address: string, registeredBlock: number): ReferralNode | null => {
    const usuario = normalizeAddress(address);
    if (!usuario || usuario.toLowerCase() === self.toLowerCase()) return null;
    const key = usuario.toLowerCase();
    directSet.add(key);
    const existing = nodes.get(key);
    if (existing) {
      if (
        registeredBlock > 0 &&
        (!existing.registeredBlock || registeredBlock < existing.registeredBlock)
      ) {
        existing.registeredBlock = registeredBlock;
      }
      return existing;
    }
    const created = blankDirect(usuario, registeredBlock);
    nodes.set(key, created);
    return created;
  };

  for (const event of signups) {
    const args = eventArgs(event);
    ensureDirect(asText(argValue(args, 'usuario', 0)), event.blockNumber || 0);
  }

  const failed = peoplePack.failed + commissionPack.failed;

  const parentCache = new Map<string, string>();
  parentCache.set(self.toLowerCase(), ZERO);

  const addEarned = (
    address: string,
    amount: bigint,
    kind: 'bonus' | 'commission',
    blockNumber: number,
    createIfMissing = false
  ) => {
    const node = createIfMissing ? ensureDirect(address, 0) : nodes.get(address.toLowerCase());
    if (!node || amount <= 0n) return;
    const next = creditDirectWei(node.earnedWei, node.bonusWei, node.commissionWei, amount, kind);
    node.earnedWei = next.earnedWei;
    node.earnedLabel = formatToken(BigInt(next.earnedWei));
    node.bonusWei = next.bonusWei;
    node.bonusLabel = formatToken(BigInt(next.bonusWei));
    node.commissionWei = next.commissionWei;
    node.commissionLabel = formatToken(BigInt(next.commissionWei));
    if (blockNumber > node.lastEarnBlock) node.lastEarnBlock = blockNumber;
  };

  const drafts: Array<ReferralActivity & { blockNumber: number }> = [];

  for (const event of signups) {
    const args = eventArgs(event);
    const usuario = normalizeAddress(asText(argValue(args, 'usuario', 0)));
    if (!usuario) continue;
    drafts.push({
      id: `${event.transactionHash}-signup`,
      type: 'signup',
      titleKey: 'activitySignup',
      code: addressToInviteCode(usuario),
      timestamp: 0,
      blockNumber: event.blockNumber,
    });
  }

  for (const event of bonuses) {
    const args = eventArgs(event);
    const referido = normalizeAddress(asText(argValue(args, 'referido', 1)));
    const amount = asBigInt(argValue(args, 'monto', 2));
    const token = asText(argValue(args, 'token', 3));
    if (referido) addEarned(referido, amount, 'bonus', event.blockNumber || 0, true);
    drafts.push({
      id: `${event.transactionHash}-bonus`,
      type: 'bonus',
      titleKey: 'activityBonus',
      code: referido ? addressToInviteCode(referido) : '',
      amountLabel: formatToken(amount, token),
      timestamp: 0,
      blockNumber: event.blockNumber,
    });
  }

  const walkDeadline = Date.now() + CHUNK_TIMEOUT_MS;
  for (const event of commissions) {
    const args = eventArgs(event);
    const deudor = normalizeAddress(asText(argValue(args, 'deudor', 1)));
    const generation = Number(argValue(args, 'generacion', 2) ?? 0);
    const amount = asBigInt(argValue(args, 'monto', 3));
    const token = asText(argValue(args, 'token', 4));
    if (deudor) {
      const owner = directSet.has(deudor.toLowerCase())
        ? deudor
        : await nearestDirect(contract, deudor, self, directSet, parentCache, walkDeadline);
      if (owner) addEarned(owner, amount, 'commission', event.blockNumber || 0);
    }
    drafts.push({
      id: `${event.transactionHash}-commission-${generation}`,
      type: 'commission',
      titleKey: 'activityCommission',
      code: deudor ? addressToInviteCode(deudor) : '',
      amountLabel: formatToken(amount, token),
      generation,
      timestamp: 0,
      blockNumber: event.blockNumber,
    });
  }

  drafts.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));
  const recent = drafts.slice(0, 30);
  const directs = [...nodes.values()].sort((a, b) => {
    const byBlock = (b.registeredBlock || 0) - (a.registeredBlock || 0);
    if (byBlock) return byBlock;
    const byEarn = BigInt(b.earnedWei) - BigInt(a.earnedWei);
    if (byEarn > 0n) return 1;
    if (byEarn < 0n) return -1;
    return 0;
  });
  const totals = sumReferralEarnings(directs);
  const uniqueLevels = [...new Set(directs.map((node) => node.address.toLowerCase()))];
  const enrichDeadline = Date.now() + CHUNK_TIMEOUT_MS;
  const [stamps, levelEntries] = await Promise.all([
    resolveTimestamps(
      provider,
      recent.map((item) => item.blockNumber),
      enrichDeadline
    ),
    Promise.all(
      uniqueLevels.map(
        async (address) => [address, await readLevel(contract, address, enrichDeadline)] as const
      )
    ),
  ]);
  const activity: ReferralActivity[] = recent.map(({ blockNumber, ...item }) => ({
    ...item,
    timestamp: stamps.get(blockNumber) || 0,
  }));
  const levels = new Map(levelEntries);
  for (const node of directs) {
    node.level = levels.get(node.address.toLowerCase()) || 1;
  }

  const snapshot: ReferralNetworkSnapshot = {
    directs,
    totalEarnedWei: totals.totalWei.toString(),
    totalEarnedLabel: formatToken(totals.totalWei),
    commissionTotalWei: totals.commissionWei.toString(),
    commissionTotalLabel: formatToken(totals.commissionWei),
    bonusTotalWei: totals.bonusWei.toString(),
    bonusTotalLabel: formatToken(totals.bonusWei),
    activity,
    partial: peoplePack.cut || commissionPack.cut || failed > 0,
  };
  const emptyFail = failed > 0 && directs.length === 0;
  if (emptyFail && previous && previous.directs.length > 0) {
    return { ...previous, partial: true };
  }
  if (!emptyFail) snapshotCache.set(cacheKey, snapshot);
  return snapshot;
}
