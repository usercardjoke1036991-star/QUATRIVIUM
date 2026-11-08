import { Linking } from 'react-native';
import { INVITE_WEB_BASE } from '../constants/appLinks';
import { isHttpsUrl } from './sanitize';

const ALLOWED_HOSTS = new Set([
  'wa.me',
  'api.whatsapp.com',
  'whatsapp.com',
  'www.whatsapp.com',
  't.me',
  'telegram.me',
  'telegram.org',
  'play.google.com',
]);

function inviteHost(): string {
  if (!INVITE_WEB_BASE || !isHttpsUrl(INVITE_WEB_BASE)) return '';
  try {
    return new URL(INVITE_WEB_BASE).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isAllowedOpenUrl(value: string): boolean {
  if (!isHttpsUrl(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return true;
    const extra = inviteHost();
    return Boolean(extra) && host === extra;
  } catch {
    return false;
  }
}

export async function openSafeUrl(value: string): Promise<boolean> {
  if (!isAllowedOpenUrl(value)) return false;
  try {
    await Linking.openURL(value);
    return true;
  } catch {
    return false;
  }
}
