const { expect } = require('chai');
require('ts-node/register');
const {
  addressEdges,
  adminConfirmPlan,
  approveFollows,
  fundsConfirmPlan,
  fundsDetailsComplete,
  fundsTx,
  quoteNetworkFee,
  reservaConfirmAmount,
  trimFeeFraction,
} = require('../utils/fundsConfirmGate.ts');

const DEST = '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b';

describe('Pantalla de confirmación de fondos', function () {
  it('sin monto, destino o comisión no se puede aprobar', function () {
    expect(fundsDetailsComplete(null)).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('', DEST, '1 ETH'))).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('0', DEST, '1 ETH'))).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('0.000', DEST, '1 ETH'))).to.equal(false);
    expect(fundsDetailsComplete(fundsTx('00', DEST, '1 ETH'))).to.equal(false);
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
    const FROM = '0x' + 'ab'.repeat(20);
    let seenFrom = '';
    const quoted = await quoteNetworkFee(
      {
        estimateGas: async (tx) => {
          seenFrom = tx.from;
          return 21000n;
        },
        getFeeData: async () => ({ gasPrice: 100_000_000n, maxFeePerGas: null }),
      },
      { from: FROM, to: DEST, data: '0x' }
    );
    expect(seenFrom).to.equal(FROM);
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
    expect(reservaConfirmAmount('lock', '0.000', null)).to.equal(null);
    expect(reservaConfirmAmount('lock', '00', null)).to.equal(null);
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

  it('la accion de admin no pide monto y un approve pendiente avisa', async function () {
    expect(adminConfirmPlan({ action: 'Quitar', target: '0xabc' }).canApprove).to.equal(true);
    expect(adminConfirmPlan({ action: 'Quitar', target: '' }).canApprove).to.equal(false);
    expect(adminConfirmPlan({ action: '', target: '3' }).canApprove).to.equal(false);
    expect(await approveFollows(async () => 1n, 2n)).to.equal(true);
    expect(await approveFollows(async () => 5n, 2n)).to.equal(false);
    expect(
      await approveFollows(async () => {
        throw new Error('rpc');
      }, 1n)
    ).to.equal(true);
  });

  it('trims a fee fraction without a slow expression', () => {
    expect(trimFeeFraction('1.2300'), 'a').to.equal('1.23');
    expect(trimFeeFraction('2.0'), 'b').to.equal('2');
    expect(trimFeeFraction('10.100'), 'c').to.equal('10.1');
    expect(trimFeeFraction('1.23'), 'd').to.equal('1.23');
    expect(trimFeeFraction('100'), 'e').to.equal('100');
    expect(trimFeeFraction(''), 'f').to.equal('');
    const long = `1.${'0'.repeat(9998)}`;
    const started = Date.now();
    expect(trimFeeFraction(long), 'larga').to.equal('1');
    expect(Date.now() - started, 'tiempo').to.be.below(50);
  });
});
