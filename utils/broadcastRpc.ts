import { nextPublicRpc } from './sovereignSurface';

export type RpcCall = (url: string, method: string, params: readonly unknown[]) => Promise<unknown>;

export type AgreeKind<T> =
  | { kind: 'value'; value: T }
  | { kind: 'mismatch' }
  | { kind: 'unavailable' };

function httpsUrls(urls: readonly string[]): string[] {
  return urls.map((url) => url.trim()).filter((url) => url.startsWith('https://'));
}

/** Dos lecturas iguales. Una sola, o dos distintas, no se muestran. Si todas fallan, no hay cifra nueva. */
export async function agreeValues<T>(
  readers: readonly (() => Promise<T>)[],
  same: (left: T, right: T) => boolean
): Promise<AgreeKind<T>> {
  const settled = await Promise.all(
    readers.map(async (read) => {
      try {
        return { ok: true as const, value: await read() };
      } catch {
        return { ok: false as const };
      }
    })
  );
  const values = settled.flatMap((row) => (row.ok ? [row.value] : []));
  if (values.length === 0) return { kind: 'unavailable' };
  if (values.length < 2 || !same(values[0], values[1])) return { kind: 'mismatch' };
  return { kind: 'value', value: values[0] };
}

async function seenOrSpent(
  urls: readonly string[],
  from: string,
  nonce: number,
  hash: string,
  call: RpcCall
): Promise<boolean> {
  const checks = await Promise.all(
    urls.map(async (url) => {
      try {
        const tx = await call(url, 'eth_getTransactionByHash', [hash]);
        if (tx) return true;
        const rawNonce = await call(url, 'eth_getTransactionCount', [from, 'latest']);
        const current = Number.parseInt(String(rawNonce), 16);
        return Number.isFinite(current) && current > nonce;
      } catch {
        return false;
      }
    })
  );
  return checks.some(Boolean);
}

/**
 * Manda la misma transacción firmada por los RPC públicos.
 * Si uno acepta y la transacción no aparece, el siguiente envío espera a ver el hash o el nonce.
 */
export async function broadcastRawAcrossRpcs(input: {
  urls: readonly string[];
  raw: string;
  from: string;
  nonce: number;
  hash: string;
  call: RpcCall;
}): Promise<string> {
  const urls = httpsUrls(input.urls);
  if (urls.length === 0) throw new Error('no-rpc');
  const expected = input.hash.toLowerCase();
  let cursor: string | null = urls[0];
  let accepted = false;
  while (cursor) {
    if (accepted && (await seenOrSpent(urls, input.from, input.nonce, input.hash, input.call))) {
      return input.hash;
    }
    try {
      const result = await input.call(cursor, 'eth_sendRawTransaction', [input.raw]);
      const got = String(result || '').toLowerCase();
      if (got !== expected) {
        if (got) throw new Error('hash-mismatch');
        throw new Error('empty-hash');
      }
      accepted = true;
    } catch (error) {
      if (error instanceof Error && error.message === 'hash-mismatch') throw error;
      if (!accepted) {
        cursor = nextPublicRpc(urls, cursor);
        continue;
      }
    }
    if (await seenOrSpent(urls, input.from, input.nonce, input.hash, input.call)) {
      return input.hash;
    }
    cursor = nextPublicRpc(urls, cursor);
  }
  if (accepted) return input.hash;
  throw new Error('broadcast-failed');
}

export async function publicJsonRpc(
  url: string,
  method: string,
  params: readonly unknown[]
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message || 'rpc');
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function agreedBalance(
  urls: readonly string[],
  address: string
): Promise<AgreeKind<bigint>> {
  return agreeValues(
    httpsUrls(urls).map((url) => async () => {
      const raw = await publicJsonRpc(url, 'eth_getBalance', [address, 'latest']);
      return BigInt(String(raw));
    }),
    (left, right) => left === right
  );
}

export async function agreedCallData(
  urls: readonly string[],
  to: string,
  data: string
): Promise<AgreeKind<string>> {
  return agreeValues(
    httpsUrls(urls).map((url) => async () => {
      const raw = await publicJsonRpc(url, 'eth_call', [{ to, data }, 'latest']);
      if (typeof raw !== 'string' || !raw.startsWith('0x')) throw new Error('bad-call');
      return raw.toLowerCase();
    }),
    (left, right) => left === right
  );
}
