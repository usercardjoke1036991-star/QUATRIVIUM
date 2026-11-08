const { expect } = require('chai');
const { looksLikeTelegramToken, sanitizeTelegramBot } = require('../scripts/telegramBotName.cjs');

describe('telegram public bot name', function () {
  it('keeps a real username and drops tokens', function () {
    expect(sanitizeTelegramBot('QuatriviumNotifyBot')).to.equal('QuatriviumNotifyBot');
    expect(sanitizeTelegramBot('@QuatriviumNotifyBot')).to.equal('QuatriviumNotifyBot');
    expect(looksLikeTelegramToken('123456789:AAHfakeTokenForTestsOnly000001')).to.equal(true);
    expect(sanitizeTelegramBot('123456789:AAHfakeTokenForTestsOnly000001')).to.equal('');
    expect(sanitizeTelegramBot('123456789AAHfakeTokenForTestsOnly000')).to.equal('');
  });
});
