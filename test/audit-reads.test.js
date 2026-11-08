const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('failed reads keep the last figure', function () {
  it('does not cache a silent node as a 100-level protocol', function () {
    const service = read('services/quatriviumCreditService.ts');
    expect(service).to.include('export function isUnreadRpc');
    expect(service).to.include("return code !== 'CALL_EXCEPTION'");
    expect(service).to.include("throw new Error('caps-unread')");
    expect(service).to.include('if (capsCache?.addr === addr) return capsCache.caps');
    const balances = read('hooks/useWeb3Balances.ts');
    expect(balances).to.include('let capsRead = false');
    expect(balances).to.include('if (live() && capsRead)');
    expect(balances).to.not.include('maxLevel: CORE_LOAN_LEVEL');
  });

  it('does not paint fame or the sponsor as empty when the node is silent', function () {
    const service = read('services/quatriviumCreditService.ts');
    expect(service).to.not.include('fama.famaRed(userAddress).catch(() => 0n)');
    expect(service).to.include('if (hermano === null) return null');
    const balances = read('hooks/useWeb3Balances.ts');
    expect(balances).to.include('padre === null ? prev.referral.padre : padre');
    expect(balances).to.include('bonoActivacionCobrado === null');
    expect(balances).to.include('...(fama');
    expect(balances).to.include('...(racha ? { racha } : {})');
  });

  it('does not call Reserve undeployed while the read is still open', function () {
    const ui = read('components/ReservaSection.tsx');
    expect(ui).to.include("setPreviewState('failed')");
    expect(ui).to.include("previewState === 'ready'");
    expect(ui).to.include("t('reservaPreviewFailed')");
    expect(ui).to.not.include('.catch(() => setPreview(null))');
    const es = JSON.parse(read('i18n/locales/es.json'));
    const en = JSON.parse(read('i18n/locales/en.json'));
    expect(es.reservaPreviewFailed).to.include('última cifra');
    expect(en.reservaPreviewFailed).to.include('last figure');
    for (const loc of [
      'ar',
      'bn',
      'de',
      'fr',
      'hi',
      'id',
      'it',
      'ja',
      'ko',
      'pt',
      'ru',
      'tr',
      'ur',
      'vi',
      'zh',
    ]) {
      const pack = JSON.parse(read(`i18n/locales/${loc}.json`));
      expect(typeof pack.reservaPreviewFailed, loc).to.equal('string');
      expect(String(pack.reservaPreviewFailed).length, loc).to.be.greaterThan(0);
    }
  });
});
