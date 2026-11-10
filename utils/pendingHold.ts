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

export async function readHold(store: HoldStore, from: string): Promise<HeldSend | null> {
  const row = (await readAll(store))[from.toLowerCase()];
  return valid(row) ? { nonce: row.nonce, hash: row.hash } : null;
}

export async function writeHold(store: HoldStore, from: string, hold: HeldSend): Promise<void> {
  const all = await readAll(store);
  all[from.toLowerCase()] = { nonce: hold.nonce, hash: hold.hash.toLowerCase() };
  await store.set(FILE, JSON.stringify(all));
}

export async function deleteHold(store: HoldStore, from: string): Promise<void> {
  const all = await readAll(store);
  delete all[from.toLowerCase()];
  if (Object.keys(all).length === 0) {
    await store.del(FILE);
    return;
  }
  await store.set(FILE, JSON.stringify(all));
}

/** Nadie vio el hash y la red sigue en N: no hay hueco que guardar. */
export function shouldReleaseHold(
  sightings: number,
  networkNonce: number,
  held: HeldSend
): boolean {
  return sightings === 0 && networkNonce === held.nonce;
}

export async function settleHold(
  store: HoldStore,
  input: {
    from: string;
    nonce: number;
    hash: string;
    release: boolean;
  }
): Promise<'held' | 'released'> {
  if (input.release) {
    await deleteHold(store, input.from);
    return 'released';
  }
  await writeHold(store, input.from, { nonce: input.nonce, hash: input.hash.toLowerCase() });
  return 'held';
}
