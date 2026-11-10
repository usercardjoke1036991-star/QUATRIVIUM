const { expect } = require('chai');
const { ethers } = require('hardhat');
const fs = require('fs');
const { getLinkedCreditFactory } = require('../scripts/linkCredit.cjs');
const { deployProtocol, deployFamaAndCredit } = require('./helpers.cjs');

describe('Fase 3 — fondo, sequencer y APK', function () {
  it('rejects ETH and exposes no sweep of stuck balances', async () => {
    const { contract, owner, contractAddr } = await deployProtocol();
    const src = fs.readFileSync('contracts/QuatriviumCredit.sol', 'utf8');
    expect(src.includes('receive()')).to.equal(false);
    expect(src.includes('fallback()')).to.equal(false);
    for (const name of ['sweep', 'retirarComisiones', 'rescueTokens', 'retirarFondoSeguro']) {
      expect(contract.interface.hasFunction(name), name).to.equal(false);
    }
    await expect(owner.sendTransaction({ to: contractAddr, value: 1n })).to.be.reverted;
  });

  it('allows a zero sequencer feed on the hardhat chain', async () => {
    const [owner, user, extra] = await ethers.getSigners();
    const net = await ethers.provider.getNetwork();
    expect(net.chainId).to.equal(31337n);
    const Token = await ethers.getContractFactory('ERC20Mock');
    const token = await Token.deploy();
    const factory = await getLinkedCreditFactory(ethers);
    const { contract } = await deployFamaAndCredit(
      factory,
      await token.getAddress(),
      owner,
      500,
      [owner.address, user.address, extra.address],
      2,
      ethers.ZeroAddress
    );
    expect(await contract.sequencerFeed()).to.equal(ethers.ZeroAddress);
  });

  it('lets only the founder append APK hashes and never deletes them', async () => {
    const [founder, stranger] = await ethers.getSigners();
    const Apk = await ethers.getContractFactory('QuatriviumApk');
    const apk = await Apk.deploy(founder.address);
    const h1 = ethers.sha256(ethers.toUtf8Bytes('apk-1'));
    const h2 = ethers.sha256(ethers.toUtf8Bytes('apk-2'));
    const cert = ethers.sha256(ethers.toUtf8Bytes('certificado'));
    const otro = ethers.sha256(ethers.toUtf8Bytes('otro-certificado'));
    await expect(apk.connect(stranger).publicar(1, h1, cert)).to.be.revertedWithCustomError(
      apk,
      'SoloFundador'
    );
    await expect(apk.connect(founder).publicar(0, h1, cert)).to.be.revertedWithCustomError(
      apk,
      'VersionInvalida'
    );
    await expect(
      apk.connect(founder).publicar(1, ethers.ZeroHash, cert)
    ).to.be.revertedWithCustomError(apk, 'VersionInvalida');
    await expect(
      apk.connect(founder).publicar(1, h1, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(apk, 'VersionInvalida');
    const tx = await apk.connect(founder).publicar(12, h1, cert);
    const rec = await tx.wait();
    const block = await ethers.provider.getBlock(rec.blockNumber);
    await apk.connect(founder).publicar(13, h2, cert);
    await expect(apk.connect(founder).publicar(14, h2, otro)).to.be.revertedWithCustomError(
      apk,
      'CertificadoDistinto'
    );
    expect(await apk.total()).to.equal(2n);
    expect(await apk.certificadoFirma()).to.equal(cert);
    const v0 = await apk.version(0);
    const v1 = await apk.version(1);
    expect(v0.versionCode).to.equal(12n);
    expect(v0.hash).to.equal(h1);
    expect(v0.fecha).to.equal(BigInt(block.timestamp));
    expect(v0.certificado).to.equal(cert);
    expect(v1.versionCode).to.equal(13n);
    expect(v1.hash).to.equal(h2);
    expect(v1.certificado).to.equal(cert);
    for (const name of ['borrar', 'eliminar', 'deleteVersion', 'removeVersion']) {
      expect(apk.interface.hasFunction(name), name).to.equal(false);
    }
  });
});
