import { Contract, formatUnits, getAddress, type AbstractProvider } from 'ethers';
import { CONTRACT_ABI, getContractAddress } from '../constants/contractConfig';
import { FAMA_ABI } from '../constants/famaConfig';
import { getKnownStartBlock } from '../constants/deployedAddresses';
import {
  assertTrustedRpc,
  getProviderWithFallback,
  isContractConfigured,
} from '../constants/rpcConfig';
import { rosterFromSignupEvents } from '../utils/fameRoster';
import { attachCombinedScores, type FamePlayer } from '../utils/fameRankings';

const CHUNK = 4000;
const CHUNK_CONCURRENCY = 3;
const CHUNK_TIMEOUT_MS = 6_000;
const SCAN_BUDGET_MS = 18_000;
const DEFAULT_LOOKBACK = 80_000;
const MAX_SCAN_SPAN = 120_000;
/** Con bloque de deploy conocido se recorre más historia; el RPC sigue yendo a trozos. */
const KNOWN_SCAN_SPAN = 400_000;
const VIEW_BATCH = 8;
const MAX_PLAYERS = 400;
const ZERO = '0x0000000000000000000000000000000000000000';

export interface FameLeaderboardSnapshot {
  players: FamePlayer[];
  partial: boolean;
}

const cache = new Map<string, FameLeaderboardSnapshot>();

const EMPTY: FameLeaderboardSnapshot = { players: [], partial: false };

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

function eventFilter(contract: Contract, name: string, ...params: unknown[]) {
  const factory = (contract.filters as Record<string, unknown>)[name];
  if (typeof factory !== 'function') return null;
  return (factory as (...args: unknown[]) => unknown)(...params);
}

async function queryFilterChunked(
  contract: Contract,
  filter: unknown,
  fromBlock: number,
  toBlock: number,
  deadline = 0
): Promise<{ events: Awaited<ReturnType<Contract['queryFilter']>>; failed: number; cut: boolean }> {
  if (!filter) return { events: [], failed: 0, cut: false };
  const ranges: [number, number][] = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    ranges.push([start, Math.min(start + CHUNK - 1, toBlock)]);
  }
  const events: Awaited<ReturnType<Contract['queryFilter']>> = [];
  let failed = 0;
  let cut = false;
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    if (deadline > 0 && Date.now() > deadline) {
      cut = true;
      break;
    }
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([start, end]) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            return await withTimeout(
              contract.queryFilter(filter as Parameters<Contract['queryFilter']>[0], start, end),
              CHUNK_TIMEOUT_MS
            );
          } catch {
            if (attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              continue;
            }
            failed += 1;
            return [];
          }
        }
        return [];
      })
    );
    for (const chunk of results) events.push(...chunk);
  }
  return { events, failed, cut };
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
  const fromKnown = getKnownStartBlock(contractAddress);
  const fromLookback = Math.max(0, latest - DEFAULT_LOOKBACK);
  let fromBlock = fromKnown > 0 ? fromKnown : fromLookback;
  let truncated = fromKnown === 0 && fromLookback > 0;
  const maxSpan = fromKnown > 0 ? KNOWN_SCAN_SPAN : MAX_SCAN_SPAN;
  if (latest - fromBlock > maxSpan) {
    fromBlock = Math.max(0, latest - maxSpan);
    truncated = true;
  }
  return { fromBlock, toBlock: latest, partial: truncated };
}

function cacheKey(): string {
  return `${getContractAddress().toLowerCase()}`;
}

/** Mismo orden para cualquier lector: los altas de la cadena, por bloque. */
export function peekFameLeaderboard(): FameLeaderboardSnapshot | null {
  if (!isContractConfigured()) return EMPTY;
  return cache.get(cacheKey()) || null;
}

export function clearFameLeaderboardCache(): void {
  cache.clear();
}

function takeRoster(order: string[], viewer: string): { roster: string[]; truncated: boolean } {
  const truncated = order.length > MAX_PLAYERS;
  let roster = order.slice(0, MAX_PLAYERS);
  if (!viewer) return { roster, truncated };
  const viewerKey = viewer.toLowerCase();
  if (roster.some((address) => address.toLowerCase() === viewerKey)) {
    return { roster, truncated };
  }
  roster =
    roster.length < MAX_PLAYERS
      ? [...roster, viewer]
      : [...roster.slice(0, MAX_PLAYERS - 1), viewer];
  return { roster, truncated };
}

export async function loadFameLeaderboard(viewerAddress = ''): Promise<FameLeaderboardSnapshot> {
  if (!isContractConfigured()) return EMPTY;
  const key = cacheKey();
  const provider = await assertTrustedRpc(getProviderWithFallback());
  const contractAddress = getContractAddress();
  const contract = new Contract(contractAddress, CONTRACT_ABI, provider);
  let range: { fromBlock: number; toBlock: number; partial: boolean };
  try {
    range = await resolveStartBlock(provider, contractAddress);
  } catch {
    const previous = cache.get(key);
    if (previous && previous.players.length > 0) return { ...previous, partial: true };
    return { ...EMPTY, partial: true };
  }
  const viewer = normalizeAddress(viewerAddress);
  const deadline = Date.now() + SCAN_BUDGET_MS;

  const [signups, issued, paid, bonuses] = await Promise.all([
    queryFilterChunked(
      contract,
      eventFilter(contract, 'AfiliadoRegistrado'),
      range.fromBlock,
      range.toBlock,
      deadline
    ),
    queryFilterChunked(
      contract,
      eventFilter(contract, 'PrestamoEmitido'),
      range.fromBlock,
      range.toBlock,
      deadline
    ),
    queryFilterChunked(
      contract,
      eventFilter(contract, 'PrestamoPagado'),
      range.fromBlock,
      range.toBlock,
      deadline
    ),
    queryFilterChunked(
      contract,
      eventFilter(contract, 'BonoHitoPagado'),
      range.fromBlock,
      range.toBlock,
      deadline
    ),
  ]);

  const order: string[] = [];
  const seen = new Set<string>();
  const referrals = new Map<string, number>();
  const remember = (address: string) => {
    const keyAddr = address.toLowerCase();
    if (!keyAddr || seen.has(keyAddr) || address === ZERO) return;
    seen.add(keyAddr);
    order.push(address);
  };

  const fromSignups = rosterFromSignupEvents(
    signups.events.map((event) => {
      const args = eventArgs(event);
      return {
        blockNumber: event.blockNumber,
        index: event.index,
        usuario: asText(argValue(args, 'usuario', 0)),
        padre: asText(argValue(args, 'padre', 1)),
      };
    })
  );
  for (const address of fromSignups.order) remember(address);
  for (const [padre, count] of fromSignups.referrals) referrals.set(padre, count);

  const requested = new Map<string, number>();
  for (const event of issued.events) {
    const usuario = normalizeAddress(asText(argValue(eventArgs(event), 'usuario', 0)));
    if (!usuario) continue;
    remember(usuario);
    requested.set(usuario.toLowerCase(), (requested.get(usuario.toLowerCase()) || 0) + 1);
  }

  const paidCount = new Map<string, number>();
  const paidWei = new Map<string, bigint>();
  for (const event of paid.events) {
    const args = eventArgs(event);
    const usuario = normalizeAddress(asText(argValue(args, 'usuario', 0)));
    if (!usuario) continue;
    remember(usuario);
    const keyAddr = usuario.toLowerCase();
    paidCount.set(keyAddr, (paidCount.get(keyAddr) || 0) + 1);
    paidWei.set(
      keyAddr,
      (paidWei.get(keyAddr) || 0n) + asBigInt(argValue(args, 'montoPrincipal', 1))
    );
  }

  const bonusCount = new Map<string, number>();
  const bonusWei = new Map<string, bigint>();
  for (const event of bonuses.events) {
    const args = eventArgs(event);
    const usuario = normalizeAddress(asText(argValue(args, 'usuario', 0)));
    if (!usuario) continue;
    remember(usuario);
    const keyAddr = usuario.toLowerCase();
    bonusCount.set(keyAddr, (bonusCount.get(keyAddr) || 0) + 1);
    bonusWei.set(keyAddr, (bonusWei.get(keyAddr) || 0n) + asBigInt(argValue(args, 'monto', 2)));
  }

  if (viewer) remember(viewer);
  const { roster, truncated: rosterTruncated } = takeRoster(order, viewer);
  const fame = new Map<string, number>();
  const streak = new Map<string, number>();
  const closed = new Map<string, number>();
  const levels = new Map<string, number>();
  const mora = new Map<string, boolean>();
  let rachaCaja: Contract | null = null;
  try {
    const hermano = String(await withTimeout(contract.famaHermano(), CHUNK_TIMEOUT_MS));
    if (hermano && hermano !== ZERO) {
      const caja = new Contract(hermano, FAMA_ABI, provider);
      await withTimeout(caja.FAMA_POR_DIA_RACHA(), CHUNK_TIMEOUT_MS);
      rachaCaja = caja;
    }
  } catch {
    rachaCaja = null;
  }
  let viewsCut = false;
  const enrichDeadline = Date.now() + CHUNK_TIMEOUT_MS;
  for (let i = 0; i < roster.length; i += VIEW_BATCH) {
    if (Date.now() > enrichDeadline) {
      viewsCut = true;
      break;
    }
    const batch = roster.slice(i, i + VIEW_BATCH);
    const rows = await Promise.all(
      batch.map(async (address) => {
        try {
          const [history, closedLoans, progress, delinquent, streakDays] = await Promise.all([
            withTimeout(contract.obtenerHistorialUsuario(address), CHUNK_TIMEOUT_MS),
            withTimeout(contract.prestamosCerrados(address), CHUNK_TIMEOUT_MS),
            withTimeout(contract.obtenerProgresoUsuario(address), CHUNK_TIMEOUT_MS),
            withTimeout(contract.esMoroso(address), CHUNK_TIMEOUT_MS).catch(() => false),
            rachaCaja
              ? withTimeout(rachaCaja.diasRacha(address), CHUNK_TIMEOUT_MS).catch(() => 0)
              : Promise.resolve(0),
          ]);
          return {
            address,
            fame: Number(history.puntosReputacion ?? history[0] ?? 0) || 0,
            closed: Number(closedLoans || 0) || 0,
            level: Math.max(1, Number(progress.nivelActual ?? progress[0] ?? 1) || 1),
            delinquent: Boolean(delinquent),
            streakDays: Number(streakDays || 0) || 0,
          };
        } catch {
          return { address, fame: 0, closed: 0, level: 1, delinquent: false, streakDays: 0 };
        }
      })
    );
    for (const row of rows) {
      fame.set(row.address.toLowerCase(), row.fame);
      streak.set(row.address.toLowerCase(), row.streakDays);
      closed.set(row.address.toLowerCase(), row.closed);
      levels.set(row.address.toLowerCase(), row.level);
      mora.set(row.address.toLowerCase(), row.delinquent);
    }
  }

  const players = attachCombinedScores(
    roster.map((address, index) => {
      const keyAddr = address.toLowerCase();
      const loansPaid = Math.max(closed.get(keyAddr) || 0, paidCount.get(keyAddr) || 0);
      return {
        address,
        userNumber: index + 1,
        referrals: referrals.get(keyAddr) || 0,
        loansRequested: requested.get(keyAddr) || 0,
        loansPaid,
        paidUsd: Number(formatUnits(paidWei.get(keyAddr) || 0n, 18)) || 0,
        fame: fame.get(keyAddr) || 0,
        streakDays: streak.get(keyAddr) || 0,
        level: levels.get(keyAddr) || 1,
        bonuses: bonusCount.get(keyAddr) || 0,
        bonusUsd: Number(formatUnits(bonusWei.get(keyAddr) || 0n, 18)) || 0,
        delinquent: Boolean(mora.get(keyAddr)),
        combined: 0,
      };
    })
  );

  const snapshot: FameLeaderboardSnapshot = {
    players,
    partial:
      range.partial ||
      rosterTruncated ||
      viewsCut ||
      signups.cut ||
      issued.cut ||
      paid.cut ||
      bonuses.cut ||
      signups.failed > 0 ||
      issued.failed > 0 ||
      paid.failed > 0 ||
      bonuses.failed > 0,
  };
  cache.set(key, snapshot);
  return snapshot;
}
