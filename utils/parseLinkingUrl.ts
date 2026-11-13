export type ParsedAppUrl = {
  hostname: string | null;
  path: string | null;
  queryParams: Record<string, string>;
  scheme: string | null;
};

/**
 * Lee un enlace como expo-linking fuera de Expo Go.
 * La app y los tests usan esta función, no una copia.
 */
export function parseLinkingUrl(url: string): ParsedAppUrl {
  if (typeof url !== 'string' || !url) {
    throw new TypeError('Invalid URL');
  }
  const queryParams: Record<string, string> = {};
  let path: string | null = null;
  let hostname: string | null = null;
  let scheme: string | null = null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
      queryParams[key] = decodeURIComponent(value);
    });
    path = parsed.pathname || null;
    hostname = parsed.hostname || null;
    scheme = parsed.protocol || null;
  } catch {
    path = url;
  }
  if (scheme) scheme = scheme.substring(0, scheme.length - 1);
  if (path) {
    path = path.replace(/^\//, '');
    const plus = path.indexOf('+');
    if (plus > -1) path = path.substring(plus + 1);
  }
  return { hostname, path, queryParams, scheme };
}
