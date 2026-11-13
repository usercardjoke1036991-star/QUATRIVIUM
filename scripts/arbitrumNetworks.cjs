/**
 * Redes canónicas para Quatrivium Sovereign (Arbitrum One — LUSD).
 *
 * Referencia Ethereum Mainnet (chainId: 1):
 * - LUSD (18 decimales): 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0
 * - Chainlink LUSD/USD:  0x3D7aE7E594f2f2091Ad8798313450130d0Aba3a0
 */
const ARBITRUM_MAINNET = {
  chainId: 42161,
  chainName: 'arbitrumOne',
  lusd: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  lusdUsdFeed: '0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF',
  usdt: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  usdtUsdFeed: '0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF',
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
  usdtUsdFeed: '',
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
