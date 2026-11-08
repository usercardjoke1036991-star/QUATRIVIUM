import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contract, formatUnits, getAddress, type AbstractProvider } from 'ethers';
import {
  CONTRACT_ABI,
  ERC20_ABI,
  getContractAddress,
  getUsdtAddress,
} from '../constants/contractConfig';
import { DEPLOYED_TESTNET, getKnownStartBlock } from '../constants/deployedAddresses';
import {
  assertTrustedRpc,
  getProviderWithFallback,
  getRuntimeMode,
  isContractConfigured,
  NETWORK_CONFIG,
} from '../constants/rpcConfig';
import { historyJournalSuffix, movementBelongsToWorld } from '../utils/historyWorld';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { getTokenMeta } from '../constants/tokens';
import { classifyDonationKind, isHiddenVerificationDonation } from '../utils/creditGates';
import { addPoolToSpells, buildMoraSpells, type MoraSpell } from '../utils/moraHistory';

const CHUNK = 4000;
const CHUNK_CONCURRENCY = 3;
const CHUNK_TIMEOUT_MS = 6_000;
const SCAN_BUDGET_MS = 18_000;
const DEFAULT_LOOKBACK = 80_000;
const MAX_SCAN_SPAN = 120_000;
const JOURNAL_PREFIX = 'qc_movements_v1_';

export type MovementKind =
  | 'loan'
  | 'payment'
  | 'transfer_out'
  | 'transfer_in'
  | 'bonus'
  | 'donation'
  | 'access';

export interface Movement {
  id: string;
  kind: MovementKind;
  from: string;
  to: string;
  amountLabel: string;
  tokenSymbol: string;
  platform: string;
  world: 'demo' | 'live';
  timestamp: number;
  txHash?: string;
  dueAt?: number;
}

export interface MovementSnapshot {
  items: Movement[];
  partial: boolean;
}

const TRANSFER_ABI = [
  ...ERC20_ABI,
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

function normalizeAddress(value: string): string {
  try {
    return getAddress(value);
  } catch {
    return '';
  }
}

function journalKey(address: string): string {
  return `${JOURNAL_PREFIX}${historyJournalSuffix({
    mode: getRuntimeMode(),
    chainId: NETWORK_CONFIG.chainId,
    contract: getContractAddress(),
    address,
  })}`;
}

function legacyJournalKey(address: string): string {
  return `${JOURNAL_PREFIX}${getRuntimeMode()}_${address.toLowerCase()}`;
}

function currentWorld(): 'demo' | 'live' {
  return getRuntimeMode() === 'live' ? 'live' : 'demo';
}

function stampWorld(items: Movement[]): Movement[] {
  const world = currentWorld();
  return items.map((item) => ({
    ...item,
    world: item.world === 'live' || item.world === 'demo' ? item.world : world,
  }));
}

function onlyThisWorld(items: Movement[]): Movement[] {
  const world = currentWorld();
  return stampWorld(items).filter((item) => movementBelongsToWorld(item, world));
}

function similarMovement(a: Movement, b: Movement): boolean {
  if (a.kind !== b.kind) return false;
  if (Math.abs((a.timestamp || 0) - (b.timestamp || 0)) >= 20 * 60 * 1000) return false;
  if (a.kind === 'access' || a.kind === 'donation' || a.kind === 'bonus') return true;
  return Boolean(a.amountLabel) && a.amountLabel === b.amountLabel;
}

async function readJournal(address: string): Promise<Movement[]> {
  try {
    const raw = await AsyncStorage.getItem(journalKey(address));
    if (raw) {
      const parsed = JSON.parse(raw) as Movement[];
      return onlyThisWorld(Array.isArray(parsed) ? parsed : []);
    }
    const legacy = await AsyncStorage.getItem(legacyJournalKey(address));
    if (!legacy) return [];
    const parsed = JSON.parse(legacy) as Movement[];
    return onlyThisWorld(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

async function writeJournal(address: string, items: Movement[]): Promise<void> {
  await AsyncStorage.setItem(journalKey(address), JSON.stringify(items.slice(0, 200)));
}

export async function recordMovement(
  address: string,
  entry: Omit<Movement, 'id' | 'world'> & { id?: string }
): Promise<void> {
  const wallet = normalizeAddress(address);
  if (!wallet) return;
  const items = await readJournal(wallet);
  const next: Movement = {
    ...entry,
    id: entry.id || entry.txHash || `local-${Date.now()}-${items.length}`,
    world: currentWorld(),
  };
  const exists = items.some((item) => item.txHash && next.txHash && item.txHash === next.txHash);
  if (exists) return;
  await writeJournal(wallet, [next, ...items]);
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

function formatToken(amount: bigint, token?: string): { label: string; symbol: string } {
  const meta = token ? getTokenMeta(token) : undefined;
  const decimals = meta?.decimals ?? 18;
  const symbol = meta?.symbol ?? 'LUSD';
  return {
    label: `${Number(formatUnits(amount, decimals)).toFixed(4)} ${symbol}`,
    symbol,
  };
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
  const ranges: Array<[number, number]> = [];
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
  return { fromBlock, toBlock: latest, partial: truncated };
}

async function resolveTimestamps(
  provider: AbstractProvider,
  blockNumbers: number[],
  deadline = 0
): Promise<Map<number, number>> {
  const unique = [...new Set(blockNumbers.filter((block) => Number.isFinite(block) && block > 0))];
  const stamps = new Map<number, number>();
  for (let i = 0; i < unique.length; i += 6) {
    if (deadline > 0 && Date.now() > deadline) break;
    const batch = unique.slice(i, i + 6);
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

function mergeMovements(local: Movement[], chain: Movement[]): Movement[] {
  const byHash = new Map<string, Movement>();
  const extra: Movement[] = [];
  for (const item of chain) {
    if (item.txHash) byHash.set(item.txHash, item);
    else extra.push(item);
  }
  const hashed = [...byHash.values()];
  for (const item of local) {
    if (item.txHash) {
      const prev = byHash.get(item.txHash);
      if (prev) {
        byHash.set(item.txHash, {
          ...prev,
          kind:
            item.kind === 'access' || item.kind === 'donation' || item.kind === 'bonus'
              ? item.kind
              : prev.kind,
          platform:
            item.platform && item.platform !== 'Arbitrum One' && item.platform !== prev.platform
              ? item.platform
              : prev.platform,
        });
      } else {
        byHash.set(item.txHash, item);
      }
      continue;
    }
    const dup =
      hashed.some((prev) => similarMovement(prev, item)) ||
      extra.some((prev) => similarMovement(prev, item));
    if (!dup) extra.push(item);
  }
  return [...byHash.values(), ...extra].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function loadMovementHistory(walletAddress: string): Promise<MovementSnapshot> {
  const self = normalizeAddress(walletAddress);
  if (!self) return { items: [], partial: false };
  const local = await readJournal(self);
  if (!isContractConfigured()) {
    return {
      items: onlyThisWorld(local).sort((a, b) => b.timestamp - a.timestamp),
      partial: false,
    };
  }

  try {
    const provider = await assertTrustedRpc(getProviderWithFallback());
    const contractAddress = getContractAddress();
    const contract = new Contract(contractAddress, CONTRACT_ABI, provider);
    const tokenAddress = getUsdtAddress();
    const token = new Contract(tokenAddress, TRANSFER_ABI, provider);
    const { fromBlock, toBlock, partial } = await resolveStartBlock(provider, contractAddress);
    const deadline = Date.now() + SCAN_BUDGET_MS;
    const world = currentWorld();

    const loanFilter = eventFilter(contract, 'PrestamoEmitido', self);
    const payFilter = eventFilter(contract, 'PrestamoPagado', self);
    const donateFilter = eventFilter(contract, 'Donacion', self);
    const bonusFilter = eventFilter(contract, 'BonoHitoPagado', self);
    const outFilter = eventFilter(token, 'Transfer', self, null);
    const inFilter = eventFilter(token, 'Transfer', null, self);

    const [loanPack, payPack, donatePack, bonusPack, outPack, inPack] = await Promise.all([
      queryFilterChunked(contract, loanFilter, fromBlock, toBlock, deadline),
      queryFilterChunked(contract, payFilter, fromBlock, toBlock, deadline),
      queryFilterChunked(contract, donateFilter, fromBlock, toBlock, deadline),
      queryFilterChunked(contract, bonusFilter, fromBlock, toBlock, deadline),
      queryFilterChunked(token, outFilter, fromBlock, toBlock, deadline),
      queryFilterChunked(token, inFilter, fromBlock, toBlock, deadline),
    ]);

    const logs = [
      ...loanPack.events,
      ...payPack.events,
      ...donatePack.events,
      ...bonusPack.events,
      ...outPack.events,
      ...inPack.events,
    ];
    const stamps = await resolveTimestamps(
      provider,
      logs.map((event) => event.blockNumber),
      Date.now() + CHUNK_TIMEOUT_MS
    );
    const chain: Movement[] = [];

    for (const event of loanPack.events) {
      const args = eventArgs(event);
      const tokenAddr = String(argValue(args, 'token', 3) || tokenAddress);
      const amount = formatToken(asBigInt(argValue(args, 'monto', 1)), tokenAddr);
      const hash = event.transactionHash;
      chain.push({
        id: hash,
        kind: 'loan',
        from: contractAddress,
        to: self,
        amountLabel: amount.label,
        tokenSymbol: amount.symbol,
        platform: APP_DISPLAY_NAME,
        world,
        timestamp: (stamps.get(event.blockNumber) || 0) * 1000,
        txHash: hash,
        dueAt: Number(argValue(args, 'vencimiento', 2) || 0) * 1000,
      });
    }

    for (const event of payPack.events) {
      const args = eventArgs(event);
      const tokenAddr = String(argValue(args, 'token', 3) || tokenAddress);
      const principal = asBigInt(argValue(args, 'montoPrincipal', 1));
      const fee = asBigInt(argValue(args, 'fee', 2));
      const amount = formatToken(principal + fee, tokenAddr);
      const hash = event.transactionHash;
      chain.push({
        id: hash,
        kind: 'payment',
        from: self,
        to: contractAddress,
        amountLabel: amount.label,
        tokenSymbol: amount.symbol,
        platform: APP_DISPLAY_NAME,
        world,
        timestamp: (stamps.get(event.blockNumber) || 0) * 1000,
        txHash: hash,
      });
    }

    const donateEvents = [...donatePack.events].sort(
      (a, b) => a.blockNumber - b.blockNumber || a.transactionHash.localeCompare(b.transactionHash)
    );
    donateEvents.forEach((event, index) => {
      const args = eventArgs(event);
      const tokenAddr = String(argValue(args, 'token', 2) || tokenAddress);
      const amountWei = asBigInt(argValue(args, 'monto', 1));
      const amount = formatToken(amountWei, tokenAddr);
      const usd = Number.parseFloat(amount.label) || 0;
      const hash = event.transactionHash;
      if (isHiddenVerificationDonation(usd, index === 0)) return;
      chain.push({
        id: hash,
        kind: classifyDonationKind(usd, index === 0),
        from: self,
        to: '',
        amountLabel: amount.label,
        tokenSymbol: amount.symbol,
        platform: APP_DISPLAY_NAME,
        world,
        timestamp: (stamps.get(event.blockNumber) || 0) * 1000,
        txHash: hash,
      });
    });

    for (const event of bonusPack.events) {
      const args = eventArgs(event);
      const tokenAddr = String(argValue(args, 'token', 3) || tokenAddress);
      const amount = formatToken(asBigInt(argValue(args, 'monto', 2)), tokenAddr);
      const hash = event.transactionHash;
      chain.push({
        id: hash,
        kind: 'bonus',
        from: contractAddress,
        to: self,
        amountLabel: amount.label,
        tokenSymbol: amount.symbol,
        platform: APP_DISPLAY_NAME,
        world,
        timestamp: (stamps.get(event.blockNumber) || 0) * 1000,
        txHash: hash,
      });
    }

    const skip = new Set([contractAddress.toLowerCase(), tokenAddress.toLowerCase()]);
    const creditHashes = new Set(
      [...loanPack.events, ...payPack.events, ...donatePack.events, ...bonusPack.events].map(
        (event) => event.transactionHash
      )
    );
    for (const event of outPack.events) {
      const args = eventArgs(event);
      const to = normalizeAddress(String(argValue(args, 'to', 1) || ''));
      if (to && skip.has(to.toLowerCase())) continue;
      const amount = formatToken(asBigInt(argValue(args, 'value', 2)), tokenAddress);
      const hash = event.transactionHash;
      if (creditHashes.has(hash)) continue;
      chain.push({
        id: `${hash}-out`,
        kind: 'transfer_out',
        from: self,
        to,
        amountLabel: amount.label,
        tokenSymbol: amount.symbol,
        platform: 'Arbitrum One',
        world,
        timestamp: (stamps.get(event.blockNumber) || 0) * 1000,
        txHash: hash,
      });
    }

    for (const event of inPack.events) {
      const args = eventArgs(event);
      const from = normalizeAddress(String(argValue(args, 'from', 0) || ''));
      if (from && skip.has(from.toLowerCase())) continue;
      const amount = formatToken(asBigInt(argValue(args, 'value', 2)), tokenAddress);
      const hash = event.transactionHash;
      if (creditHashes.has(hash)) continue;
      chain.push({
        id: `${hash}-in`,
        kind: 'transfer_in',
        from,
        to: self,
        amountLabel: amount.label,
        tokenSymbol: amount.symbol,
        platform: 'Arbitrum One',
        world,
        timestamp: (stamps.get(event.blockNumber) || 0) * 1000,
        txHash: hash,
      });
    }

    return {
      items: onlyThisWorld(mergeMovements(local, chain)),
      partial:
        partial ||
        loanPack.cut ||
        payPack.cut ||
        donatePack.cut ||
        bonusPack.cut ||
        outPack.cut ||
        inPack.cut ||
        loanPack.failed +
          payPack.failed +
          donatePack.failed +
          bonusPack.failed +
          outPack.failed +
          inPack.failed >
          0,
    };
  } catch {
    return { items: onlyThisWorld(local).sort((a, b) => b.timestamp - a.timestamp), partial: true };
  }
}

export async function loadMoraHistory(
  walletAddress: string,
  level: number
): Promise<{
  items: MoraSpell[];
  partial: boolean;
}> {
  const self = normalizeAddress(walletAddress);
  if (!self || !isContractConfigured()) return { items: [], partial: false };
  try {
    const provider = await assertTrustedRpc(getProviderWithFallback());
    const contractAddress = getContractAddress();
    const contract = new Contract(contractAddress, CONTRACT_ABI, provider);
    const { fromBlock, toBlock, partial } = await resolveStartBlock(provider, contractAddress);
    const deadline = Date.now() + SCAN_BUDGET_MS;
    const moraFilter = eventFilter(contract, 'MorosityUpdated', self);
    const childFilter = eventFilter(contract, 'AfiliadoRegistrado', null, self);
    const [moraPack, childPack] = await Promise.all([
      queryFilterChunked(contract, moraFilter, fromBlock, toBlock, deadline),
      queryFilterChunked(contract, childFilter, fromBlock, toBlock, deadline),
    ]);
    const moraLogs = moraPack.events;
    const childLogs = childPack.events;
    const directs = [
      ...new Set(
        childLogs.map((event) =>
          normalizeAddress(String(argValue(eventArgs(event), 'usuario', 0) || ''))
        )
      ),
    ].filter(Boolean);
    const interestPacks = await Promise.all(
      directs
        .slice(0, 12)
        .map((direct) =>
          queryFilterChunked(
            contract,
            eventFilter(contract, 'InteresDistribuido', direct),
            fromBlock,
            toBlock,
            deadline
          )
        )
    );
    const interestLogs = interestPacks.flatMap((pack) => pack.events);
    const stamps = await resolveTimestamps(
      provider,
      [
        ...moraLogs.map((event) => event.blockNumber),
        ...interestLogs.map((event) => event.blockNumber),
      ],
      Date.now() + CHUNK_TIMEOUT_MS
    );
    const toggles = moraLogs.map((event) => ({
      at: (stamps.get(event.blockNumber) || 0) * 1000,
      on: Boolean(argValue(eventArgs(event), 'esMoroso', 1)),
    }));
    let spells = buildMoraSpells(toggles, Date.now(), level);
    for (const event of interestLogs) {
      const paidAt = (stamps.get(event.blockNumber) || 0) * 1000;
      const interest = asBigInt(argValue(eventArgs(event), 'interes', 2));
      spells = addPoolToSpells(spells, paidAt, interest);
    }
    return {
      items: spells,
      partial:
        partial ||
        moraPack.cut ||
        childPack.cut ||
        interestPacks.some((pack) => pack.cut) ||
        moraPack.failed +
          childPack.failed +
          interestPacks.reduce((sum, pack) => sum + pack.failed, 0) >
          0,
    };
  } catch {
    return { items: [], partial: true };
  }
}
