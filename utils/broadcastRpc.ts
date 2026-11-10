import { nextPublicRpc } from './sovereignSurface';

export type RpcCall = (url: string, method: string, params: readonly unknown[]) => Promise<unknown>;

export type AgreeKind<T> =
  | { kind: 'value'; value: T }
  | { kind: 'mismatch' }
  | { kind: 'unavailable' };

export type BroadcastOutcome = { kind: 'sent'; hash: string } | { kind: 'pending'; hash: string };

export type HeldSend = { nonce: number; hash: string };

function httpsUrls(urls: readonly string[]): string[] {
  return urls.map((url) => url.trim()).filter((url) => url.startsWith('https://'));
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || '')).toLowerCase();
}

/** El nodo ya tiene esta transacción, o el nonce ya se usó. No es un fallo limpio. */
export function isPossibleBroadcastSuccess(error: unknown): boolean {
  const text = errorText(error);
  return text.includes('already known') || text.includes('nonce too low');
}

function isDefinitiveReject(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('insufficient funds') ||
    text.includes('intrinsic gas') ||
    text.includes('invalid sender') ||
    text.includes('exceeds block gas') ||
    text.includes('execution reverted') ||
    text.includes('replacement transaction underpriced') ||
    text.includes('transaction underpriced') ||
    text.includes('gas too low')
  );
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

/** Cuántos RPC devuelven este hash. Uno solo no confirma. El nonce no cuenta. */
export async function hashSightings(
  urls: readonly string[],
  hash: string,
  call: RpcCall
): Promise<number> {
  const expected = hash.toLowerCase();
  const flags = await Promise.all(
    httpsUrls(urls).map(async (url) => {
      try {
        const tx = await call(url, 'eth_getTransactionByHash', [hash]);
        if (!tx || typeof tx !== 'object') return false;
        const seen = String((tx as { hash?: string }).hash || '').toLowerCase();
        return seen === expected;
      } catch {
        return false;
      }
    })
  );
  return flags.filter(Boolean).length;
}

/** El mayor nonce pending. Hacen falta dos respuestas. Si el primero cae, siguen los demás. */
export async function highestPendingNonce(
  urls: readonly string[],
  address: string,
  call: RpcCall
): Promise<number> {
  const values = await Promise.all(
    httpsUrls(urls).map(async (url) => {
      try {
        const raw = await call(url, 'eth_getTransactionCount', [address, 'pending']);
        const nonce = Number.parseInt(String(raw), 16);
        return Number.isFinite(nonce) ? nonce : null;
      } catch {
        return null;
      }
    })
  );
  const ok = values.filter((nonce): nonce is number => nonce != null);
  if (ok.length < 2) throw new Error('nonce-unconfirmed');
  return ok.reduce((max, nonce) => (nonce > max ? nonce : max), ok[0]);
}

/** Mientras el nonce pendiente no esté incluido, el siguiente envío usa el de después. */
export function nonceAfterHold(networkNonce: number, held: HeldSend | null): number {
  if (!held) return networkNonce;
  if (networkNonce > held.nonce) return networkNonce;
  return held.nonce + 1;
}

/** Otra firma con el mismo nonce queda bloqueada. La misma transacción no se vuelve a mandar. */
export function rejectReusedNonce(held: HeldSend | null, nonce: number, hash: string): void {
  if (held && held.nonce === nonce && held.hash !== hash.toLowerCase()) {
    throw new Error('pending-nonce');
  }
}

/**
 * Manda la misma transacción firmada.
 * Si la respuesta se corta, no se declara fallo sin ver el hash en dos RPC.
 * Si no se puede confirmar, queda pendiente: no se firma otra.
 */
export async function broadcastRawAcrossRpcs(input: {
  urls: readonly string[];
  raw: string;
  from: string;
  nonce: number;
  hash: string;
  call: RpcCall;
}): Promise<BroadcastOutcome> {
  const urls = httpsUrls(input.urls);
  if (urls.length === 0) throw new Error('no-rpc');
  const expected = input.hash.toLowerCase();
  const finish = async (): Promise<BroadcastOutcome> => {
    const seen = await hashSightings(urls, input.hash, input.call);
    if (seen >= 2) return { kind: 'sent', hash: input.hash };
    return { kind: 'pending', hash: input.hash };
  };
  let cursor: string | null = urls[0];
  let ambiguous = false;
  let definitive = 0;
  let attempts = 0;
  while (cursor) {
    if ((await hashSightings(urls, input.hash, input.call)) >= 2) {
      return { kind: 'sent', hash: input.hash };
    }
    const url = cursor;
    try {
      const result = await input.call(url, 'eth_sendRawTransaction', [input.raw]);
      attempts += 1;
      const got = String(result || '').toLowerCase();
      if (got && got !== expected) break;
      ambiguous = true;
      if ((await hashSightings(urls, input.hash, input.call)) < 2) {
        return { kind: 'pending', hash: input.hash };
      }
    } catch (error) {
      attempts += 1;
      if ((await hashSightings(urls, input.hash, input.call)) >= 2) {
        return { kind: 'sent', hash: input.hash };
      }
      if (isPossibleBroadcastSuccess(error) || !isDefinitiveReject(error)) {
        ambiguous = true;
      } else {
        definitive += 1;
      }
    }
    cursor = nextPublicRpc(urls, url);
  }
  if ((await hashSightings(urls, input.hash, input.call)) >= 2) {
    return { kind: 'sent', hash: input.hash };
  }
  if (ambiguous || attempts === 0) return finish();
  if (definitive > 0 && !ambiguous) throw new Error('broadcast-failed');
  return finish();
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

/** La comisión sale del mayor de al menos dos fuentes. Una sola no fija el precio. */
export async function highestFee(
  readers: readonly (() => Promise<{ maxFee: bigint; tip: bigint }>)[]
): Promise<{ maxFee: bigint; tip: bigint }> {
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
  if (values.length < 2) throw new Error('fee-unconfirmed');
  return {
    maxFee: values.reduce((max, row) => (row.maxFee > max ? row.maxFee : max), 0n),
    tip: values.reduce((max, row) => (row.tip > max ? row.tip : max), 0n),
  };
}
