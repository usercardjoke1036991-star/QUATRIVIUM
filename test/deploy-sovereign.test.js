const { expect } = require('chai');
const { ethers } = require('hardhat');
const { assertDeployConfig, deploySovereign, ZERO } = require('../scripts/deploySovereign.cjs');

describe('Despliegue soberano local', function () {
  it('en 42161 no sigue sin la confirmación del fundador ni sin el feed', function () {
    const founder = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
    const admins = [founder, '0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003'];
    expect(() =>
      assertDeployConfig({
        chainId: 42161,
        founder,
        admins,
        sequencerFeed: '0xFdB631F5EE196F0ed6FAa767959853A9F217697D',
        confirmFounder: 'no',
        token: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
      })
    ).to.throw(/CONFIRM_FOUNDER_WALLET/);
    expect(() =>
      assertDeployConfig({
        chainId: 42161,
        founder,
        admins,
        sequencerFeed: ZERO,
        confirmFounder: 'yes',
        token: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
      })
    ).to.throw(/feed/);
  });

  it('despliega en local con el fundador distinto de quien despliega y todo enlazado', async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const founder = signers[4];
    const admins = [founder.address, signers[1].address, signers[2].address];
    const Token = await ethers.getContractFactory('ERC20Mock');
    const token = await Token.deploy();
    const Feed = await ethers.getContractFactory('MockV3Aggregator');
    const feed = await Feed.deploy(0, 0);
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await feed.setRound(1, 0, now - 7200, now - 7200, 1);
    const out = await deploySovereign({
      chainId: 31337,
      signer: deployer,
      founder: founder.address,
      admins,
      sequencerFeed: await feed.getAddress(),
      token: await token.getAddress(),
      confirmFounder: 'no',
    });
    expect(await out.credit.fundador()).to.equal(founder.address);
    expect(deployer.address.toLowerCase()).to.not.equal(founder.address.toLowerCase());
    expect(await out.credit.sequencerFeed()).to.equal(await feed.getAddress());
    expect(await out.credit.famaHermano()).to.equal(await out.fama.getAddress());
    expect(await out.fama.alta()).to.equal(await out.alta.getAddress());
    expect(await out.fama.reserva()).to.equal(await out.reserva.getAddress());
    expect(await out.reserva.altaFuente()).to.equal(await out.alta.getAddress());
    expect(await out.alta.credit()).to.equal(await out.credit.getAddress());
    expect(await out.apk.fundador()).to.equal(founder.address);
    expect(await out.credit.ownerList(2)).to.equal(signers[2].address);
  });
});
