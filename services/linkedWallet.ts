import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAddress, isAddress } from 'ethers';
import { storeSlot } from '../utils/storeSlot';
import { NETWORK_CONFIG } from '../constants/rpcConfig';
import type { LinkProof } from './linkChallenge';

const PREFIX = `${storeSlot(['quatrivium', 'linkedExternal', 'v1'])}:`;
export const WALLET_LINK_SKIPPED = 'skipped';
/** Vínculos viejos, probados con firma EIP-712 desde la billetera externa. Se siguen leyendo. */
const PROVEN_PREFIX = 'proven:';
/** Vínculos nuevos: `transfer:<dirección>:<hash>` de la transferencia de prueba que vieron dos RPC. */
const TRANSFER_PREFIX = 'transfer:';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

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
    let address = '';
    if (stored.startsWith(PROVEN_PREFIX)) {
      address = stored.slice(PROVEN_PREFIX.length);
    } else if (stored.startsWith(TRANSFER_PREFIX)) {
      const [candidate, txHash] = stored.slice(TRANSFER_PREFIX.length).split(':');
      if (!TX_HASH.test(String(txHash || ''))) return '';
      address = candidate;
    } else {
      return '';
    }
    if (!hasLinkedExternalWallet(address)) return '';
    if (getAddress(address).toLowerCase() === getAddress(internalWallet).toLowerCase()) return '';
    return getAddress(address);
  } catch {
    return '';
  }
}

/** Solo guarda con la prueba que devolvió checkLinkChallenge, de esta red y para otra dirección. */
export async function saveLinkedExternalWallet(
  internalWallet: string,
  proof: LinkProof
): Promise<string> {
  if (!isAddress(internalWallet) || !proof || !hasLinkedExternalWallet(proof.external)) {
    throw new Error('wallet');
  }
  if (proof.chainId !== NETWORK_CONFIG.chainId || !TX_HASH.test(String(proof.txHash || ''))) {
    throw new Error('proof');
  }
  const address = getAddress(proof.external);
  if (address === getAddress(internalWallet)) throw new Error('wallet');
  await AsyncStorage.setItem(
    linkedWalletStorageKey(internalWallet),
    `${TRANSFER_PREFIX}${address}:${proof.txHash.toLowerCase()}`
  );
  return address;
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
