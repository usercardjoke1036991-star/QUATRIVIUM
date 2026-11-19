const { expect } = require('chai');
const { ethers } = require('hardhat');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { deployProtocol } = require('./helpers.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'setup-safe-admin.cjs');
const LINEA = /^(Credit|Reserva) paso ([12]) (\w+) (removeAdmin|addAdmin) (0x[0-9a-fA-F]+)$/gm;

async function warp(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine');
}

function pasos(safe, saliente) {
  const out = execFileSync(process.execPath, [SCRIPT, safe, saliente], { encoding: 'utf8' });
  return [...out.matchAll(LINEA)].map((m) => ({
    parte: m[1],
    paso: Number(m[2]),
    via: m[3],
    fn: m[4],
    data: m[5],
  }));
}

describe('setup-safe-admin: reemplazar un admin por un Safe', function () {
  it('imprime removeAdmin y luego addAdmin para Credit y para Reserva', async () => {
    const [, , extra, , , safe] = await ethers.getSigners();
    const p = pasos(safe.address, extra.address);
    expect(p.map((x) => `${x.parte}:${x.paso}:${x.fn}`)).to.deep.equal([
      'Credit:1:removeAdmin',
      'Credit:2:addAdmin',
      'Reserva:1:removeAdmin',
      'Reserva:2:addAdmin',
    ]);
    expect(p[0].data.slice(0, 10)).to.equal('0x1785f53c');
    expect(p[1].data.slice(0, 10)).to.equal('0x70480275');
  });

  it('el calldata impreso deja al Safe como admin en Credit y en Reserva con 3 admins de partida', async () => {
    const { contract, reserva, owner, user, extra, signers } = await deployProtocol();
    const safe = signers[5];
    const p = pasos(safe.address, extra.address);
    const credit = p.filter((x) => x.parte === 'Credit');
    const res = p.filter((x) => x.parte === 'Reserva');
    expect(credit.length).to.equal(2);
    expect(res.length).to.equal(2);
    for (const [i, x] of credit.entries()) {
      await contract.connect(owner).proposeAdminAction(x.data);
      const id = await contract.proposalCount();
      await contract.connect(user).confirmAdminAction(id);
      await warp(72 * 60 * 60 + 1);
      await contract.connect(owner).executeAdminAction(id);
      if (i === 0) expect(await contract.admins(extra.address)).to.equal(false);
    }
    expect(await contract.admins(safe.address)).to.equal(true);
    for (const x of res) {
      await reserva.connect(owner).proponerAdmin(x.data);
      const id = await reserva.proposalCount();
      await reserva.connect(user).confirmarAdmin(id);
      await warp(72 * 60 * 60 + 1);
      await reserva.connect(owner).ejecutarAdmin(id);
    }
    expect(await reserva.admins(safe.address)).to.equal(true);
    expect(await reserva.admins(extra.address)).to.equal(false);
  });

  it('rechaza el mismo address dos veces o un argumento que falta', async () => {
    const a = '0x' + '11'.repeat(20);
    const mismo = spawnSync(process.execPath, [SCRIPT, a, a.toUpperCase().replace('0X', '0x')], {
      encoding: 'utf8',
    });
    expect(mismo.status).to.equal(1);
    const falta = spawnSync(process.execPath, [SCRIPT, a], {
      encoding: 'utf8',
      env: { ...process.env, ADMIN_SALIENTE: '' },
    });
    expect(falta.status).to.equal(1);
  });
});
