const { expect } = require('chai');
require('ts-node/register');
const {
  addressEdges,
  fundsConfirmPlan,
  fundsDetailsComplete,
  fundsTx,
} = require('../utils/fundsConfirmGate.ts');

const DEST = '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b';

describe('Pantalla de confirmación de fondos', function () {
  it('sin monto, destino o comisión no se puede aprobar', function () {
    expect(fundsDetailsComplete(null)).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('', DEST))).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('0', DEST))).to.equal(false);
    expect(fundsDetailsComplete({ ...fundsTx('4', DEST), destination: '' })).to.equal(false);
    expect(fundsDetailsComplete({ ...fundsTx('4', DEST), fee: '' })).to.equal(false);
    expect(fundsDetailsComplete({ ...fundsTx('4', DEST), symbol: '' })).to.equal(false);
    const plan = fundsConfirmPlan({
      movesFunds: true,
      protectionOn: true,
      details: fundsTx('0', DEST),
    });
    expect(plan.showScreen).to.equal(true);
    expect(plan.canApprove).to.equal(false);
  });

  it('con la protección apagada la pantalla sigue y el botón confirma si los datos están', function () {
    const details = fundsTx('4', DEST);
    expect(details.symbol).to.equal('LUSD');
    expect(details.fee).to.equal('0.0002 ETH');
    const plan = fundsConfirmPlan({ movesFunds: true, protectionOn: false, details });
    expect(plan.showScreen).to.equal(true);
    expect(plan.mode).to.equal('button');
    expect(plan.canApprove).to.equal(true);
    const edges = addressEdges(DEST);
    expect(edges.start).to.equal(DEST.slice(0, 6));
    expect(edges.end).to.equal(DEST.slice(-4));
    expect(edges.full).to.equal(DEST);
  });

  it('con la protección encendida pide secreto y no aprueba a ciegas', function () {
    const plan = fundsConfirmPlan({
      movesFunds: true,
      protectionOn: true,
      details: fundsTx('1', DEST),
    });
    expect(plan.showScreen).to.equal(true);
    expect(plan.mode).to.equal('secret');
    expect(plan.canApprove).to.equal(true);
  });
});
