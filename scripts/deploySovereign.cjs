const { ethers } = require('hardhat');
const { getLinkedCreditFactory } = require('./linkCredit.cjs');

const ZERO = '0x0000000000000000000000000000000000000000';
const SEQUENCER_ARBITRUM_ONE = '0xFdB631F5EE196F0ed6FAa767959853A9F217697D';

function assertDeployConfig(cfg) {
  const chainId = Number(cfg.chainId);
  const founder = String(cfg.founder || '');
  const admins = cfg.admins || [];
  if (!ethers.isAddress(founder) || founder === ZERO) {
    throw new Error('La billetera del fundador es obligatoria.');
  }
  if (admins.length !== 3) {
    throw new Error('Hacen falta exactamente 3 admins.');
  }
  if (admins[0].toLowerCase() !== founder.toLowerCase()) {
    throw new Error('El primer admin es la billetera del fundador, no quien despliega.');
  }
  const feed = cfg.sequencerFeed == null ? '' : String(cfg.sequencerFeed);
  if (chainId === 42161) {
    if (cfg.confirmFounder !== 'yes') {
      throw new Error('Arbitrum One exige CONFIRM_FOUNDER_WALLET=yes.');
    }
    if (!ethers.isAddress(feed) || feed === ZERO) {
      throw new Error('Arbitrum One exige el feed del sequencer.');
    }
  } else if (chainId !== 31337 && chainId !== 421614) {
    throw new Error('Red no soportada.');
  } else if (feed && feed !== ZERO && !ethers.isAddress(feed)) {
    throw new Error('Feed del sequencer inválido.');
  }
  return {
    chainId,
    founder,
    admins,
    sequencerFeed: feed || ZERO,
    token: cfg.token,
    feeCollector: cfg.feeCollector || founder,
  };
}

async function deploySovereign(cfg) {
  const ready = assertDeployConfig(cfg);
  const signer = cfg.signer;
  const nonce = await ethers.provider.getTransactionCount(signer.address);
  const famaAddr = ethers.getCreateAddress({ from: signer.address, nonce: nonce + 1 });
  const creditAddr = ethers.getCreateAddress({ from: signer.address, nonce: nonce + 2 });
  const reservaAddr = ethers.getCreateAddress({ from: signer.address, nonce: nonce + 3 });
  const altaAddr = ethers.getCreateAddress({ from: signer.address, nonce: nonce + 4 });

  const factory = await getLinkedCreditFactory(ethers);
  const Fama = await ethers.getContractFactory('QuatriviumFamaCaja', signer);
  const fama = await Fama.deploy(ready.token, creditAddr, altaAddr, reservaAddr);
  await fama.waitForDeployment();
  const credit = await factory
    .connect(signer)
    .deploy(ready.token, ready.admins, await fama.getAddress(), ready.sequencerFeed);
  await credit.waitForDeployment();
  const Reserva = await ethers.getContractFactory('QuatriviumReserva', signer);
  const reserva = await Reserva.deploy(
    ready.token,
    ready.founder,
    creditAddr,
    famaAddr,
    altaAddr,
    ready.admins
  );
  await reserva.waitForDeployment();
  const Alta = await ethers.getContractFactory('QuatriviumAlta', signer);
  const alta = await Alta.deploy(ready.token, creditAddr, reservaAddr);
  await alta.waitForDeployment();
  const Apk = await ethers.getContractFactory('QuatriviumApk', signer);
  const apk = await Apk.deploy(ready.founder);
  await apk.waitForDeployment();

  if ((await fama.getAddress()).toLowerCase() !== famaAddr.toLowerCase()) {
    throw new Error('la dirección de fama no coincide');
  }
  if ((await credit.getAddress()).toLowerCase() !== creditAddr.toLowerCase()) {
    throw new Error('la dirección de Credit no coincide');
  }
  return { credit, fama, reserva, alta, apk, sequencerFeed: ready.sequencerFeed };
}

module.exports = { assertDeployConfig, deploySovereign, SEQUENCER_ARBITRUM_ONE, ZERO };
