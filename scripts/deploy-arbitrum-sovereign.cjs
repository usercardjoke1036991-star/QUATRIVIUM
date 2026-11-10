/**
 * Único despliegue del protocolo. Valida todo antes de la librería.
 * Arbitrum One exige CONFIRM_MAINNET=yes y CONFIRM_FOUNDER_WALLET=yes.
 * No se ejecuta solo: el test local llama a deploySovereign.
 */
const { deploySovereign, SEQUENCER_ARBITRUM_ONE } = require('./deploySovereign.cjs');
const { ethers, network } = require('hardhat');

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId === 42161 && process.env.CONFIRM_MAINNET !== 'yes') {
    throw new Error('Arbitrum One exige CONFIRM_MAINNET=yes.');
  }
  if (chainId === 42161 && process.env.CONFIRM_FOUNDER_WALLET !== 'yes') {
    throw new Error('Arbitrum One exige CONFIRM_FOUNDER_WALLET=yes.');
  }
  const [deployer] = await ethers.getSigners();
  const founder = process.env.FOUNDER_ADDRESS || deployer.address;
  const admins = (process.env.ADMINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const feed =
    chainId === 42161 ? process.env.SEQUENCER_FEED || SEQUENCER_ARBITRUM_ONE : process.env.SEQUENCER_FEED || null;
  await deploySovereign({
    chainId,
    signer: deployer,
    founder,
    admins: admins.length ? admins : [founder, process.env.ADMIN_2, process.env.ADMIN_3],
    sequencerFeed: feed,
    token: process.env.LUSD_ADDRESS,
    confirmFounder: process.env.CONFIRM_FOUNDER_WALLET,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { main };
void network;
