const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

function parseLegalRecord(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data.version !== 'string' || typeof data.at !== 'string') return null;
    if (!data.version.trim() || !data.at.trim()) return null;
    return { version: data.version, at: data.at };
  } catch {
    return null;
  }
}

function isCurrentLegalAccepted(record, version) {
  return Boolean(record && record.version === version && record.at);
}

function nextBootLegalScreen(langChosen, legalAccepted) {
  if (!langChosen) return 'language';
  if (!legalAccepted) return 'legal';
  return 'app';
}

function hasReadToEnd(layoutHeight, contentHeight, offsetY) {
  const view = Number(layoutHeight) || 0;
  const content = Number(contentHeight) || 0;
  const y = Number(offsetY) || 0;
  if (view <= 0) return false;
  if (content <= view + 8) return true;
  return y + view >= content - 48;
}

describe('legal consent gate', () => {
  it('asks for language first, then policies, then the app', () => {
    expect(nextBootLegalScreen(false, false)).to.equal('language');
    expect(nextBootLegalScreen(true, false)).to.equal('legal');
    expect(nextBootLegalScreen(true, true)).to.equal('app');
    expect(nextBootLegalScreen(false, true)).to.equal('language');
  });

  it('does not accept an old policy version', () => {
    expect(
      isCurrentLegalAccepted(
        parseLegalRecord('{"version":"2020-01-01","at":"2020-01-01T00:00:00.000Z"}'),
        '2026-09-30.1'
      )
    ).to.equal(false);
    expect(
      isCurrentLegalAccepted(
        parseLegalRecord('{"version":"2026-09-30.1","at":"2026-09-30T12:00:00.000Z"}'),
        '2026-09-30.1'
      )
    ).to.equal(true);
    expect(parseLegalRecord('nope')).to.equal(null);
    expect(isCurrentLegalAccepted(null, '2026-09-30.1')).to.equal(false);
  });

  it('enables accept only after the reader reaches the end', () => {
    expect(hasReadToEnd(0, 800, 0)).to.equal(false);
    expect(hasReadToEnd(640, 600, 0)).to.equal(true);
    expect(hasReadToEnd(640, 1200, 0)).to.equal(false);
    expect(hasReadToEnd(640, 1200, 560)).to.equal(true);
  });

  it('wires the boot order and settings rows in source', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    expect(app.indexOf('LanguageWelcome')).to.be.lessThan(app.indexOf('LegalWelcome'));
    expect(app.indexOf('<LegalWelcome>')).to.be.lessThan(app.indexOf('<AppLockGate>'));
    const settings = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SettingsButton.tsx'),
      'utf8'
    );
    expect(settings).to.include("setPanel('privacy')");
    expect(settings).to.include("setPanel('terms')");
    expect(settings).to.include('LegalDocuments');
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LegalWelcome.tsx'),
      'utf8'
    );
    expect(gate).to.include('LEGAL_STORAGE_KEY');
    expect(gate).not.to.include('finish(false)');
    const docs = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LegalDocuments.tsx'),
      'utf8'
    );
    expect(docs).to.include('legalAccept');
    expect(docs).to.include('hasReadToEnd');
  });

  it('ships privacy and terms copy for every language', () => {
    const langs = [
      'es',
      'en',
      'zh',
      'hi',
      'ar',
      'bn',
      'pt',
      'ru',
      'ur',
      'id',
      'fr',
      'ja',
      'de',
      'ko',
      'tr',
      'vi',
      'it',
    ];
    const copy = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'legalCopy.ts'), 'utf8');
    for (const lang of langs) {
      expect(copy).to.include(`${lang}:`);
    }
    expect(copy).to.include('privacy: sections(');
    expect(copy).to.include('title, body');
    expect(copy).to.include('legalExtrasFor');
    expect(copy).to.not.include('<AppText>{copy.privacy}</AppText>');
    const extras = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'legalExtras.ts'), 'utf8');
    expect(extras).to.include('Reserva');
    expect(extras).to.include('no son una licencia');
    const consent = fs.readFileSync(path.join(__dirname, '..', 'utils', 'legalConsent.ts'), 'utf8');
    expect(consent).to.include("LEGAL_VERSION = '2026-09-30.1'");
    const reservaUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReservaSection.tsx'),
      'utf8'
    );
    expect(reservaUi).to.include('reservaUnlockWait');
    expect(reservaUi).to.include('formatCountdownClock');
    expect(reservaUi).to.include('reservaCommissionLead');
    expect(reservaUi).to.include('reservaBoostComision');
    expect(reservaUi).to.include('reservaLockOnce');
    expect(reservaUi).to.not.include('reservaFounderNote');
  });
});
