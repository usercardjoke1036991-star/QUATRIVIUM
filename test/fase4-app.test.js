const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
require('ts-node/register');
const { ARBITRUM_MAINNET } = require('../constants/bsc.ts');
const { DEPLOYED_MAINNET } = require('../constants/deployedAddresses.ts');
const {
  altaBreakdown,
  apkIntegrity,
  interestToFounder,
  insuranceOfInflow,
  nextPublicRpc,
  nostrMayPublish,
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

  it('parte el alta en 1 LUSD al fundador y el resto al pool', function () {
    expect(altaBreakdown()).to.deep.equal({ total: 4, founder: 1, pool: 3 });
    const gate = read('components/CreditAccessGate.tsx');
    expect(gate).to.include("t('altaSplitNote')");
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.altaSplitNote).to.match(/4 LUSD/);
    expect(es.altaSplitNote).to.match(/1 LUSD/);
    expect(es.altaSplitNote).to.match(/pool/);
    expect(read('services/quatriviumCreditService.ts')).to.include('asegurarAprobacionToken');
    expect(read('services/quatriviumCreditService.ts')).to.include('pagarRegistro');
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

  it('Nostr no publica la mora', function () {
    expect(nostrMayPublish('mora')).to.equal(false);
    expect(nostrMayPublish('moroso')).to.equal(false);
    expect(nostrMayPublish('delinquency')).to.equal(false);
    expect(prepareNostrPayload('mora', 'deuda vencida')).to.equal(null);
    expect(prepareNostrPayload('message', 'aviso')).to.deep.equal({
      nip: 'NIP-17',
      body: 'aviso',
    });
    expect(prepareNostrPayload('notice', 'pago')).to.deep.equal({ nip: 'NIP-44', body: 'pago' });
  });

  it('avisa si el hash del APK no es el publicado', function () {
    const hash = 'ab'.repeat(32);
    const other = 'cd'.repeat(32);
    expect(apkIntegrity('', '')).to.equal('unpublished');
    expect(apkIntegrity(hash, hash)).to.equal('match');
    expect(apkIntegrity(hash, other)).to.equal('mismatch');
    expect(read('components/ApkIntegrityNote.tsx')).to.include("t('apkHashMismatch')");
    expect(read('contracts/QuatriviumApk.sol')).to.include('function publicar');
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

  it('no activa Expo OTA ni textos de Play Store', function () {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['expo-updates']).to.equal(undefined);
    expect(pkg.devDependencies?.['expo-updates']).to.equal(undefined);
    const app = JSON.parse(read('app.json'));
    expect(app.expo.updates).to.equal(undefined);
    expect(JSON.stringify(app)).to.not.match(/play\.google|Play Store/i);
    expect(read('i18n/legalExtras.ts')).to.not.include('Google Play');
    expect(fs.existsSync(path.join(root, 'store-assets/play-store-listing.md'))).to.equal(false);
  });
});
