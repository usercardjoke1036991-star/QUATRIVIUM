import type { HeldSend } from './broadcastRpc';

const FILE = 'quatrivium.pendingSend.v1';

export type HoldStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
};

function valid(row: HeldSend | undefined): row is HeldSend {
  return Boolean(
    row &&
      Number.isInteger(row.nonce) &&
      row.nonce >= 0 &&
      /^0x[0-9a-f]{64}$/.test(String(row.hash || ''))
  );
}

export function holdKey(chainId: number, from: string): string {
  return `${Math.floor(chainId)}:${from.toLowerCase()}`;
}

async function readAll(store: HoldStore): Promise<Record<string, HeldSend>> {
  const raw = await store.get(FILE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, HeldSend>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveAll(store: HoldStore, all: Record<string, HeldSend>): Promise<void> {
  if (Object.keys(all).length === 0) {
    await store.del(FILE);
    return;
  }
  await store.set(FILE, JSON.stringify(all));
}

/** La clave vieja era solo la dirección. Pasa a chainId:dirección la primera vez que se lee. */
export async function readHold(
  store: HoldStore,
  chainId: number,
  from: string
): Promise<HeldSend | null> {
  const all = await readAll(store);
  const key = holdKey(chainId, from);
  const current = all[key];
  if (valid(current)) {
    return { nonce: current.nonce, hash: current.hash, unseen: current.unseen === true };
  }
  const legacy = all[from.toLowerCase()];
  if (!valid(legacy)) return null;
  all[key] = {
    nonce: legacy.nonce,
    hash: legacy.hash,
    unseen: legacy.unseen === true,
  };
  delete all[from.toLowerCase()];
  await saveAll(store, all);
  return all[key];
}

export async function writeHold(
  store: HoldStore,
  chainId: number,
  from: string,
  hold: HeldSend
): Promise<void> {
  const all = await readAll(store);
  delete all[from.toLowerCase()];
  const next: HeldSend = { nonce: hold.nonce, hash: hold.hash.toLowerCase() };
  if (hold.unseen) next.unseen = true;
  all[holdKey(chainId, from)] = next;
  await saveAll(store, all);
}

export async function deleteHold(store: HoldStore, chainId: number, from: string): Promise<void> {
  const all = await readAll(store);
  delete all[holdKey(chainId, from)];
  delete all[from.toLowerCase()];
  await saveAll(store, all);
}

export async function discardChainHolds(store: HoldStore, chainId: number): Promise<number> {
  const all = await readAll(store);
  const prefix = `${Math.floor(chainId)}:`;
  let removed = 0;
  for (const key of Object.keys(all)) {
    if (key.startsWith(prefix) || !key.includes(':')) {
      delete all[key];
      removed += 1;
    }
  }
  await saveAll(store, all);
  return removed;
}

/** Nadie vio el hash y el nonce de red no pasó de N: no hay hueco que guardar. */
export function shouldReleaseHold(
  sightings: number,
  networkNonce: number,
  held: HeldSend
): boolean {
  return sightings === 0 && networkNonce <= held.nonce;
}

export async function settleHold(
  store: HoldStore,
  input: {
    chainId: number;
    from: string;
    nonce: number;
    hash: string;
    release: boolean;
    unseen?: boolean;
  }
): Promise<'held' | 'released'> {
  if (input.release) {
    await deleteHold(store, input.chainId, input.from);
    return 'released';
  }
  await writeHold(store, input.chainId, input.from, {
    nonce: input.nonce,
    hash: input.hash.toLowerCase(),
    unseen: input.unseen === true,
  });
  return 'held';
}
