import { getAddress, isAddress } from 'ethers';
import { INVITE_APP_SCHEME, INVITE_WEB_BASE, PUBLIC_APP_HOST } from '../constants/appLinks';
import { parseLinkingUrl } from './parseLinkingUrl';
import { stripUnsafeText } from './sanitize';
import { storeSlot } from './storeSlot';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const STORAGE_KEY = storeSlot(['quatrivium', 'invite']);
const GROUPED_RE = /\b[0-9A-HJKMNP-TV-ZILOilo]{4}(?:-[0-9A-HJKMNP-TV-ZILOilo]{4}){7}\b/;

export const INVITE_STORAGE_KEY = STORAGE_KEY;

function hexToBytes(address: string): Uint8Array {
  const hex = address.slice(2).toLowerCase();
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToAddress(bytes: Uint8Array): string | null {
  if (bytes.length < 20) return null;
  let hex = '0x';
  for (let i = 0; i < 20; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  try {
    return getAddress(hex);
  } catch {
    return null;
  }
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = '';
  for (const value of bytes) {
    bits += value.toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^BIT-?/, '')
    .replace(/^BC-?/, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
}

function decodeBase32(normalized: string): Uint8Array | null {
  if (normalized.length !== 32) return null;
  let bits = '';
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

export function formatInviteCode(compact: string): string {
  const clean = normalizeCode(compact);
  if (clean.length !== 32) return compact;
  return clean.match(/.{1,4}/g)?.join('-') ?? clean;
}

export function addressToInviteCode(address: string): string {
  if (!isAddress(address)) return '';
  return formatInviteCode(encodeBase32(hexToBytes(getAddress(address))));
}

export function inviteCodeToAddress(code: string): string | null {
  const bytes = decodeBase32(normalizeCode(code));
  if (!bytes) return null;
  return bytesToAddress(bytes);
}

export function extractInviteFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const grouped = trimmed.match(GROUPED_RE);
  if (grouped) {
    const address = inviteCodeToAddress(grouped[0]);
    if (address) return formatInviteCode(grouped[0]);
  }

  const compact = normalizeCode(trimmed);
  if (compact.length === 32 && inviteCodeToAddress(compact)) {
    return formatInviteCode(compact);
  }

  return null;
}

function extractFromReferrer(raw: string): string | null {
  const decoded = decodeURIComponent(raw);
  const params = new URLSearchParams(decoded.includes('=') ? decoded : `c=${decoded}`);
  const value = String(
    params.get('c') ?? params.get('code') ?? params.get('utm_content') ?? ''
  ).trim();
  if (!value) return null;
  if (isAddress(value)) return addressToInviteCode(value);
  return extractInviteFromText(value);
}

function inviteHostOk(host: string): boolean {
  if (host === PUBLIC_APP_HOST) return true;
  if (!INVITE_WEB_BASE) return false;
  try {
    return new URL(INVITE_WEB_BASE).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Solo el esquema de esta app, o el HTTPS de la página /invite. */
export function isInviteLink(url: string): boolean {
  try {
    const parsed = parseLinkingUrl(url);
    const scheme = String(parsed.scheme || '').toLowerCase();
    const host = String(parsed.hostname || '').toLowerCase();
    const path = `${parsed.path ?? ''}`.replace(/^\/+/, '').toLowerCase();
    const head = path.split('/').filter(Boolean)[0] || '';
    if (scheme === INVITE_APP_SCHEME) return host === 'invite' || head === 'invite';
    if (scheme === 'https' && inviteHostOk(host)) return head === 'invite';
    return false;
  } catch {
    return false;
  }
}

export function extractInviteFromUrl(url: string): string | null {
  try {
    if (!isInviteLink(url)) return null;
    const parsed = parseLinkingUrl(url);
    const query = parsed.queryParams ?? {};
    const fromReferrer = extractFromReferrer(String(query.referrer ?? ''));
    if (fromReferrer) return fromReferrer;

    const fromQuery = String(query.c ?? query.code ?? query.ref ?? '').trim();
    if (fromQuery) {
      if (isAddress(fromQuery)) return addressToInviteCode(fromQuery);
      const asCode = extractInviteFromText(fromQuery);
      if (asCode) return asCode;
    }

    const path = `${parsed.path ?? ''}`.replace(/^\//, '');
    const last = path.split('/').filter(Boolean).pop() ?? '';
    if (last && last !== 'invite') {
      if (isAddress(last)) return addressToInviteCode(last);
      const asCode = extractInviteFromText(last);
      if (asCode) return asCode;
    }
  } catch {
    // ignore
  }
  return null;
}

export function extractInviteNameFromUrl(url: string): string {
  try {
    if (!isInviteLink(url)) return '';
    const parsed = parseLinkingUrl(url);
    const query = parsed.queryParams ?? {};
    const fromQuery = String(query.n ?? query.name ?? '').trim();
    if (fromQuery) return stripUnsafeText(fromQuery, 24);
    const referrer = String(query.referrer ?? '');
    if (referrer) {
      const decoded = decodeURIComponent(referrer);
      const params = new URLSearchParams(decoded.includes('=') ? decoded : '');
      const name = String(params.get('n') ?? params.get('name') ?? '').trim();
      if (name) return stripUnsafeText(name, 24);
    }
  } catch {
    // ignore
  }
  return '';
}

export function parseInviteInput(raw?: string): string | null | '' {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';

  if (isAddress(trimmed)) return getAddress(trimmed);

  const text = String(trimmed);
  if (text.includes('://')) {
    if (!isInviteLink(text)) return null;
    const fromUrl = extractInviteFromUrl(text);
    return fromUrl ? inviteCodeToAddress(fromUrl) : null;
  }

  const fromText = extractInviteFromText(text);
  if (fromText) return inviteCodeToAddress(fromText);

  return null;
}

export function buildInviteLink(code: string, displayName = ''): string {
  const compact = normalizeCode(code);
  if (compact.length !== 32) return '';
  const nameQuery = displayName ? `&n=${encodeURIComponent(stripUnsafeText(displayName, 24))}` : '';
  const appLink = `${INVITE_APP_SCHEME}://invite?c=${compact}${nameQuery}`;
  if (INVITE_WEB_BASE) {
    return `${INVITE_WEB_BASE}/invite?c=${compact}${nameQuery}`;
  }
  return appLink;
}

/** Texto corto para la tarjeta. El copiado sigue siendo la URL completa. */
export function inviteLinkPreview(link: string): string {
  const trimmed = String(link || '').trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:') {
      return `${url.host}${url.pathname}`.replace(/\/$/, '') || trimmed;
    }
    if (url.protocol === `${INVITE_APP_SCHEME}:`) return `${INVITE_APP_SCHEME}://invite`;
  } catch {
    // ignore
  }
  return trimmed.length > 42 ? `${trimmed.slice(0, 36)}…` : trimmed;
}
