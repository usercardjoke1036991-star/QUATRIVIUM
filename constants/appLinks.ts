import { isHttpsUrl } from '../utils/sanitize';

/** Web pública opcional de invitaciones (HTTPS). Sin ella se usa el deep link de la app. */
const rawInviteWeb = (process.env.EXPO_PUBLIC_INVITE_WEB_BASE || '').replace(/\/$/, '');
export const INVITE_WEB_BASE = isHttpsUrl(rawInviteWeb) ? rawInviteWeb : '';

/** Deep link propio: no choca con la app Magno (`quatrivium`). */
export const INVITE_APP_SCHEME = 'quatrivium-sovereign';
