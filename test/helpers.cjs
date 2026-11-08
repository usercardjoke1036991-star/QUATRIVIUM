const { ethers } = require('hardhat');
const { getLinkedCreditFactory } = require('../scripts/linkCredit.cjs');

async function deployFamaAndCredit(factory, tokenAddr, owner, feeBp, admins, confirms) {
  const nonce = await ethers.provider.getTransactionCount(owner.address);
  const famaAddr = ethers.getCreateAddress({ from: owner.address, nonce });
  const creditAddr = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
  const reservaAddr = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 2 });
  const altaAddr = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 3 });
  const Fama = await ethers.getContractFactory('QuatriviumFamaCaja');
  const fama = await Fama.deploy(tokenAddr, creditAddr, altaAddr, reservaAddr);
  await fama.waitForDeployment();
  const contract = await factory.deploy(
    tokenAddr,
    owner.address,
    feeBp,
    admins,
    confirms,
    await fama.getAddress()
  );
  await contract.waitForDeployment();
  if ((await contract.getAddress()).toLowerCase() !== creditAddr.toLowerCase()) {
    throw new Error('predicted Credit address mismatch');
  }
  const Reserva = await ethers.getContractFactory('QuatriviumReserva');
  const reserva = await Reserva.deploy(tokenAddr, owner.address, creditAddr, famaAddr, altaAddr);
  await reserva.waitForDeployment();
  const Alta = await ethers.getContractFactory('QuatriviumAlta');
  const alta = await Alta.deploy(tokenAddr, creditAddr, reservaAddr);
  await alta.waitForDeployment();
  return { contract, fama, reserva, alta };
}

async function deployProtocol(opts = {}) {
  const pegAnswer = opts.pegAnswer ?? 100000000;
  const feeBp = opts.feeBp ?? 500;
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user = signers[1];
  const extra = signers[2];

  const Token = await ethers.getContractFactory('ERC20Mock');
  const Aggregator = await ethers.getContractFactory('MockV3Aggregator');
  const QuatriviumCredit = await getLinkedCreditFactory(
    ethers,
    opts.harness ? 'QuatriviumCreditHarness' : 'QuatriviumCredit'
  );

  const token = await Token.deploy();
  const feed = await Aggregator.deploy(8, pegAnswer);
  const tokenAddr = await token.getAddress();
  const feedAddr = await feed.getAddress();
  const admins = opts.admins || [owner.address, user.address, extra.address];
  if (admins.length !== 3) {
    throw new Error('QuatriviumCredit exige exactamente 3 admins');
  }
  const confirms = 2;

  const { contract, fama, reserva, alta } = await deployFamaAndCredit(
    QuatriviumCredit,
    tokenAddr,
    owner,
    feeBp,
    admins,
    confirms
  );

  const contractAddr = await contract.getAddress();
  return {
    token,
    feed,
    contract,
    fama,
    reserva,
    alta,
    owner,
    user,
    extra,
    tokenAddr,
    feedAddr,
    contractAddr,
    signers,
  };
}

async function seedPool(token, contract, owner, amount = '500') {
  const contractAddr = await contract.getAddress();
  const tokenAddr = await token.getAddress();
  await token.mint(owner.address, ethers.parseUnits('10000', 18));
  await token.connect(owner).approve(contractAddr, ethers.MaxUint256);
  await contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits(amount, 18));
}

async function encodeAttestPacked(contract, wallet, phoneHash, deviceHash, deadline) {
  const nonce = await contract.attestNonce(wallet);
  const network = await ethers.provider.getNetwork();
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'address'],
      [wallet, phoneHash, deviceHash, deadline, nonce, network.chainId, await contract.getAddress()]
    )
  );
}

async function signAttest(contract, attester, wallet, phoneHash, deviceHash, deadline) {
  const packed = await encodeAttestPacked(contract, wallet, phoneHash, deviceHash, deadline);
  const sig = await attester.signMessage(ethers.getBytes(packed));
  return ethers.Signature.from(sig);
}

async function attestIdentity(contract, user, phoneSalt = 'phone', deviceSalt = 'device') {
  const [attester] = await ethers.getSigners();
  const phoneHash = ethers.keccak256(ethers.toUtf8Bytes(`${user.address}:${phoneSalt}`));
  const deviceHash = ethers.keccak256(ethers.toUtf8Bytes(`${user.address}:${deviceSalt}`));
  const latest = await ethers.provider.getBlock('latest');
  const deadline = BigInt((latest?.timestamp || 0) + 3600);
  const { v, r, s } = await signAttest(
    contract,
    attester,
    user.address,
    phoneHash,
    deviceHash,
    deadline
  );
  await contract.connect(user).vincularIdentidad(phoneHash, deviceHash, deadline, v, r, s);
}

async function qualifyCollector(token, contract, user) {
  const fama = await ethers.getContractAt('QuatriviumFamaCaja', await contract.famaHermano());
  const alta = await ethers.getContractAt('QuatriviumAlta', await fama.alta());
  const tokenAddr = await token.getAddress();
  const contractAddr = await contract.getAddress();
  if (!(await contract.humanosVerificados(user.address))) {
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
  }
  await token.mint(user.address, ethers.parseUnits('8', 18));
  await token.connect(user).approve(contractAddr, ethers.MaxUint256);
  if (!(await alta.registroHecho(user.address))) {
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await alta.connect(user).pagarRegistro();
  }
  if (!(await contract.l1Pagado(user.address))) {
    await contract.connect(user).solicitarPrestamo(tokenAddr, 1);
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
  }
}

async function registerAndFund(token, contract, user, amount = '50', padre = ethers.ZeroAddress) {
  const contractAddr = await contract.getAddress();
  await contract.connect(user).registrarHumanoConPadre(padre);
  await token.mint(user.address, ethers.parseUnits(amount, 18));
  await token.connect(user).approve(contractAddr, ethers.MaxUint256);
  const fama = await ethers.getContractAt('QuatriviumFamaCaja', await contract.famaHermano());
  const alta = await ethers.getContractAt('QuatriviumAlta', await fama.alta());
  if (!(await alta.registroHecho(user.address))) {
    await token.mint(user.address, ethers.parseUnits('4', 18));
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await alta.connect(user).pagarRegistro();
  }
}

async function proposeAndExecute(contract, signer, fragment, args = [], extraConfirmers = []) {
  const data = contract.interface.encodeFunctionData(fragment, args);
  const tx = await contract.connect(signer).proposeAdminAction(data);
  const receipt = await tx.wait();
  const parsed = receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === 'AdminActionProposed');
  const id = parsed.args.id;
  for (const extra of extraConfirmers) {
    await contract.connect(extra).confirmAdminAction(id);
  }
  await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
  await ethers.provider.send('evm_mine');
  await contract.connect(signer).executeAdminAction(id);
  return id;
}

async function drainToken(token, from, to) {
  const bal = await token.balanceOf(from.address);
  if (bal > 0n) {
    await token.connect(from).transfer(to.address, bal);
  }
}

async function assertNavInvariant(token, contract, tokenAddr, contractAddr) {
  const { expect } = require('chai');
  const cash = await token.balanceOf(contractAddr);
  const outstanding = await contract.outstandingLoans(tokenAddr);
  const liquidity = await contract.totalLiquidity(tokenAddr);
  const fees = await contract.collectedFees(tokenAddr);
  expectAmt(cash + outstanding, liquidity + fees);
}

function expectAmt(actual, expected) {
  const { expect } = require('chai');
  expect(BigInt(actual)).to.equal(BigInt(expected));
}

module.exports = {
  deployFamaAndCredit,
  deployProtocol,
  seedPool,
  attestIdentity,
  signAttest,
  encodeAttestPacked,
  registerAndFund,
  qualifyCollector,
  proposeAndExecute,
  drainToken,
  assertNavInvariant,
  expectAmt,
};
