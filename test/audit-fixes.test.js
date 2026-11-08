const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('audit fixes', function () {
  it('returns the daily send when the recovery mail does not go out', function () {
    const worker = read('scripts/notify-worker.mjs');
    const gate = read('components/AppLockGate.tsx');
    expect(worker).to.include("json(res, 503, { error: 'delivery' })");
    expect(worker).to.include('quota.sends = Math.max(0, Number(quota.sends || 0) - 1)');
    expect(worker).to.not.include(
      'delete store.recoverOtps[emailHash];\n        await persist();\n        json(res, 200, { ok: true });'
    );
    expect(gate).to.include("reason.includes('delivery')");
    expect(gate).to.include("t('emailDeliveryFailed')");
  });

  it('stops fame and movement reads when the network does not answer', function () {
    const fame = read('services/fameLeaderboard.ts');
    const history = read('services/movementHistory.ts');
    for (const source of [fame, history]) {
      expect(source).to.include('const SCAN_BUDGET_MS = 18_000');
      expect(source).to.include('withTimeout(provider.getBlockNumber(), CHUNK_TIMEOUT_MS)');
      expect(source).to.include('contract.queryFilter');
      expect(source).to.include('CHUNK_TIMEOUT_MS');
    }
    expect(history).to.include('withTimeout(provider.getBlock(blockNumber), CHUNK_TIMEOUT_MS)');
    expect(fame).to.include(
      'withTimeout(contract.obtenerProgresoUsuario(address), CHUNK_TIMEOUT_MS)'
    );
  });

  it('does not lock reserva when the level cannot be read', function () {
    const reserva = read('services/reservaService.ts');
    expect(reserva).to.include("throw new Error('reserva-read')");
    expect(reserva).to.include("if (raw.includes('reserva-read')) return 'reservaReadFailed'");
  });

  it('keeps a verified code until it expires if the charge does not finish', function () {
    const worker = read('scripts/notify-worker.mjs');
    const email = read('components/EmailOtpSection.tsx');
    const phone = read('components/PhoneOtpSection.tsx');
    expect(worker).to.include('pending.verified = true');
    expect(worker).to.include('const alreadyVerified = pending.verified === true');
    expect(worker).to.not.include(
      'delete store.otps[wallet];\n      await persist();\n      json(res, 200, attestation)'
    );
    expect(worker).to.not.include(
      'delete store.emailOtps[wallet];\n    await persist();\n    json(res, 200, { ok: true })'
    );
    expect(email).to.include("t('otpPayCancelled')");
    expect(email).to.include("t('otpPayFailed')");
    expect(email).to.include("t('emailRemoveFailed')");
    expect(phone).to.include("t('otpPayCancelled')");
    expect(phone).to.include("t('otpPayFailed')");
  });

  it('asks the wallet to confirm a Telegram chat before binding it', function () {
    const worker = read('scripts/notify-worker.mjs');
    const ui = read('components/NotificationChannels.tsx');
    const start = worker.slice(worker.indexOf('const pollTelegram'), worker.indexOf('const DAY'));
    expect(worker).to.include('telegramOffers: {}');
    expect(worker).to.include('const holdTelegramOffer');
    expect(start).to.include('holdTelegramOffer');
    expect(start).to.not.include('bindTelegram');
    expect(worker).to.include("path === '/telegram/accept' || path === '/telegram/reject'");
    expect(ui).to.include("'/telegram/accept'");
    expect(ui).to.include("'/telegram/reject'");
    expect(ui).to.include("t('telegramConfirmTitle')");
  });

  it('opens a KYC link only when the host is Sumsub', function () {
    const worker = read('scripts/notify-worker.mjs');
    const kyc = read('services/kycProvider.ts');
    expect(worker).to.include('const isSumsubHttps');
    expect(worker).to.include('!isSumsubHttps(url)');
    expect(kyc).to.include('export function isSumsubHttps');
    expect(kyc).to.include("host === 'sumsub.com' || host.endsWith('.sumsub.com')");
    expect(kyc).to.not.include('isHttpsUrl');
  });

  it('uses a movement title when the funds lock is not a wallet transfer', function () {
    const purpose = read('services/fundsConfirm.ts');
    const host = read('components/FundsConfirmHost.tsx');
    const home = read('hooks/useHomeHandlers.ts');
    const charge = read('services/founderUsdtCharge.ts');
    expect(purpose).to.include("'movement'");
    expect(host).to.include("purpose === 'movement'");
    expect(host).to.include("'fundsConfirmMovement'");
    expect(home.match(/confirmFunds\('movement'\)/g) || []).to.have.length(9);
    expect(charge.match(/confirmFunds\('movement'\)/g) || []).to.have.length(2);
    expect(home).to.include("confirmFunds('loanRequest')");
    expect(home).to.include("confirmFunds('loanPay')");
  });

  it('says the parked signup USDT and the liquidate reward match the contract', function () {
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.bonusPending).to.match(/apartado en el alta/i);
    expect(es.bonusPending).to.not.match(/pool|fondo|bolsa/i);
    expect(es.referralEarnFirst).to.include('{bonus}');
    expect(es.referralEarnFirst).to.match(/apartado en el alta/i);
    expect(es.liquidarLead).to.match(/5% del principal/i);
    expect(es.liquidarConfirm).to.match(/5% del principal/i);
    expect(es.settingsAdminLead).to.match(/cofundador/i);
    const en = JSON.parse(read('i18n/locales/en.json'));
    expect(en.settingsAdminLead).to.match(/cofounder/i);
    expect(en.settingsAdminLead).to.not.match(/Only the founding wallet administers/);
    expect(es.invitedBy).to.equal('Lo invitó');
    const ui = read('components/NotificationChannels.tsx');
    expect(ui).to.include("t('telegramOfferPending')");
    expect(ui).to.not.include("throw new Error('offer')");
    const worker = read('scripts/notify-worker.mjs');
    expect(worker).to.include('pendingOffer && body.replace !== true');
  });
});
