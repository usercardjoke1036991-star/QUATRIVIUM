import { FallbackProvider, JsonRpcProvider, isAddress, type AbstractProvider } from 'ethers';
import { isHttpsUrl } from '../utils/sanitize';
import { ARBITRUM_MAINNET, ARBITRUM_SEPOLIA, ZERO_ADDRESS } from './bsc';
import { DEPLOYED_MAINNET, DEPLOYED_TESTNET } from './deployedAddresses';

export type AppMode = 'demo' | 'live';

const envRaw = (process.env.EXPO_PUBLIC_APP_ENV || '').trim().toLowerCase();
const chainRaw = Number.parseInt(process.env.EXPO_PUBLIC_CHAIN_ID || '', 10);

export function isStoreProduction(): boolean {
  return envRaw === 'production';
}

function defaultMode(): AppMode {
  if (isStoreProduction() || chainRaw === ARBITRUM_MAINNET.chainId) return 'live';
  return 'demo';
}

let runtimeMode: AppMode = 'live';
let productMode: AppMode = 'live';
const modeListeners = new Set<() => void>();

export function getRuntimeMode(): AppMode {
  return runtimeMode;
}

/** Red de prueba (RPC testnet). No es lo mismo que la cuenta demo. */
export function isDemoMode(): boolean {
  return runtimeMode === 'demo';
}

/** Cuenta demo elegida en Ajustes. El mundo Real usa mainnet y no hereda el estado de Demo. */
export function isDemoAccount(): boolean {
  return productMode === 'demo';
}

/** Crédito on-chain listo en el mundo activo (testnet en Demo, mainnet en Real). */
export function isCreditReady(): boolean {
  if (productMode === 'live' && runtimeMode !== 'live') return false;
  if (productMode === 'demo' && runtimeMode !== 'demo') return false;
  return isContractConfigured(productMode === 'live' ? 'mainnet' : 'testnet');
}

/** Donar se ve en Cuenta Real. Demo no dona. */
export function donationVisibleInWorld(product: AppMode, runtime: AppMode): boolean {
  return product === 'live' && runtime === 'live';
}

/** Enviar donación: solo Real con contrato mainnet. El destino es la billetera personal del fundador. */
export function donationAllowedInWorld(
  product: AppMode,
  runtime: AppMode,
  mainnetReady: boolean
): boolean {
  return donationVisibleInWorld(product, runtime) && mainnetReady;
}

export function isDonationVisible(): boolean {
  return donationVisibleInWorld(productMode, runtimeMode);
}

export function isDonationEnabled(): boolean {
  return donationAllowedInWorld(productMode, runtimeMode, isContractConfigured('mainnet'));
}

/** El acceso viejo (2 USDT) es solo Cuenta Real con mainnet. Con Alta, el cobro lo decide isAltaConfigured. */
export function accessPaymentAllowedInWorld(
  product: AppMode,
  runtime: AppMode,
  mainnetReady: boolean
): boolean {
  if (product === 'demo') return false;
  return donationAllowedInWorld(product, runtime, mainnetReady);
}

export function isAccessPaymentEnabled(): boolean {
  return accessPaymentAllowedInWorld(productMode, runtimeMode, isContractConfigured('mainnet'));
}

export function getProductMode(): AppMode {
  return productMode;
}

export function setProductMode(mode: AppMode): void {
  productMode = mode === 'demo' ? 'demo' : 'live';
}

export function subscribeRuntimeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

export function resetRpcCache(): void {
  cachedProvider = null;
  lastRpcCheck = 0;
}

export function setRuntimeMode(mode: AppMode): void {
  if (runtimeMode === mode) return;
  runtimeMode = mode;
  resetRpcCache();
  modeListeners.forEach((listener) => listener());
}

export const APP_ENV =
  envRaw === 'production' || envRaw === 'development'
    ? envRaw
    : defaultMode() === 'live'
      ? 'production'
      : 'development';

export const NETWORK_CONFIG = {
  get chainId() {
    return runtimeMode === 'live' ? ARBITRUM_MAINNET.chainId : ARBITRUM_SEPOLIA.chainId;
  },
  get chainName() {
    return runtimeMode === 'live' ? ARBITRUM_MAINNET.chainName : ARBITRUM_SEPOLIA.chainName;
  },
};

function usableRpc(url: string | undefined): url is string {
  if (!url || !/^https:\/\//i.test(url)) return false;
  if (/rpc\.ankr\.com/i.test(url) && !/rpc\.ankr\.com\/[^/]+\/[A-Za-z0-9]/i.test(url)) return false;
  return true;
}

const DEMO_RPCS = [
  process.env.EXPO_PUBLIC_ARBITRUM_SEPOLIA_RPC_PRIMARY,
  process.env.EXPO_PUBLIC_ARBITRUM_RPC_URL_PRIMARY,
  process.env.EXPO_PUBLIC_ARBITRUM_RPC_URL_FALLBACK_1,
  process.env.EXPO_PUBLIC_ARBITRUM_RPC_URL_FALLBACK_2,
  ...ARBITRUM_SEPOLIA.rpc,
].filter(usableRpc);

const LIVE_RPCS = [
  process.env.EXPO_PUBLIC_ARBITRUM_MAINNET_RPC_PRIMARY,
  ...ARBITRUM_MAINNET.rpc,
].filter(usableRpc);

export const RPC_URLS = {
  get primary() {
    const list = runtimeMode === 'live' ? LIVE_RPCS : DEMO_RPCS;
    return list[0];
  },
  get fallback1() {
    const list = runtimeMode === 'live' ? LIVE_RPCS : DEMO_RPCS;
    return list[1] || list[0];
  },
  get fallback2() {
    const list = runtimeMode === 'live' ? LIVE_RPCS : DEMO_RPCS;
    return list[2] || list[1] || list[0];
  },
};

export const CONTRACT_ADDRESSES = {
  mainnet:
    process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET || DEPLOYED_MAINNET.contract || ZERO_ADDRESS,
  // Demo sigue existiendo en el APK de tienda: mundos aislados, no se mezcla con Real.
  testnet:
    process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET || DEPLOYED_TESTNET.contract || ZERO_ADDRESS,
};

export function getActiveContractNetwork(): 'mainnet' | 'testnet' {
  return runtimeMode === 'live' ? 'mainnet' : 'testnet';
}

/** Los RPC públicos de la red activa. Sin clave de proveedor. */
export function publicRpcList(): string[] {
  const list = runtimeMode === 'live' ? ARBITRUM_MAINNET.rpc : ARBITRUM_SEPOLIA.rpc;
  return list.filter((url) => url.startsWith('https://') && !/[?&](?:apikey|key)=/i.test(url));
}

function uniqueHttpsRpcs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const list = runtimeMode === 'live' ? LIVE_RPCS : DEMO_RPCS;
  for (const url of [RPC_URLS.primary, RPC_URLS.fallback1, RPC_URLS.fallback2, ...list]) {
    if (!url) continue;
    const key = url.replace(/\/$/, '');
    if (!isHttpsUrl(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

let cachedProvider: AbstractProvider | null = null;
let lastRpcCheck = 0;
const RPC_CHECK_MS = 60_000;

async function quorumChainId(urls: string[], expected: number): Promise<void> {
  const votes = await Promise.all(
    urls.map(async (url) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
            signal: controller.signal,
          });
          const body = (await response.json()) as { result?: string };
          return Number.parseInt(body.result || '0', 16);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return -1;
      }
    })
  );
  const matched = votes.filter((chainId) => chainId === expected).length;
  const needed = urls.length >= 2 ? 2 : 1;
  if (matched < needed) {
    throw new Error('RPC chain mismatch: el quorum de nodos no coincide con la red configurada.');
  }
}

export const getProviderWithFallback = (): AbstractProvider => {
  if (cachedProvider) {
    return cachedProvider;
  }

  const urls = uniqueHttpsRpcs();
  if (urls.length === 0) {
    throw new Error('No RPC URL configured');
  }

  const network = { chainId: NETWORK_CONFIG.chainId, name: NETWORK_CONFIG.chainName };
  const configs = urls.map((url, index) => ({
    provider: new JsonRpcProvider(url, network, { staticNetwork: true, batchMaxCount: 1 }),
    priority: index + 1,
    weight: 1,
    stallTimeout: 2000,
  }));

  // quorum 1: un RPC basta para lecturas. El chainId ya se valida en quorumChainId().
  // Un countdown (p. ej. cooldown) nunca coincide entre 3 nodos si el default es ceil(n/2).
  cachedProvider =
    configs.length === 1
      ? configs[0].provider
      : new FallbackProvider(configs, NETWORK_CONFIG.chainId, { quorum: 1 });
  return cachedProvider;
};

function withRpcTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function assertTrustedRpc(provider?: AbstractProvider): Promise<AbstractProvider> {
  const resolved = provider || getProviderWithFallback();
  const now = Date.now();
  if (now - lastRpcCheck < RPC_CHECK_MS) return resolved;

  await quorumChainId(uniqueHttpsRpcs(), NETWORK_CONFIG.chainId);
  const network = await withRpcTimeout(resolved.getNetwork(), 8_000);
  if (Number(network.chainId) !== NETWORK_CONFIG.chainId) {
    resetRpcCache();
    throw new Error('RPC chain mismatch');
  }

  const address = getContractAddress();
  if (isContractConfigured() && isAddress(address)) {
    const code = await withRpcTimeout(resolved.getCode(address), 8_000);
    if (!code || code === '0x') {
      resetRpcCache();
      throw new Error('El RPC no ve el contrato de Quatrivium Finance en esta red.');
    }
  }

  lastRpcCheck = now;
  return resolved;
}

export const getContractAddress = (
  network: 'mainnet' | 'testnet' = getActiveContractNetwork()
): string => {
  return CONTRACT_ADDRESSES[network];
};

export const isContractConfigured = (network?: 'mainnet' | 'testnet'): boolean => {
  const net = network ?? getActiveContractNetwork();
  const address = getContractAddress(net);
  if (!address || address.toLowerCase() === ZERO_ADDRESS || !isAddress(address)) {
    return false;
  }
  // Real no está listo hasta el deploy oficial. Una dirección suelta en .env
  // no debe mandar transacciones a mainnet (revert vacío / require(false)).
  if (net === 'mainnet') {
    const official = String(DEPLOYED_MAINNET.contract || '').toLowerCase();
    if (!official || official === ZERO_ADDRESS.toLowerCase()) return false;
    return address.toLowerCase() === official;
  }
  const officialTestnet = String(DEPLOYED_TESTNET.contract || '').toLowerCase();
  if (!officialTestnet || officialTestnet === ZERO_ADDRESS.toLowerCase()) return false;
  return address.toLowerCase() === officialTestnet;
};
