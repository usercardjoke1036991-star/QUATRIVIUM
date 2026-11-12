import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contract, HDNodeWallet, Mnemonic, Wallet, randomBytes, type Signer } from 'ethers';
import * as SecureStore from 'expo-secure-store';
import { ERC20_ABI } from '../constants/contractConfig';
import { getProductMode, NETWORK_CONFIG } from '../constants/rpcConfig';
import { createWriteProvider } from './writeRpc';
import { isAllowedWei, isHexAddress } from '../utils/sanitize';
import { migrateSealedValue, type LockStore } from '../utils/lockMigration';
import { reportLockFault } from '../utils/lockRace';
import { isSealedBlob, openSecret, sealSecret, sealedBlobVersion } from '../utils/secretBox';
import { allowWalletAsyncFallback } from '../utils/walletVaultPolicy';
import { assertRestoreFitsThisDevice, lookupBoundWalletOnThisDevice } from './deviceClaim';
import { BOUND_UNKNOWN, bindAppWallet, clearBoundWallet, getBoundWallet } from './deviceBinding';
import { getWalletWrapKey } from './walletSession';
import { storeSlot } from '../utils/storeSlot';

const WALLET_KEY = storeSlot(['quatrivium', 'appWallet', 'v1']);
const WALLET_FALLBACK = storeSlot(['quatrivium', 'appWallet', 'v1', 'fallback']);
const PHRASE_ACK_KEY = storeSlot(['quatrivium', 'appWallet', 'phraseAck']);
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function withLimit<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

interface StoredWallet {
  address: string;
  privateKey: string;
  mnemonic?: string;
}

function parseStored(raw: string): StoredWallet | null {
  try {
    const parsed = JSON.parse(raw) as StoredWallet;
    if (!isHexAddress(parsed.address) || !parsed.privateKey?.startsWith('0x')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readRawWallet(): Promise<string | null> {
  const live = !allowWalletAsyncFallback(getProductMode());
  if (live) {
    const secure = await SecureStore.getItemAsync(WALLET_KEY).catch(() => null);
    await AsyncStorage.removeItem(WALLET_FALLBACK).catch(() => {});
    return secure;
  }
  const secure = await withLimit(
    SecureStore.getItemAsync(WALLET_KEY).catch(() => null),
    12000,
    null
  );
  if (secure) {
    void AsyncStorage.removeItem(WALLET_FALLBACK).catch(() => {});
    return secure;
  }
  const fallback = await AsyncStorage.getItem(WALLET_FALLBACK).catch(() => null);
  if (!fallback) return null;
  const migrated = await withLimit(
    SecureStore.setItemAsync(WALLET_KEY, fallback, OPTIONS).then(() => true as const),
    2500,
    false as const
  );
  if (migrated) {
    await AsyncStorage.removeItem(WALLET_FALLBACK).catch(() => {});
    return fallback;
  }
  if (!allowWalletAsyncFallback(getProductMode())) {
    throw new Error('wallet-persist');
  }
  return fallback;
}

async function readStored(): Promise<StoredWallet | null> {
  const raw = await readRawWallet();
  if (!raw) return null;
  if (isSealedBlob(raw)) {
    const wrap = getWalletWrapKey();
    if (!wrap) return null;
    const opened = parseStored(openSecret(raw, wrap));
    if (opened && sealedBlobVersion(raw) === 1) {
      try {
        await persistRecord(opened);
      } catch {
        // El sobre v1 sigue sirviendo si el cofre no acepta reescribir AES-GCM.
      }
    }
    return opened;
  }
  const parsed = parseStored(raw);
  if (!parsed) return null;
  const wrap = getWalletWrapKey();
  if (!wrap) return null;
  await persistRecord(parsed);
  return parsed;
}

async function persistRecord(record: StoredWallet): Promise<string> {
  const wrap = getWalletWrapKey();
  if (!wrap) {
    throw new Error('locked');
  }
  const sealed = sealSecret(JSON.stringify(record), wrap);
  const secureOk = await withLimit(
    SecureStore.setItemAsync(WALLET_KEY, sealed, OPTIONS).then(() => true as const),
    2500,
    false as const
  );
  if (secureOk) {
    await AsyncStorage.removeItem(WALLET_FALLBACK).catch(() => {});
    return sealed;
  }
  if (!allowWalletAsyncFallback(getProductMode())) {
    throw new Error('wallet-persist');
  }
  try {
    await AsyncStorage.setItem(WALLET_FALLBACK, sealed);
  } catch {
    throw new Error('wallet-persist');
  }
  return sealed;
}

/** Borra el blob solo si sigue siendo exactamente el que escribió esta llamada. */
async function dropFreshWallet(written: string | null): Promise<void> {
  let secure: string | null = null;
  let fallback: string | null = null;
  try {
    secure = await SecureStore.getItemAsync(WALLET_KEY);
  } catch {
    secure = null;
  }
  try {
    fallback = await AsyncStorage.getItem(WALLET_FALLBACK);
  } catch {
    fallback = null;
  }
  const other =
    (secure != null && secure !== '' && secure !== written) ||
    (fallback != null && fallback !== '' && fallback !== written);
  if (written == null || other) {
    if (other) reportLockFault();
    return;
  }
  if (secure === written) {
    try {
      await SecureStore.deleteItemAsync(WALLET_KEY);
    } catch {
      // ignore
    }
  }
  if (fallback === written) {
    try {
      await AsyncStorage.removeItem(WALLET_FALLBACK);
    } catch {
      // ignore
    }
  }
  await clearBoundWallet();
}

async function writeStored(record: StoredWallet): Promise<void> {
  const previousSecure = await SecureStore.getItemAsync(WALLET_KEY).catch(() => null);
  const previousFallback = await AsyncStorage.getItem(WALLET_FALLBACK).catch(() => null);
  const bound = await getBoundWallet();
  if (bound === BOUND_UNKNOWN) throw new Error('store-unknown');
  const next = record.address.toLowerCase();
  if (bound && bound !== next) throw new Error('device-bound');
  const wasEmpty = !bound;
  let written: string | null = null;
  try {
    written = await persistRecord(record);
    const back = await readRawWallet();
    if (back !== written) throw new Error('wallet-persist');
    await bindAppWallet(next);
  } catch (error) {
    if (wasEmpty) {
      await dropFreshWallet(written);
    } else {
      const now = await SecureStore.getItemAsync(WALLET_KEY).catch(() => null);
      if (previousSecure && now !== previousSecure) {
        await SecureStore.setItemAsync(WALLET_KEY, previousSecure, OPTIONS).catch(() => {});
      }
      if (previousFallback) {
        const backFallback = await AsyncStorage.getItem(WALLET_FALLBACK).catch(() => null);
        if (backFallback !== previousFallback) {
          await AsyncStorage.setItem(WALLET_FALLBACK, previousFallback).catch(() => {});
        }
      }
    }
    throw error instanceof Error ? error : new Error('wallet-persist');
  }
}

export async function walletOpensWith(key: string): Promise<boolean> {
  const raw = await readRawWallet();
  if (!raw || !isSealedBlob(raw)) return true;
  try {
    openSecret(raw, key);
    return true;
  } catch {
    return false;
  }
}

/** Abre el cofre con la llave vieja y solo entonces lo guarda con la nueva. */
export async function rewrapStoredWallet(
  oldKeys: readonly string[],
  newWrap: string
): Promise<void> {
  const raw = await readRawWallet();
  if (!raw || !isSealedBlob(raw)) return;
  const memory = new Map<string, string>([[WALLET_KEY, raw]]);
  const store: LockStore = {
    get: async (key) => memory.get(key) ?? null,
    set: async (key, value) => {
      await SecureStore.setItemAsync(key, value, OPTIONS);
      memory.set(key, value);
    },
    del: async (key) => {
      memory.delete(key);
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        /* el ensayo ya se comprobó */
      }
    },
  };
  await migrateSealedValue(store, WALLET_KEY, `${WALLET_KEY}:next`, oldKeys, newWrap);
}

export async function rewrapWalletWithNewKey(rotatePin: () => Promise<string>): Promise<void> {
  const current = await readStored();
  await rotatePin();
  if (current) {
    await persistRecord(current);
  }
}

function writeProvider() {
  return createWriteProvider(NETWORK_CONFIG.chainId, NETWORK_CONFIG.chainName);
}

function toConnectedWallet(privateKey: string): HDNodeWallet | Wallet {
  return new Wallet(privateKey).connect(writeProvider());
}

/** Reconecta un signer ya cargado al RPC del mundo activo (Demo testnet / Real mainnet). */
export function withCurrentRpc(wallet: HDNodeWallet | Wallet): HDNodeWallet | Wallet {
  return wallet.connect(writeProvider()) as HDNodeWallet | Wallet;
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

export function isValidSecretPhrase(phrase: string): boolean {
  const normalized = normalizePhrase(phrase);
  const words = normalized.split(' ');
  if (words.length !== 12 && words.length !== 24) return false;
  try {
    return Mnemonic.isValidMnemonic(normalized);
  } catch {
    return false;
  }
}

export async function loadAppWallet(): Promise<HDNodeWallet | Wallet | null> {
  const stored = await readStored();
  if (!stored) return null;
  return toConnectedWallet(stored.privateKey);
}

export async function createAppWallet(): Promise<HDNodeWallet> {
  const claimed = await lookupBoundWalletOnThisDevice();
  if (claimed.status === 'wallet' || claimed.status === 'unknown') {
    throw new Error(claimed.status === 'unknown' ? 'store-unknown' : 'device-bound');
  }
  const created = createTwentyFourWordWallet();
  await writeStored({
    address: created.address.toLowerCase(),
    privateKey: created.privateKey,
    mnemonic: created.mnemonic?.phrase,
  });
  await SecureStore.deleteItemAsync(PHRASE_ACK_KEY).catch(() => {});
  return created.connect(writeProvider()) as HDNodeWallet;
}

export async function ensureAppWallet(): Promise<HDNodeWallet | Wallet> {
  const existing = await loadAppWallet();
  if (existing) {
    try {
      await bindAppWallet(existing.address);
    } catch {
      reportLockFault();
    }
    return existing;
  }
  if (!getWalletWrapKey()) {
    throw new Error('locked');
  }
  if (await readRawWallet()) {
    throw new Error('locked');
  }
  throw new Error('missing');
}

export async function wipeAppWallet(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WALLET_FALLBACK);
  } catch {
    // ignore
  }
  try {
    await SecureStore.deleteItemAsync(WALLET_KEY);
  } catch {
    // ignore
  }
  try {
    await SecureStore.deleteItemAsync(PHRASE_ACK_KEY);
  } catch {
    // ignore
  }
  await clearBoundWallet();
}

function createTwentyFourWordWallet(): HDNodeWallet {
  const mnemonic = Mnemonic.fromEntropy(randomBytes(32));
  return HDNodeWallet.fromMnemonic(mnemonic);
}

/** Genera 24 palabras sin guardarlas. Se persisten al poner usuario y contraseña. */
export function generateSecretPhrase(): { phrase: string; address: string } {
  const created = createTwentyFourWordWallet();
  const phrase = created.mnemonic?.phrase;
  if (!phrase) {
    throw new Error('phrase');
  }
  return { phrase: normalizePhrase(phrase), address: created.address.toLowerCase() };
}

export function addressFromPhrase(phrase: string): string {
  const normalized = normalizePhrase(phrase);
  if (!isValidSecretPhrase(normalized)) {
    throw new Error('phrase');
  }
  return HDNodeWallet.fromPhrase(normalized).address.toLowerCase();
}

export async function importFromPhrase(
  phrase: string,
  options: { markBackedUp?: boolean } = {}
): Promise<HDNodeWallet> {
  const normalized = normalizePhrase(phrase);
  if (!isValidSecretPhrase(normalized)) {
    throw new Error('phrase');
  }
  const imported = HDNodeWallet.fromPhrase(normalized);
  const next = imported.address.toLowerCase();
  await assertRestoreFitsThisDevice(next);
  await writeStored({
    address: next,
    privateKey: imported.privateKey,
    mnemonic: imported.mnemonic?.phrase || normalized,
  });
  if (options.markBackedUp !== false) {
    await markPhraseBackedUp();
  }
  return imported.connect(writeProvider()) as HDNodeWallet;
}

export async function getSecretPhrase(): Promise<string | null> {
  const stored = await readStored();
  return stored?.mnemonic ? normalizePhrase(stored.mnemonic) : null;
}

export async function hasSecretPhrase(): Promise<boolean> {
  return Boolean(await getSecretPhrase());
}

export async function isPhraseBackedUp(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PHRASE_ACK_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markPhraseBackedUp(): Promise<void> {
  await SecureStore.setItemAsync(PHRASE_ACK_KEY, '1', OPTIONS);
}

async function cobrarGasPlataforma(
  _signer: Signer,
  _tokenTransfer: boolean,
  _extraWei = 0n,
  _followUp = false
): Promise<bigint> {
  // El protocolo no cobra gas en ETH. El fundador cobra LUSD dentro del contrato.
  return 0n;
}

export async function cobrarComisionIntermediario(signer: Signer, tokenTransfer = true) {
  return cobrarGasPlataforma(signer, tokenTransfer, 0n, true);
}

export async function enviarToken(
  signer: Signer,
  tokenAddress: string,
  to: string,
  amountWei: string,
  skipPlatformFee = false
) {
  if (!isHexAddress(to)) throw new Error('address');
  assertAmount(amountWei);
  if (!skipPlatformFee) {
    await cobrarGasPlataforma(signer, true, 0n, true);
  }
  const token = new Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await token.transfer(to, amountWei);
  return tx.wait();
}

export async function enviarBnb(
  signer: Signer,
  to: string,
  amountWei: string,
  skipPlatformFee = false
) {
  if (!isHexAddress(to)) throw new Error('address');
  assertAmount(amountWei);
  if (!skipPlatformFee) {
    await cobrarGasPlataforma(signer, false, BigInt(amountWei), true);
  }
  const tx = await signer.sendTransaction({ to, value: amountWei });
  return tx.wait();
}

function assertAmount(amountWei: string) {
  if (!isAllowedWei(amountWei)) {
    throw new Error('invalid-amount');
  }
}
