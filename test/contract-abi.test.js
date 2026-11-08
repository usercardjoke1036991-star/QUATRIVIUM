const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { Interface } = require('ethers');

const ADMIN_SELECTORS = [
  'setFeeBP',
  'setTokenConfig',
  'setInterestModelParams',
  'setReputationParams',
  'setFeeCollector',
  'addAdmin',
  'removeAdmin',
  'setOwner',
  'setFundador',
  'setRequiredConfirmations',
  'setSecurityParams',
  'retirarComisiones',
  'retirarComisionesToken',
];

function clientInterface() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'constants', 'contractConfig.ts'), 'utf8');
  const fragments = [...src.matchAll(/'(function [^']+|event [^']+)'/g)].map((row) => row[1]);
  return new Interface(fragments);
}

describe('CONTRACT_ABI', function () {
  it('encodes every timelocked admin selector the sovereign contract allows', function () {
    const iface = clientInterface();
    for (const name of ADMIN_SELECTORS) {
      expect(() => iface.getFunction(name), name).to.not.throw();
    }
    expect(() => iface.getFunction('cancelAdminAction')).to.not.throw();
    expect(() => iface.getFunction('proposeAdminAction')).to.not.throw();
    expect(
      iface.parseTransaction({
        data: iface.encodeFunctionData('setFundador', [
          '0x0000000000000000000000000000000000000001',
        ]),
      }).name
    ).to.equal('setFundador');
  });

  it('encodes every sovereign money and onboarding path the app calls', function () {
    const iface = clientInterface();
    for (const name of [
      'solicitarPrestamo',
      'pagarPrestamo',
      'donar',
      'pagarVerificacion',
      'depositarLiquidez',
      'retirarLiquidez',
      'registrarHumanoConPadre',
    ]) {
      expect(() => iface.getFunction(name), name).to.not.throw();
    }
  });
});
