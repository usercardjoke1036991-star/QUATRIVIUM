const { expect } = require('chai');

const DEMO_USDT = '0x2d4AE5E6984D98777a24473F196326ff2604F5A6'.toLowerCase();
const LIVE_USDT = '0x55d398326f99059ff775485246999027b3197955'.toLowerCase();

function resolvePersistedMode(saved) {
  return saved === 'demo' ? 'demo' : 'live';
}

function isFirstAppMode(saved) {
  return saved == null || String(saved).trim() === '';
}

function isOfficialWorldToken(mode, address) {
  const needle = String(address || '')
    .trim()
    .toLowerCase();
  if (!needle.startsWith('0x') || needle.length !== 42) return false;
  return mode === 'demo' ? needle === DEMO_USDT : needle === LIVE_USDT;
}

function parseEvmChainId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  const asDec = Number.parseInt(text, 10);
  return Number.isFinite(asDec) ? asDec : 0;
}

function needsWalletAddChain(error) {
  const code = Number(error && error.code);
  return code === 4902 || code === -32603;
}

describe('mundos Demo y Real', function () {
  it('primera instalacion entra en Real', function () {
    expect(resolvePersistedMode(null)).to.equal('live');
    expect(resolvePersistedMode('')).to.equal('live');
    expect(resolvePersistedMode('live')).to.equal('live');
  });

  it('recuerda Demo si el usuario la eligio', function () {
    expect(resolvePersistedMode('demo')).to.equal('demo');
  });

  it('vuelve a Real si no hay ultimo modo guardado', function () {
    expect(isFirstAppMode(null)).to.equal(true);
    expect(isFirstAppMode('')).to.equal(true);
    expect(isFirstAppMode('demo')).to.equal(false);
    expect(resolvePersistedMode('otro')).to.equal('live');
  });

  it('no trata el USDT oficial de Demo como token apagado', function () {
    expect(isOfficialWorldToken('demo', DEMO_USDT)).to.equal(true);
    expect(isOfficialWorldToken('demo', LIVE_USDT)).to.equal(false);
  });

  it('no mezcla el USDT de Real con el de Demo', function () {
    expect(isOfficialWorldToken('live', LIVE_USDT)).to.equal(true);
    expect(isOfficialWorldToken('live', DEMO_USDT)).to.equal(false);
  });

  it('reconoce la red de la billetera externa', function () {
    expect(parseEvmChainId('0x61')).to.equal(97);
    expect(parseEvmChainId('0x38')).to.equal(56);
    expect(parseEvmChainId(97)).to.equal(97);
    expect(parseEvmChainId('')).to.equal(0);
    expect(needsWalletAddChain({ code: 4902 })).to.equal(true);
    expect(needsWalletAddChain({ code: 4001 })).to.equal(false);
  });
});
