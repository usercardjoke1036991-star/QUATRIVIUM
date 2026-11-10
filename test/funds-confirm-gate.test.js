const { expect } = require('chai');
require('ts-node/register');
const {
  addressEdges,
  fundsConfirmPlan,
  fundsDetailsComplete,
  fundsTx,
  quoteNetworkFee,
  reservaConfirmAmount,
} = require('../utils/fundsConfirmGate.ts');

const DEST = '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b';

describe('Pantalla de confirmación de fondos', function () {
  it('sin monto, destino o comisión no se puede aprobar', function () {
    expect(fundsDetailsComplete(null)).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('', DEST, '1 ETH'))).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('0', DEST, '1 ETH'))).to.equal(false);
    expect(fundsDetailsComplete({ ...fundsTx('4', DEST, '1 ETH'), destination: '' })).to.equal(
      false
    );
    expect(fundsDetailsComplete({ ...fundsTx('4', DEST, '1 ETH'), fee: '' })).to.equal(false);
    expect(fundsDetailsComplete({ ...fundsTx('4', DEST, '1 ETH'), symbol: '' })).to.equal(false);
    const plan = fundsConfirmPlan({
      movesFunds: true,
      protectionOn: true,
      details: fundsTx('0', DEST, '1 ETH'),
    });
    expect(plan.showScreen).to.equal(true);
    expect(plan.canApprove).to.equal(false);
  });

  it('con la protección apagada la pantalla sigue y el botón confirma si los datos están', async function () {
    const quoted = await quoteNetworkFee(
      {
        estimateGas: async () => 21000n,
        getFeeData: async () => ({ gasPrice: 100_000_000n, maxFeePerGas: null }),
      },
      { to: DEST, data: '0x' }
    );
    expect(quoted).to.equal('0.0000021 ETH');
    const down = await quoteNetworkFee(
      {
        estimateGas: async () => {
          throw new Error('rpc');
        },
        getFeeData: async () => ({ gasPrice: 1n }),
      },
      { to: DEST }
    );
    expect(down).to.equal('no disponible');
    const details = fundsTx('4', DEST, quoted);
    expect(details.symbol).to.equal('LUSD');
    expect(details.fee).to.equal(quoted);
    expect(reservaConfirmAmount('lock', '25', null)).to.equal('25');
    expect(reservaConfirmAmount('unlock', '1', '40')).to.equal('40');
    expect(reservaConfirmAmount('renew', '1', '0')).to.equal(null);
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
      details: fundsTx('1', DEST, '0.0000021 ETH'),
    });
    expect(plan.showScreen).to.equal(true);
    expect(plan.mode).to.equal('secret');
    expect(plan.canApprove).to.equal(true);
  });
});
