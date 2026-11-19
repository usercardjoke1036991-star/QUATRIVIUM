require('dotenv').config();
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

function accountsFromEnv() {
  const key = process.env.PRIVATE_KEY || '';
  const hex = key.startsWith('0x') ? key.slice(2) : key;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return ['0x' + hex];
  }
  return [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      metadata: { bytecodeHash: 'none', appendCBOR: false },
      // Quita los strings de require() del bytecode para caber en EIP-170.
      // Los tests no pueden usar revertedWith('mensaje'); sí custom errors de OZ.
      debug: { revertStrings: 'strip' },
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
      blockGasLimit: 100_000_000,
    },
    arbitrumOne: {
      url:
        process.env.ARBITRUM_ONE_RPC_URL ||
        process.env.ARBITRUM_MAINNET_RPC_URL ||
        'https://arb1.arbitrum.io/rpc',
      chainId: 42161,
      accounts: accountsFromEnv(),
      timeout: 180000,
    },
    arbitrumSepolia: {
      url:
        process.env.ARBITRUM_SEPOLIA_RPC_URL ||
        process.env.ARBITRUM_TESTNET_RPC_URL ||
        'https://sepolia-rollup.arbitrum.io/rpc',
      chainId: 421614,
      accounts: accountsFromEnv(),
    },
  },
  paths: {
    sources: './contracts',
  },
};
