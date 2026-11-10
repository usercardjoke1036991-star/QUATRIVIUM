const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
require('ts-node/register');
const { ARBITRUM_MAINNET } = require('../constants/bsc.ts');
const { DEPLOYED_MAINNET } = require('../constants/deployedAddresses.ts');
const {
  altaBreakdown,
  apkCertCheck,
  apkCheck,
  apkIntegrity,
  interestToFounder,
  insuranceOfInflow,
  nextNostrRelay,
  nextPublicRpc,
  nostrRelays,
  nostrMayPublish,
  nostrPrivateReady,
  prepareNostrPayload,
  RESERVA_LOCK_DAYS,
  RESERVA_MAX_APY_BP,
  RESERVA_MIN_LEVEL,
} = require('../utils/sovereignSurface.ts');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Fase 4 — app soberana', function () {
  it('pasa al siguiente RPC público y no guarda claves de proveedor', function () {
    const urls = ARBITRUM_MAINNET.rpc;
    expect(urls.length).to.be.greaterThan(2);
    for (const url of urls) {
      expect(url.startsWith('https://')).to.equal(true);
      expect(url).to.not.match(/\/[A-Za-z0-9]{20,}/);
    }
    expect(nextPublicRpc(urls, urls[0])).to.equal(urls[1]);
    expect(nextPublicRpc(urls, urls[urls.length - 1])).to.equal(null);
    expect(read('constants/rpcConfig.ts')).to.include('FallbackProvider');
  });

  it('deja las direcciones de contrato vacías y fija LUSD de Arbitrum One', function () {
    expect(DEPLOYED_MAINNET.chainId).to.equal(42161);
    expect(DEPLOYED_MAINNET.usdt.toLowerCase()).to.equal(
      '0x93b346b6bc2548da6a1e7d98e9a421b42541425b'
    );
    expect(ARBITRUM_MAINNET.lusd.toLowerCase()).to.equal(DEPLOYED_MAINNET.usdt.toLowerCase());
    for (const field of ['contract', 'reserva', 'fama', 'alta']) {
      expect(DEPLOYED_MAINNET[field], field).to.equal('');
    }
    expect(read('constants/bsc.ts')).to.not.include('AggregatorV3');
  });

  it('parte el alta en fundador, Reserva, padrino y sello', async function () {
    expect(altaBreakdown()).to.deep.equal({
      total: 4,
      founder: 1,
      reserva: 1,
      padrino: 1,
      seal: 1,
    });
    const { deployProtocol } = require('./helpers.cjs');
    const { ethers } = require('hardhat');
    const ctx = await deployProtocol();
    const { token, contract, reserva, alta, owner, user } = ctx;
    await token.mint(user.address, ethers.parseUnits('8', 18));
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    const founderBefore = await token.balanceOf(owner.address);
    await alta.connect(user).pagarRegistro();
    const uno = ethers.parseUnits('1', 18);
    expect((await token.balanceOf(owner.address)) - founderBefore).to.equal(uno);
    expect(await reserva.bote()).to.equal(uno);
    expect(await alta.padrinoApartado(user.address)).to.equal(uno);
    expect(await contract.fondoSeguro(await token.getAddress())).to.equal(uno / 20n);
    expect(await contract.totalLiquidity(await token.getAddress())).to.equal(uno - uno / 20n);
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.altaSplitNote).to.match(/4 LUSD/);
    expect(es.altaSplitNote).to.match(/Reserva/);
    expect(es.altaSplitNote).to.match(/pool/);
    expect(es.altaSplitNote).to.not.match(/resto entra al pool/);
  });

  it('muestra el 15 % del fundador, el 5 % del seguro y la gracia de 48 h', function () {
    expect(interestToFounder(1)).to.equal(0.15);
    expect(insuranceOfInflow(1)).to.equal(0.05);
    const card = read('components/LoanTierCard.tsx');
    expect(card).to.include("t('loanFounderShare')");
    expect(card).to.include("t('loanInsuranceShare')");
    expect(card).to.include("t('loanSequencerGrace')");
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.loanFounderShare).to.match(/15/);
    expect(es.loanInsuranceShare).to.match(/5/);
    expect(es.loanSequencerGrace).to.match(/48/);
    expect(es.loanSequencerGrace.toLowerCase()).to.match(/arbitrum/);
  });

  it('avisa que el rendimiento de Reserva depende del bote y el capital vuelve', function () {
    expect(RESERVA_LOCK_DAYS).to.equal(30);
    expect(RESERVA_MIN_LEVEL).to.equal(10);
    expect(RESERVA_MAX_APY_BP).to.equal(1200);
    expect(read('components/ReservaSection.tsx')).to.include("t('reservaPotDepends')");
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.reservaPotDepends).to.match(/bote/i);
    expect(es.reservaPotDepends).to.match(/capital/i);
    expect(es.reservaLead).to.match(/30/);
    expect(es.reservaNeedLevel).to.match(/10/);
  });

  it('la billetera interna cifra la frase y WalletConnect queda opcional', function () {
    const wallet = read('services/appWallet.ts');
    expect(wallet).to.include('expo-secure-store');
    expect(wallet).to.include('createAppWallet');
    expect(wallet).to.include('importFromPhrase');
    expect(wallet).to.include('getSecretPhrase');
    expect(read('app/index.tsx')).to.include('useAppWallet');
    expect(read('utils/openWalletConnect.ts')).to.be.a('string');
  });

  it('programa avisos locales y no pide push remoto', function () {
    const hook = read('hooks/useLoanPaymentReminders.ts');
    expect(hook).to.include('scheduleNotificationAsync');
    expect(hook).to.not.include('getExpoPushToken');
    expect(hook).to.not.include('https://');
  });

  it('Nostr releva relés públicos y no publica la mora', function () {
    const relays = nostrRelays();
    expect(relays.length).to.be.at.least(5);
    expect(nextNostrRelay(relays[0])).to.equal(relays[1]);
    expect(nextNostrRelay(relays[relays.length - 1])).to.equal(null);
    const custom = relays.map((url, index) => `wss://alt${index}.example`);
    expect(nostrRelays(custom)[0]).to.equal(custom[0]);
    expect(nostrPrivateReady()).to.equal(false);
    expect(nostrMayPublish('mora')).to.equal(false);
    expect(nostrMayPublish('message')).to.equal(false);
    expect(nostrMayPublish('notice')).to.equal(false);
    expect(prepareNostrPayload('mora', 'deuda vencida')).to.equal(null);
    expect(prepareNostrPayload('message', 'aviso privado')).to.equal(null);
    expect(prepareNostrPayload('notice', 'pago')).to.equal(null);
  });

  it('avisa versión no verificada o hash distinto del APK', function () {
    const hash = 'ab'.repeat(32);
    const other = 'cd'.repeat(32);
    expect(apkCheck({ registryEmpty: true, localHash: hash, publishedHash: hash })).to.equal(
      'unverified'
    );
    expect(apkCheck({ readFailed: true, localHash: hash, publishedHash: hash })).to.equal(
      'unverified'
    );
    expect(apkCheck({ publishedHash: '' })).to.equal('unverified');
    expect(apkCheck({ localHash: hash, publishedHash: other })).to.equal('mismatch');
    expect(apkCheck({ localHash: hash, publishedHash: hash })).to.equal('match');
    expect(apkCertCheck({ registryEmpty: true, localCert: hash, publishedCert: hash })).to.equal(
      'unverified'
    );
    expect(apkCertCheck({ readFailed: true, localCert: hash, publishedCert: hash })).to.equal(
      'unverified'
    );
    expect(apkCertCheck({ publishedCert: '' })).to.equal('unverified');
    expect(apkCertCheck({ localCert: hash, publishedCert: other })).to.equal('mismatch');
    expect(apkCertCheck({ localCert: hash, publishedCert: hash })).to.equal('match');
    expect(apkIntegrity('', '')).to.equal('unpublished');
    const note = read('components/ApkIntegrityNote.tsx');
    expect(note).to.include("t('apkUnverified')");
    expect(note).to.include("t('apkHashMismatch')");
    expect(read('contracts/QuatriviumApk.sol')).to.include('function publicar');
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.apkUnverified.toLowerCase()).to.match(/no verificada/);
  });

  it('arma el mismo leaderboard para todos a partir de los eventos de la cadena', function () {
    const { rosterFromSignupEvents } = require('../utils/fameRoster.ts');
    const first = '0x0000000000000000000000000000000000000001';
    const second = '0x0000000000000000000000000000000000000002';
    const third = '0x0000000000000000000000000000000000000003';
    const events = [
      { blockNumber: 2, index: 1, usuario: second, padre: first },
      { blockNumber: 1, index: 0, usuario: third, padre: first },
    ];
    const left = rosterFromSignupEvents(events);
    const right = rosterFromSignupEvents(events.slice().reverse());
    expect(left.order.map((item) => item.toLowerCase())).to.deep.equal(
      right.order.map((item) => item.toLowerCase())
    );
    expect(left.referrals.get(first.toLowerCase())).to.equal(2);
    const source = read('services/fameLeaderboard.ts');
    expect(source).to.include('queryFilter');
    expect(source).to.include('AfiliadoRegistrado');
    expect(source).to.include('obtenerHistorialUsuario');
    expect(source).to.not.include('players.json');
  });

  it('la pantalla de admins lee el estado y deja las acciones a las billeteras admin', function () {
    const home = read('app/index.tsx');
    expect(home).to.include('<AdminStatusReadout');
    expect(home).to.include('showAdminControls');
    const panel = read('components/AdminPanel.tsx');
    expect(panel).to.include('if (!isOwner && !isAdmin) return null');
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.adminStatusLead).to.match(/72/);
    expect(es.adminTimelockHours).to.match(/\{hours\}/);
  });

  it('todas las claves nuevas existen en los 17 idiomas', function () {
    const langs = fs
      .readdirSync(path.join(root, 'i18n/locales'))
      .filter((name) => name.endsWith('.json'));
    expect(langs.length).to.equal(17);
    const needed = [
      'altaSplitNote',
      'loanFounderShare',
      'loanInsuranceShare',
      'loanSequencerGrace',
      'reservaPotDepends',
      'apkHashMismatch',
      'apkUnverified',
      'adminStatusLead',
      'adminPauseOn',
      'adminPauseOff',
      'adminTimelockHours',
    ];
    const en = JSON.parse(read('i18n/locales/en.json'));
    for (const lang of langs) {
      const pack = JSON.parse(read(`i18n/locales/${lang}`));
      for (const key of needed) {
        expect(typeof pack[key], `${lang}.${key}`).to.equal('string');
        expect(String(pack[key]).trim().length, `${lang}.${key}`).to.be.greaterThan(0);
        expect(pack[key].includes('{hours}')).to.equal(en[key].includes('{hours}'));
      }
    }
  });

  it('no activa descargas remotas de la app', function () {
    const app = JSON.parse(read('app.json'));
    expect(app.expo.updates).to.equal(undefined);
    const shots = fs
      .readdirSync(path.join(root, 'store-assets'))
      .filter((name) => /\.(png|jpg|webp)$/i.test(name));
    expect(shots).to.deep.equal([]);
  });
});
