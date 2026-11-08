import '@walletconnect/react-native-compat';

import React, { useEffect, type ReactNode } from 'react';
import { createAppKit, AppKitProvider, type AppKitNetwork } from '@reown/appkit-react-native';
import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import { BrowserProvider, type Eip1193Provider, type Signer } from 'ethers';
import { appKitStorage } from './utils/appKitStorage';
import {
  NETWORK_CONFIG,
  RPC_URLS,
  getRuntimeMode,
  subscribeRuntimeMode,
} from './constants/rpcConfig';
import { ARBITRUM_MAINNET, ARBITRUM_SEPOLIA } from './constants/bsc';

const PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

if (!PROJECT_ID && __DEV__) {
  console.warn(
    'Falta EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID en .env. La conexión de billetera no funcionará hasta configurarlo.'
  );
}

function arbitrumAppKitNetwork(live: boolean): AppKitNetwork {
  const chain = live ? ARBITRUM_MAINNET : ARBITRUM_SEPOLIA;
  const rpcs = live ? ARBITRUM_MAINNET.rpc : ARBITRUM_SEPOLIA.rpc;
  return {
    id: chain.chainId,
    name: live ? 'Arbitrum One' : 'Arbitrum Sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [...rpcs] as readonly string[] },
    },
    blockExplorers: {
      default: {
        name: live ? 'Arbiscan' : 'Arbiscan Sepolia',
        url: live ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io',
      },
    },
    chainNamespace: 'eip155',
    caipNetworkId: `eip155:${chain.chainId}`,
  };
}

const arbitrumMainnetNetwork = arbitrumAppKitNetwork(true);
const arbitrumSepoliaNetwork = arbitrumAppKitNetwork(false);

const metadata = {
  name: 'Quatrivium Finance',
  description: 'Protocolo DeFi soberano de microcréditos en Arbitrum One (LUSD)',
  url: 'https://quatriviumcredit.app',
  icons: ['https://quatriviumcredit.app/icon.png'],
  redirect: {
    native: 'quatrivium-sovereign://',
    universal: 'https://quatriviumcredit.app',
  },
};

type AppKitInstance = ReturnType<typeof createAppKit>;

let appKitSingleton: AppKitInstance | null = null;

function getAppKit(): AppKitInstance {
  if (appKitSingleton) return appKitSingleton;
  const live = getRuntimeMode() === 'live';
  appKitSingleton = createAppKit({
    projectId: PROJECT_ID || (__DEV__ ? 'missing-project-id' : ''),
    metadata,
    networks: [arbitrumMainnetNetwork, arbitrumSepoliaNetwork],
    defaultNetwork: live ? arbitrumMainnetNetwork : arbitrumSepoliaNetwork,
    adapters: [new EthersAdapter()],
    storage: appKitStorage,
    themeMode: 'light',
    themeVariables: {
      accent: '#007AFF',
    },
    enableAnalytics: false,
    debug: false,
    features: {
      swaps: false,
      onramp: false,
      socials: false,
    },
  });
  return appKitSingleton;
}

export async function syncAppKitNetwork(): Promise<void> {
  const kit = appKitSingleton as {
    switchNetwork?: (network: AppKitNetwork) => Promise<unknown> | unknown;
  } | null;
  if (!kit?.switchNetwork) return;
  const next = getRuntimeMode() === 'live' ? arbitrumMainnetNetwork : arbitrumSepoliaNetwork;
  try {
    await Promise.resolve(kit.switchNetwork(next));
  } catch {
    // Si AppKit no cambia, ensureExternalWalletOnAppChain pide la red correcta al firmar.
  }
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const kit = getAppKit();

  useEffect(
    () =>
      subscribeRuntimeMode(() => {
        void syncAppKitNetwork();
      }),
    [kit]
  );

  return <AppKitProvider instance={kit}>{children}</AppKitProvider>;
}

export function toEthersWeb3Provider(eip1193Provider: Eip1193Provider) {
  return new BrowserProvider(eip1193Provider, NETWORK_CONFIG.chainId);
}

export async function getEthersSignerFromProvider(
  eip1193Provider: Eip1193Provider
): Promise<Signer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const signer = toEthersWeb3Provider(eip1193Provider).getSigner();
    return await Promise.race([
      signer,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('tx-timeout')), 45_000);
      }),
    ]);
  } catch (error) {
    if (__DEV__) console.log('Error getting signer from provider:', error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const web3ConfigDebug = {
  projectId: PROJECT_ID,
  rpcUrls: RPC_URLS,
  chainId: NETWORK_CONFIG.chainId,
};
