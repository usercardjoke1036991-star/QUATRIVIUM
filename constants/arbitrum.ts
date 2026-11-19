/**
 * Direcciones canónicas de Arbitrum One (red soberana de Quatrivium).
 *
 * Referencia Ethereum Mainnet (chainId: 1), no usada por la app:
 *   LUSD (18 dec): 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0
 */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const ARBITRUM_MAINNET = {
  chainId: 42161,
  chainName: 'arbitrumOne',
  /** LUSD en Arbitrum One (18 decimales). Moneda única del protocolo. */
  lusd: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  /** Alias de compatibilidad: el token único del protocolo es LUSD. */
  usdt: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  rpc: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.drpc.org',
    'https://arbitrum.llamarpc.com',
    'https://1rpc.io/arb',
  ],
} as const;

export const ARBITRUM_SEPOLIA = {
  chainId: 421614,
  chainName: 'arbitrumSepolia',
  /** En Sepolia no hay LUSD oficial: se usa un mock propio desplegado por scripts. */
  usdt: '',
  rpc: [
    'https://sepolia-rollup.arbitrum.io/rpc',
    'https://arbitrum-sepolia-rpc.publicnode.com',
    'https://arbitrum-sepolia.drpc.org',
  ],
} as const;

/** Gas nativo en Arbitrum = ETH. Umbral mínimo razonable para L2 (0.0001 ETH). */
export const NATIVE_SYMBOL = 'ETH';
export const MIN_GAS_WEI = 100_000_000_000_000n;

export function isZeroAddress(value: string): boolean {
  return !value || value.toLowerCase() === ZERO_ADDRESS;
}

export function isTestnetOnlyToken(address: string): boolean {
  const needle = address.trim().toLowerCase();
  const demo = ARBITRUM_SEPOLIA.usdt.toLowerCase();
  return Boolean(demo) && needle === demo;
}
