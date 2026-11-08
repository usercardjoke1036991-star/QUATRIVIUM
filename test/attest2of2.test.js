const { expect } = require('chai');
const { Wallet, keccak256, toUtf8Bytes } = require('ethers');

describe('Attester 2-de-2', function () {
  it('exige dos llaves distintas y acepta la firma de apoyo', async () => {
    const { requireDistinctAttesterKeys, cosignPacked, verifyCosign } = await import(
      '../scripts/attest2of2.mjs'
    );
    const a = Wallet.createRandom();
    const b = Wallet.createRandom();
    expect(requireDistinctAttesterKeys(a.privateKey, a.privateKey)).to.equal('same');
    expect(requireDistinctAttesterKeys(a.privateKey, b.privateKey)).to.equal('');
    const packed = keccak256(toUtf8Bytes('quatrivium-attest-demo'));
    const cosign = await cosignPacked(b.privateKey, packed);
    expect(verifyCosign(packed, cosign.signature, b.address)).to.equal(true);
    expect(verifyCosign(packed, cosign.signature, a.address)).to.equal(false);
  });
});
