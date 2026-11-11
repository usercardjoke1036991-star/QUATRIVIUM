const path = require('path');
const { expect } = require('chai');
const { Interface } = require('ethers');
const { loadTs } = require('./loadTsApp.cjs');

const admin = loadTs(path.join(__dirname, '..', 'utils', 'adminProposal.ts'));
const iface = new Interface([
  'function addAdmin(address newAdmin)',
  'function removeAdmin(address admin)',
  'function pausarPrestamosNuevos()',
]);
const who = '0x' + '11'.repeat(20);

describe('admin proposal words', function () {
  it('decodes add, remove and pause into an action and its target', function () {
    const add = admin.decodeAdminCalldata(iface.encodeFunctionData('addAdmin', [who]));
    expect(add.actionKey).to.equal('adminActionAdd');
    expect(add.target.toLowerCase()).to.equal(who);
    expect(add.name).to.equal('addAdmin');
    const remove = admin.decodeAdminCalldata(iface.encodeFunctionData('removeAdmin', [who]));
    expect(remove.actionKey).to.equal('adminActionRemove');
    expect(remove.target.toLowerCase()).to.equal(who);
    const pause = admin.decodeAdminCalldata(iface.encodeFunctionData('pausarPrestamosNuevos', []));
    expect(pause.actionKey).to.equal('adminActionPause');
    expect(pause.target).to.equal('');
    expect(
      admin.describeAdminCalldata(iface.encodeFunctionData('pausarPrestamosNuevos', []))
    ).to.equal('pausarPrestamosNuevos');
    const unknown = admin.decodeAdminCalldata('0xdeadbeef');
    expect(unknown.actionKey).to.equal('adminActionUnknown');
    expect(unknown.target.startsWith('0x')).to.equal(true);
  });
});
