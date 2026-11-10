const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('audit fixes', function () {
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

  it('uses a movement title when the funds lock is not a wallet transfer', function () {
    const purpose = read('services/fundsConfirm.ts');
    const host = read('components/FundsConfirmHost.tsx');
    const home = read('hooks/useHomeHandlers.ts');
    const charge = read('services/founderUsdtCharge.ts');
    expect(purpose).to.include("'movement'");
    expect(host).to.include("purpose === 'movement'");
    expect(host).to.include("'fundsConfirmMovement'");
    expect((home.match(/confirmFunds\('movement'/g) || []).length).to.be.at.least(7);
    expect(charge.match(/confirmFunds\('movement'/g) || []).to.have.length(2);
    expect(home).to.include("confirmFunds('loanRequest'");
    expect(home).to.include("'loanPay'");
  });

  it('says the parked signup USDT and the liquidate reward match the contract', function () {
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.bonusPending).to.match(/apartado en el alta/i);
    expect(es.bonusPending).to.not.match(/pool|fondo|bolsa/i);
    expect(es.referralEarnFirst).to.include('{bonus}');
    expect(es.referralEarnFirst).to.match(/apartado en el alta/i);
    expect(es.liquidarLead).to.match(/menor entre el 5% y el interés/i);
    expect(es.liquidarLead).to.match(/no paga el principal/i);
    expect(es.liquidarConfirm).to.match(/no transferirá el principal/i);
    expect(es.settingsAdminLead).to.match(/cofundador/i);
    const en = JSON.parse(read('i18n/locales/en.json'));
    expect(en.settingsAdminLead).to.match(/cofounder/i);
    expect(en.settingsAdminLead).to.not.match(/Only the founding wallet administers/);
    expect(es.invitedBy).to.equal('Lo invitó');
  });
});
