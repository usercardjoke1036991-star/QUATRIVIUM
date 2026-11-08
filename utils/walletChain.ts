import type { Eip1193Provider } from 'ethers';
import { BSC_MAINNET, BSC_TESTNET } from '../constants/bsc';
import { NETWORK_CONFIG, getRuntimeMode } from '../constants/rpcConfig';
import { networkFailureError } from './txErrors';

function wrongNetwork(): Error {
  return networkFailureError(getRuntimeMode() === 'demo');
}

export function parseEvmChainId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  const asDec = Number.parseInt(text, 10);
  return Number.isFinite(asDec) ? asDec : 0;
}

export function needsWalletAddChain(error: unknown): boolean {
  const code = Number((error as { code?: number })?.code);
  return code === 4902 || code === -32603;
}

function chainAddParams(expected: number) {
  const live = expected === BSC_MAINNET.chainId || getRuntimeMode() === 'live';
  const chain = live ? BSC_MAINNET : BSC_TESTNET;
  return {
    chainId: `0x${expected.toString(16)}`,
    chainName: live ? 'Arbitrum One' : 'Arbitrum Sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [...chain.rpc],
    blockExplorerUrls: [live ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'],
  };
}

/** La billetera externa debe estar en la misma red que el mundo activo (421614 Demo, 42161 Real). */
export async function ensureExternalWalletOnAppChain(provider: Eip1193Provider): Promise<void> {
  const expected = NETWORK_CONFIG.chainId;
  let current = 0;
  try {
    current = parseEvmChainId(await provider.request({ method: 'eth_chainId' }));
  } catch {
    throw wrongNetwork();
  }
  if (!current) throw wrongNetwork();
  if (current === expected) return;

  const addParams = chainAddParams(expected);
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: addParams.chainId }],
    });
  } catch (error) {
    if (!needsWalletAddChain(error)) throw wrongNetwork();
    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [addParams],
      });
    } catch {
      throw wrongNetwork();
    }
  }

  const after = parseEvmChainId(
    await provider.request({ method: 'eth_chainId' }).catch(() => '0x0')
  );
  if (after !== expected) throw wrongNetwork();
}
