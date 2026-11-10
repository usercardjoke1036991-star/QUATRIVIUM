const { expect } = require('chai');
const { founderWalletAck } = require('../scripts/founderAck.cjs');

describe('aviso de la billetera fundadora', function () {
  it('exige confirmación y explica qué pasa si se pierde la llave', function () {
    const blocked = founderWalletAck({});
    expect(blocked.ok).to.equal(false);
    expect(blocked.warning).to.match(/varias firmas|billetera física/);
    expect(blocked.warning).to.match(/nadie publica hashes/);
    expect(founderWalletAck({ CONFIRM_FOUNDER_WALLET: 'yes' }).ok).to.equal(true);
  });
});
