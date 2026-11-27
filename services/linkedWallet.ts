import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAddress, isAddress } from 'ethers';
import { storeSlot } from '../utils/storeSlot';
import { NETWORK_CONFIG } from '../constants/rpcConfig';
const PREFIX = `${storeSlot(['quatrivium', 'linkedExternal', 'v1'])}:`;
export const WALLET_LINK_SKIPPED = 'skipped';
/** Vínculos viejos, probados con firma EIP-712 desde la billetera externa. Se siguen leyendo. */
const PROVEN_PREFIX = 'proven:';
export function linkedWalletStorageKey(
  internalWallet: string,
  chainId = NETWORK_CONFIG.chainId
): string {
  return `${PREFIX}${chainId}:${String(internalWallet || '')
    .trim()
    .toLowerCase()}`;
}
export function hasLinkedExternalWallet(value: string): boolean {
  const address = String(value || '').trim();
  return isAddress(address) && !/^0x0+$/i.test(address);
}
export function hasCompletedWalletLink(value: string): boolean {
  return String(value || '').trim() === WALLET_LINK_SKIPPED || hasLinkedExternalWallet(value);
}
export async function loadLinkedExternalWallet(internalWallet: string): Promise<string> {
  if (!isAddress(internalWallet)) return '';
  try {
    const stored = String(
      (await AsyncStorage.getItem(linkedWalletStorageKey(internalWallet))) || ''
    ).trim();
    if (stored === WALLET_LINK_SKIPPED) return WALLET_LINK_SKIPPED;
    if (!stored.startsWith(PROVEN_PREFIX)) return '';
    const address = stored.slice(PROVEN_PREFIX.length);
    if (!hasLinkedExternalWallet(address)) return '';
    if (getAddress(address).toLowerCase() === getAddress(internalWallet).toLowerCase()) return '';
    return getAddress(address);
  } catch {
    return '';
  }
}
export async function skipLinkedExternalWallet(internalWallet: string): Promise<string> {
  if (!isAddress(internalWallet)) throw new Error('wallet');
  await AsyncStorage.setItem(linkedWalletStorageKey(internalWallet), WALLET_LINK_SKIPPED);
  return WALLET_LINK_SKIPPED;
}
export async function loadRequiredExternalWallet(internalWallet: string): Promise<string> {
  const stored = await loadLinkedExternalWallet(internalWallet);
  return hasLinkedExternalWallet(stored) ? stored : '';
}
