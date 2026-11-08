import { isHttpsUrl } from './sanitize';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 65_536;

export async function safeJsonFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  if (!isHttpsUrl(url)) {
    throw new Error('url');
  }
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        ...(url.includes('ngrok') ? { 'ngrok-skip-browser-warning': '1' } : {}),
        ...(rest.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJsonLimited<T>(
  response: Response,
  maxBytes = MAX_JSON_BYTES
): Promise<T> {
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error('payload');
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
