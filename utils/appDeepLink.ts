import { INVITE_APP_SCHEME, PUBLIC_APP_HOST } from '../constants/appLinks';
import { parseLinkingUrl } from './parseLinkingUrl';

export type AppDeepLink =
  | {
      kind: 'room';
      room:
        | 'wallet'
        | 'credit'
        | 'loans'
        | 'bonuses'
        | 'donate'
        | 'network'
        | 'people'
        | 'pool'
        | 'reserva'
        | 'admin'
        | 'history'
        | 'ranks'
        | 'fame';
    }
  | { kind: 'settings'; panel: 'home' | 'security' | 'privacy' | 'terms' }
  | { kind: 'mode'; mode: 'demo' | 'live' };

const ROOMS = new Set([
  'wallet',
  'credit',
  'loans',
  'bonuses',
  'donate',
  'network',
  'people',
  'pool',
  'reserva',
  'admin',
  'history',
  'ranks',
  'fame',
]);
export const LOCKED_DEEP_LINK_ROOMS = new Set([
  'donate',
  'admin',
  'pool',
  'credit',
  'loans',
  'reserva',
  'bonuses',
]);
const APP_HOST = PUBLIC_APP_HOST;

function trimPathSlashes(path: string): string {
  let s = path;
  while (s.startsWith('/')) s = s.slice(1);
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function isMetroDevUrl(url: string): boolean {
  try {
    const inner = new URL(url);
    return (
      (inner.protocol === 'http:' || inner.protocol === 'https:') &&
      (inner.hostname === '127.0.0.1' ||
        inner.hostname === 'localhost' ||
        inner.hostname.startsWith('10.'))
    );
  } catch {
    return false;
  }
}

export function isAllowedAppUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = parseLinkingUrl(url);
    const scheme = String(parsed.scheme || '').toLowerCase();
    const host = String(parsed.hostname || '').toLowerCase();
    // `quatrivium` abre la otra app. Cualquier otro esquema también se rechaza.
    if (scheme === 'quatrivium') return false;
    if (scheme === INVITE_APP_SCHEME) return true;
    if (scheme === 'https' && host === APP_HOST) return true;
    if (host === 'expo-development-client') {
      const nested = String(parsed.queryParams?.url || '');
      return !nested || isMetroDevUrl(nested) || isAllowedAppUrl(nested);
    }
    return false;
  } catch {
    return false;
  }
}

function tokenFromAllowed(url: string): string {
  const parsed = parseLinkingUrl(url);
  const scheme = String(parsed.scheme || '').toLowerCase();
  const parts = trimPathSlashes(String(parsed.path || ''))
    .split('/')
    .filter((part) => part && part !== '--');
  const fromQuery = String(
    parsed.queryParams?.room || parsed.queryParams?.panel || ''
  ).toLowerCase();
  const host = String(parsed.hostname || '').toLowerCase();
  const pathHead = parts[0] || '';
  const pathTail = parts[1] || '';
  const fromPath = pathHead === 'room' ? pathTail : pathHead;
  if (fromQuery) return fromQuery;
  if (host === 'room') return fromPath;
  if (host === 'settings') return (pathHead || 'settings').toLowerCase();
  if (host === 'mode') return (pathHead || '').toLowerCase();
  if (host === 'expo-development-client') {
    try {
      const nested = String(parsed.queryParams?.url || '');
      if (nested && isAllowedAppUrl(nested) && !isMetroDevUrl(nested)) {
        return tokenFromAllowed(nested);
      }
    } catch {
      // ignore
    }
    return fromPath.toLowerCase();
  }
  if (scheme === INVITE_APP_SCHEME && host) return host;
  if (host === APP_HOST) return fromPath.toLowerCase();
  return '';
}

function tokenFromUrl(url?: string | null): string {
  if (!url || !isAllowedAppUrl(url)) return '';
  return tokenFromAllowed(url);
}

export function parseAppDeepLink(url?: string | null): AppDeepLink | null {
  const token = tokenFromUrl(url);
  if (token === 'admin') return null;
  if (ROOMS.has(token)) {
    return { kind: 'room', room: token as Extract<AppDeepLink, { kind: 'room' }>['room'] };
  }
  if (token === 'privacy' || token === 'terms') return { kind: 'settings', panel: token };
  if (token === 'settings') return { kind: 'settings', panel: 'home' };
  if (token === 'security') return { kind: 'settings', panel: 'security' };
  if (token === 'profile') return { kind: 'settings', panel: 'home' };
  if (token === 'demo') return { kind: 'mode', mode: 'demo' };
  if (token === 'live' || token === 'real') return { kind: 'mode', mode: 'live' };
  return null;
}
