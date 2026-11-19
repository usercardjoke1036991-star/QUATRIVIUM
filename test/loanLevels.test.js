const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol } = require('./helpers.cjs');

function ladderUsd(id) {
  return 10000 + 1100 * (id - 100);
}

function ladderBps(id) {
  const t = id - 100;
  return 800 - Math.min(t, 394);
}

describe('QuatriviumCredit - 1000 loan levels', function () {
  it('keeps levels 1-100 exact: amount up, rate down, interest $ up, L100 is $10,000', async () => {
    const { contract } = await deployProtocol();
    let prevMonto = 0n;
    let prevTasa = 10_001n;
    let prevInteres = 0n;

    for (let id = 1; id <= 100; id += 1) {
      const [monto, plazo, tasa] = await contract.niveles(id);
      expect(monto, `tier ${id} amount`).to.be.gt(prevMonto);
      expect(tasa, `tier ${id} rate`).to.be.lt(prevTasa);
      const interes = (monto * tasa) / 10000n;
      expect(interes, `tier ${id} interest`).to.be.gt(prevInteres);
      expect(plazo).to.be.gte(1n * 24n * 60n * 60n);
      prevMonto = monto;
      prevTasa = tasa;
      prevInteres = interes;
    }

    expect(prevMonto).to.equal(ethers.parseUnits('10000', 18));
    const first = await contract.niveles(1);
    expect(first[0]).to.equal(ethers.parseUnits('1', 18));
    expect(first[2]).to.equal(10000n);
  });

  it('extends 101-1000 by formula to $1,000,000 with rising $ interest', async () => {
    const { contract } = await deployProtocol();
    const [coreMonto, , coreTasa] = await contract.niveles(100);
    let prevMonto = coreMonto;
    let prevTasa = coreTasa;
    let prevInteres = (coreMonto * coreTasa) / 10000n;

    for (let id = 101; id <= 1000; id += 1) {
      const [monto, plazo, tasa] = await contract.niveles(id);
      expect(monto, `tier ${id} amount`).to.equal(ethers.parseUnits(String(ladderUsd(id)), 18));
      expect(tasa, `tier ${id} rate`).to.equal(BigInt(ladderBps(id)));
      expect(monto, `tier ${id} amount up`).to.be.gt(prevMonto);
      expect(tasa, `tier ${id} rate`).to.be.lte(prevTasa);
      const interes = (monto * tasa) / 10000n;
      expect(interes, `tier ${id} interest`).to.be.gt(prevInteres);
      expect(plazo).to.be.gte(90n * 24n * 60n * 60n);
      prevMonto = monto;
      prevTasa = tasa;
      prevInteres = interes;
    }

    expect(prevMonto).to.equal(ethers.parseUnits('1000000', 18));
    expect(prevTasa).to.equal(406n);
  });

  it('keeps LoanLadder in lockstep with the core formula', async () => {
    const { contract } = await deployProtocol();
    const ladder = await (await ethers.getContractFactory('LoanLadder')).deploy();
    const leveling = await (await ethers.getContractFactory('QuatriviumLeveling')).deploy();
    for (const id of [101, 500, 1000]) {
      const [monto, plazo, tasa] = await contract.niveles(id);
      const row = await ladder.params(id);
      expect(row.monto).to.equal(monto);
      expect(row.plazo).to.equal(plazo);
      expect(row.tasa).to.equal(tasa);
    }
    for (const id of [1, 9, 10, 100, 1000]) {
      const need = id <= 1 ? 3n : id < 10 ? 5n : BigInt(5 * (id - 9));
      expect(await ladder.requiredCount(id), `ladder L${id}`).to.equal(need);
      expect(await leveling.requiredCount(id), `leveling L${id}`).to.equal(need);
    }
  });

  it('rejects a level above 1000', async () => {
    const { contract, user, tokenAddr } = await deployProtocol();
    await expect(
      contract.connect(user).solicitarPrestamo(tokenAddr, 1001)
    ).to.be.revertedWithoutReason();
  });

  it('does not treat 101 as missing', async () => {
    const { contract } = await deployProtocol();
    const [monto] = await contract.niveles(101);
    expect(monto).to.equal(ethers.parseUnits('11100', 18));
  });
});
