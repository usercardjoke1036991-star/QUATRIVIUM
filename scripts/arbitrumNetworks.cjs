/**
 * Redes canónicas para Quatrivium Sovereign (Arbitrum One — LUSD).
 *
 * Referencia Ethereum Mainnet (chainId: 1):
 * - LUSD (18 decimales): 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0
 */
const ARBITRUM_MAINNET = {
  chainId: 42161,
  chainName: 'arbitrumOne',
  lusd: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  usdt: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  rpc: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.drpc.org',
  ],
};

const ARBITRUM_SEPOLIA = {
  chainId: 421614,
  chainName: 'arbitrumSepolia',
  usdt: '',
  rpc: [
    'https://sepolia-rollup.arbitrum.io/rpc',
    'https://arbitrum-sepolia-rpc.publicnode.com',
    'https://arbitrum-sepolia.drpc.org',
  ],
};

const ZERO = '0x0000000000000000000000000000000000000000';

function isHexAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ''));
}

function isZero(value) {
  return !isHexAddress(value) || String(value).toLowerCase() === ZERO;
}

module.exports = { ARBITRUM_MAINNET, ARBITRUM_SEPOLIA, ZERO, isHexAddress, isZero };
