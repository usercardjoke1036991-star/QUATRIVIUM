import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { stripUnsafeText } from '../utils/sanitize';
import { storeSlot } from '../utils/storeSlot';

/** El worker acepta hasta 100 direcciones; una división de ranking llena usa este tope. */
export const PUBLIC_PROFILE_BATCH = 100;

export const AVATAR_PRESETS = [
  { id: 0, bg: '#C4793C', fg: '#fff4e8' },
  { id: 1, bg: '#7A8B9A', fg: '#eef3f7' },
  { id: 2, bg: '#D4A017', fg: '#fff8e0' },
  { id: 3, bg: '#2F6F8C', fg: '#e4f6fc' },
  { id: 4, bg: '#146C2E', fg: '#e7f8ed' },
  { id: 5, bg: '#007AFF', fg: '#e8f2ff' },
  { id: 6, bg: '#7C3AED', fg: '#f3e8ff' },
  { id: 7, bg: '#BE185D', fg: '#fce7f3' },
] as const;

export interface UserProfile {
  displayName: string;
  avatarId: number;
  photoUri: string;
  publicPhoto: string;
  publicFace: boolean;
  updatedAt: number;
}

export const EMPTY_PROFILE: UserProfile = {
  displayName: '',
  avatarId: 0,
  photoUri: '',
  publicPhoto: '',
  publicFace: false,
  updatedAt: 0,
};

export const PUBLIC_PHOTO_MAX = 60_000;

export function clampAvatarId(value: unknown): number {
  const id = Number(value);
  if (!Number.isFinite(id)) return 0;
  return Math.max(0, Math.min(AVATAR_PRESETS.length - 1, Math.floor(id)));
}

export function hasLockedPublicIdentity(profile?: UserProfile | null): boolean {
  return Boolean(
    profile?.publicFace &&
      isValidDisplayName(profile.displayName || '') &&
      sanitizePublicPhoto(profile.publicPhoto || '')
  );
}

export function isPublicIdentityLocked(profile?: UserProfile | null, _username = ''): boolean {
  return hasLockedPublicIdentity(profile);
}

export function sanitizePublicPhoto(value: string): string {
  const uri = sanitizePhotoUri(value);
  if (!uri.startsWith('data:')) return '';
  if (uri.length > PUBLIC_PHOTO_MAX) return '';
  return uri;
}

export function canSubmitPublicIdentity(displayName: string, publicPhoto: string): boolean {
  return isValidDisplayName(displayName) && Boolean(sanitizePublicPhoto(publicPhoto));
}

export async function publicPhotoFromAsset(asset: {
  uri?: string;
  mimeType?: string | null;
  base64?: string | null;
}): Promise<string> {
  const mime =
    asset.mimeType && /^image\/(jpeg|jpg|png|webp|gif)$/i.test(asset.mimeType)
      ? asset.mimeType
      : 'image/jpeg';
  if (asset.base64) {
    const data = sanitizePublicPhoto(`data:${mime};base64,${asset.base64}`);
    if (data) return data;
  }
  const persisted = await persistPickedPhoto(asset);
  return sanitizePublicPhoto(persisted);
}

export function normalizeDisplayName(value: string): string {
  return stripUnsafeText(value, 24);
}

export function isValidDisplayName(value: string): boolean {
  const name = normalizeDisplayName(value);
  return name.length >= 2 && name.length <= 24;
}

function sanitizePhotoUri(value: string): string {
  const uri = value.trim();
  if (!uri) return '';
  if (/^(file|content|ph|assets-library):/i.test(uri)) return uri;
  if (
    /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(uri) &&
    uri.length <= 750_000
  ) {
    return uri.replace(/\s/g, '');
  }
  return '';
}

function directoryPhotoUri(value: string): string {
  const uri = sanitizePhotoUri(value);
  return uri.startsWith('data:') ? '' : uri;
}

function avatarFileName(mime: string): string {
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return `quatrivium-avatar-${Date.now()}.${ext}`;
}

export async function persistPickedPhoto(asset: {
  uri?: string;
  mimeType?: string | null;
  base64?: string | null;
}): Promise<string> {
  const mime =
    asset.mimeType && /^image\/(jpeg|jpg|png|webp|gif)$/i.test(asset.mimeType)
      ? asset.mimeType
      : 'image/jpeg';
  const name = avatarFileName(mime);

  try {
    if (Paths.document) {
      try {
        for (const item of Paths.document.list()) {
          if (
            item instanceof File &&
            (item.name.startsWith('quatrivium-avatar') || item.name.startsWith('bitcredit-avatar'))
          ) {
            item.delete();
          }
        }
      } catch {
        // Si no se pueden borrar copias viejas, igual se escribe la nueva.
      }
      const dest = new File(Paths.document, name);
      if (asset.base64) {
        dest.create();
        dest.write(asset.base64, { encoding: 'base64' });
        if (dest.uri) return dest.uri;
      } else if (asset.uri) {
        new File(asset.uri).copy(dest);
        if (dest.uri) return dest.uri;
      }
    }
  } catch {
    // Si el nativo falla, guardamos un data URI en el perfil local.
  }

  if (asset.base64) {
    return sanitizePhotoUri(`data:${mime};base64,${asset.base64}`);
  }
  return sanitizePhotoUri(asset.uri || '');
}

export function initialsFromName(name: string, fallback = 'BC'): string {
  const parts = normalizeDisplayName(name).split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase();
  if (parts[0]?.length === 1) return `${parts[0]}${parts[0]}`.toUpperCase();
  return fallback;
}

export function avatarColorForWallet(wallet: string): { bg: string; fg: string } {
  let hash = 0;
  const key = wallet.toLowerCase();
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PRESETS[hash % AVATAR_PRESETS.length];
}

export function labelForProfile(profile?: UserProfile | null, fallback = ''): string {
  const name = normalizeDisplayName(profile?.displayName || '');
  return name || fallback;
}

const OWN_KEY = storeSlot(['quatrivium', 'profile', 'own']);
const DIR_KEY = storeSlot(['quatrivium', 'profile', 'directory']);

function walletKey(wallet: string): string {
  return wallet.trim().toLowerCase();
}

function parseProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<UserProfile>;
  return {
    displayName: normalizeDisplayName(String(value.displayName || '')),
    avatarId: clampAvatarId(value.avatarId),
    photoUri: typeof value.photoUri === 'string' ? sanitizePhotoUri(value.photoUri) : '',
    publicPhoto:
      typeof value.publicPhoto === 'string' ? sanitizePublicPhoto(value.publicPhoto) : '',
    publicFace: Boolean(value.publicFace),
    updatedAt: Number(value.updatedAt) || 0,
  };
}

export async function loadOwnProfile(wallet?: string): Promise<UserProfile> {
  try {
    if (wallet) {
      const scoped = await AsyncStorage.getItem(`${OWN_KEY}.${walletKey(wallet)}`);
      if (scoped) return parseProfile(JSON.parse(scoped)) || { ...EMPTY_PROFILE };
    }
    const raw = await AsyncStorage.getItem(OWN_KEY);
    return parseProfile(raw ? JSON.parse(raw) : null) || { ...EMPTY_PROFILE };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export async function saveOwnProfile(profile: UserProfile, wallet?: string): Promise<UserProfile> {
  const previous = await loadOwnProfile(wallet);
  const locked = hasLockedPublicIdentity(previous);
  const next: UserProfile = {
    displayName: locked ? previous.displayName : normalizeDisplayName(profile.displayName),
    avatarId: locked ? previous.avatarId : clampAvatarId(profile.avatarId),
    photoUri: locked ? previous.photoUri : sanitizePhotoUri(profile.photoUri || ''),
    publicPhoto: locked ? previous.publicPhoto : sanitizePublicPhoto(profile.publicPhoto || ''),
    publicFace: locked || Boolean(profile.publicFace),
    updatedAt: Date.now(),
  };
  if (wallet) {
    await AsyncStorage.setItem(`${OWN_KEY}.${walletKey(wallet)}`, JSON.stringify(next));
  } else {
    await AsyncStorage.setItem(OWN_KEY, JSON.stringify(next));
  }
  return next;
}

export async function clearOwnProfile(wallet?: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(OWN_KEY);
  } catch {
    // ignore
  }
  if (!wallet) return;
  try {
    await AsyncStorage.removeItem(`${OWN_KEY}.${walletKey(wallet)}`);
  } catch {
    // ignore
  }
}

export async function loadProfileDirectory(): Promise<Record<string, UserProfile>> {
  try {
    const raw = await AsyncStorage.getItem(DIR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, UserProfile> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const profile = parseProfile(value);
      if (profile) out[walletKey(key)] = profile;
    }
    return out;
  } catch {
    return {};
  }
}

export async function rememberProfiles(
  entries: Record<string, UserProfile>
): Promise<Record<string, UserProfile>> {
  const current = await loadProfileDirectory();
  const next = { ...current };
  for (const [wallet, profile] of Object.entries(entries)) {
    const key = walletKey(wallet);
    const existing = next[key];
    if (!existing || (profile.updatedAt || 0) >= (existing.updatedAt || 0)) {
      next[key] = {
        displayName: normalizeDisplayName(profile.displayName),
        avatarId: clampAvatarId(profile.avatarId),
        photoUri:
          directoryPhotoUri(profile.photoUri || '') || directoryPhotoUri(existing?.photoUri || ''),
        publicPhoto: sanitizePublicPhoto(profile.publicPhoto || '') || existing?.publicPhoto || '',
        publicFace: Boolean(profile.publicFace || existing?.publicFace),
        updatedAt: profile.updatedAt || Date.now(),
      };
    }
  }
  await AsyncStorage.setItem(DIR_KEY, JSON.stringify(next));
  return next;
}

export async function rememberProfile(
  wallet: string,
  profile: UserProfile
): Promise<Record<string, UserProfile>> {
  if (!wallet) return loadProfileDirectory();
  return rememberProfiles({ [wallet]: profile });
}

/** Sin directorio remoto: el perfil vive solo en el teléfono. Se conserva por compatibilidad. */
export async function publishOwnProfile(
  _walletAddress: string,
  _profile: UserProfile
): Promise<void> {}

/** Sin directorio remoto: nunca hay perfiles públicos de otras wallets. */
export async function fetchPublicProfiles(
  _wallets: string[]
): Promise<Record<string, UserProfile>> {
  return {};
}
