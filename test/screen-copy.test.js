const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function locale(lang) {
  return JSON.parse(read(path.join('i18n', 'locales', `${lang}.json`)));
}

/** Frases que el producto ya descartó. El préstamo de 1 USDT y el padrino no entran. */
const OBSOLETE =
  /pagas entero|pago entero|alta de [12] USDT|acceso de [12] USDT|[12] USDT de acceso|one-time [12] USDT access|a single [12] USDT access/i;

const SCREENS = [
  'App.js',
  'app/index.tsx',
  'components/BrandSplash.tsx',
  'components/CreditAccessGate.tsx',
  'components/CreditAccessBanner.tsx',
  'components/PoolSupportSection.tsx',
  'components/ReservaSection.tsx',
];

function withoutNegation(text) {
  return String(text || '')
    .replace(/no se puede retirar/gi, '')
    .replace(/no se retira/gi, '')
    .replace(/cannot be withdrawn/gi, '')
    .replace(/is not withdrawn/gi, '')
    .replace(/not withdrawn/gi, '');
}

describe('copy de pantallas clave', function () {
  it('el splash sigue siendo la entrada de marca', function () {
    const app = read('App.js');
    const splash = read('components/BrandSplash.tsx');
    expect(app).to.include('<BrandSplash />');
    expect(app).to.include('<BrandSplash tagline={');
    expect(app).to.not.include('wordmark={false}');
    expect(splash).to.include('wordmark = true');
    expect(splash).to.include('QUATRIVIUM');
    expect(splash).to.include('FINANCE');
    const es = locale('es');
    const en = locale('en');
    expect(es.splashTagline).to.match(/Arbitrum One/);
    expect(en.splashTagline).to.match(/Arbitrum One/);
    expect(es.splashTagline).to.not.match(OBSOLETE);
    expect(en.splashTagline).to.not.match(OBSOLETE);
  });

  it('el alta en pantalla dice 4 LUSD y usa esas claves', function () {
    const gate = read('components/CreditAccessGate.tsx');
    const banner = read('components/CreditAccessBanner.tsx');
    const home = read('app/index.tsx');
    const alta = read('constants/altaConfig.ts');
    expect(alta).to.match(/export const CREDIT_ALTA_USDT = 4;/);
    expect(gate).to.include("t('creditAccessLead')");
    expect(gate).to.include("'creditAccessGateLead'");
    expect(gate).to.include("'creditAccessAlreadyInWallet'");
    expect(banner).to.include("t('creditAccessGateLead')");
    expect(banner).to.include("t('creditAccessAlreadyInWallet')");
    expect(home).to.include("lead={t('creditAccessLead')}");
    for (const lang of ['es', 'en']) {
      const copy = locale(lang);
      for (const key of [
        'creditAccessLead',
        'creditAccessGateLead',
        'creditAccessAlreadyInWallet',
        'identityNeedAccess',
      ]) {
        expect(copy[key], `${lang}.${key}`).to.match(/4\s*-?\s*LUSD/);
        expect(copy[key], `${lang}.${key}`).to.not.match(/\b[12]\s*-?\s*LUSD\b/);
      }
    }
  });

  it('el home y sus pantallas no repiten el alta vieja ni el pago entero', function () {
    for (const file of SCREENS) {
      expect(read(file), file).to.not.match(OBSOLETE);
    }
    for (const lang of ['es', 'en']) {
      expect(JSON.stringify(locale(lang)), lang).to.not.match(OBSOLETE);
    }
  });

  it('aportar al fondo no ofrece retirar del pool', async function () {
    const { ethers } = require('hardhat');
    const { deployProtocol, seedPool } = require('./helpers.cjs');
    const { token, contract, owner, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await expect(contract.connect(owner).retirarLiquidez(tokenAddr, ethers.parseUnits('1', 18))).to
      .be.reverted;
    const pool = read('components/PoolSupportSection.tsx');
    const home = read('app/index.tsx');
    expect(pool).to.include("t('poolPublicLead')");
    expect(pool).to.include("t('poolLockedNote')");
    expect(pool).to.include('onDepositPool');
    expect(pool).to.not.include('retirarLiquidez');
    expect(pool).to.not.include('onWithdraw');
    expect(pool).to.not.include("t('amountWithdraw')");
    expect(home).to.include('onDepositPool={');
    const es = locale('es');
    const en = locale('en');
    expect(es.poolPublicLead).to.match(/no se puede retirar/i);
    expect(es.sectionPoolLead).to.match(/no se puede retirar/i);
    expect(es.poolLockedNote).to.match(/no se retira/i);
    expect(es.supportPoolBenefit).to.match(/no se retira/i);
    expect(es.depositPool).to.match(/aportar/i);
    expect(en.poolPublicLead).to.match(/cannot be withdrawn/i);
    expect(en.sectionPoolLead).to.match(/cannot be withdrawn/i);
    expect(en.poolLockedNote).to.match(/not withdrawn/i);
    expect(en.supportPoolBenefit).to.match(/not withdrawn/i);
    const poolKeys = [
      'poolPublicLead',
      'sectionPoolLead',
      'poolLockedNote',
      'supportPoolBenefit',
      'depositPool',
      'yourLpPosition',
    ];
    for (const key of poolKeys) {
      for (const [lang, copy] of [
        ['es', es],
        ['en', en],
      ]) {
        const rest = withoutNegation(copy[key]);
        expect(rest, `${lang}.${key}`).to.not.match(
          /retirar del (pool|fondo)|puede retirar|retire su aporte|you can withdraw|withdraw your/i
        );
      }
    }
  });

  it('Reserva no se presenta como un retiro del fondo de préstamos', async function () {
    const { deployProtocol } = require('./helpers.cjs');
    const deployed = await deployProtocol();
    expect(typeof deployed.reserva.desbloquear).to.equal('function');
    await expect(deployed.reserva.connect(deployed.owner).desbloquear()).to.be.reverted;
    expect(deployed.reserva.interface.hasFunction('retirarBote')).to.equal(false);
    expect(deployed.reserva.interface.hasFunction('retirarLiquidez')).to.equal(false);
    const reserva = read('components/ReservaSection.tsx');
    expect(reserva).to.include("t('reservaLead')");
    expect(reserva).to.not.include('retirarLiquidez');
    expect(reserva).to.not.include("t('poolPublicLead')");
    expect(reserva).to.not.include("t('amountWithdraw')");
    const es = locale('es');
    const en = locale('en');
    expect(es.reservaLead).to.match(/separado del fondo/i);
    expect(es.reservaAdminPotHint).to.match(/no es una donación ni el fondo común/i);
    expect(es.reservaRetiroTitle).to.match(/provisión/i);
    expect(es.reservaRetiroHint).to.match(/no se toca/i);
    expect(withoutNegation(es.reservaLead)).to.not.match(/retirar del (pool|fondo)/i);
    expect(withoutNegation(en.reservaLead)).to.not.match(
      /withdraw from the (pool|fund)|you can withdraw your deposit/i
    );
  });
});
