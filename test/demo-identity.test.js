const { expect } = require('chai');
const { keccak256, toUtf8Bytes } = require('ethers');

function hashDemoPhone(wallet, key) {
  return keccak256(toUtf8Bytes(`quatrivium.demo.phone.v1:${key}:${String(wallet).toLowerCase()}`));
}

function hashDemoDevice(wallet, deviceHash, key) {
  return keccak256(
    toUtf8Bytes(`quatrivium.demo.device.v1:${key}:${String(wallet).toLowerCase()}:${deviceHash}`)
  );
}

describe('demo identity hashes (testnet-only attester)', function () {
  const key = 'test-data-key-16xx';
  const a = '0x1111111111111111111111111111111111111111';
  const b = '0x2222222222222222222222222222222222222222';
  const device = `0x${'ab'.repeat(32)}`;

  it('is unique per wallet', function () {
    expect(hashDemoPhone(a, key)).to.not.equal(hashDemoPhone(b, key));
    expect(hashDemoDevice(a, device, key)).to.not.equal(hashDemoDevice(b, device, key));
  });

  it('stays stable for the same wallet regardless of casing', function () {
    expect(hashDemoPhone(a, key)).to.equal(hashDemoPhone(a.toUpperCase(), key));
  });

  it('lets two wallets on the same device get distinct demo device hashes', function () {
    expect(hashDemoDevice(a, device, key)).to.not.equal(hashDemoDevice(b, device, key));
  });
});
