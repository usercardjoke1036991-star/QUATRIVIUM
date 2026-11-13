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
    const { loadTs } = require('./loadTsApp.cjs');
    const gate = loadTs(path.join(__dirname, '..', 'utils', 'fundsConfirmGate.ts'));
    const plan = gate.fundsConfirmPlan({
      movesFunds: true,
      protectionOn: true,
      details: {
        amount: '1',
        symbol: 'LUSD',
        destination: '0x1111111111111111111111111111111111111111',
        fee: '0.001 ETH',
      },
    });
    expect(plan.showScreen).to.equal(true);
    expect(plan.mode).to.equal('secret');
    expect(plan.canApprove).to.equal(true);
    const withoutProtection = gate.fundsConfirmPlan({
      movesFunds: true,
      protectionOn: false,
      details: {
        amount: '1',
        symbol: 'LUSD',
        destination: '0x1111111111111111111111111111111111111111',
        fee: '0.001 ETH',
      },
    });
    expect(withoutProtection.mode).to.equal('button');
    const es = JSON.parse(read('i18n/locales/es.json'));
    expect(es.fundsConfirmMovement).to.match(/movimiento/i);
    expect(es.loanConfirmRequestTitle).to.match(/préstamo/i);
    expect(es.loanConfirmPayTitle).to.match(/pago/i);
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
