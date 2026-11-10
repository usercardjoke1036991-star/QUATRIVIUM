const { expect } = require('chai');
const { AbiCoder } = require('ethers');
require('ts-node/register');
const { apkRegistryStatus } = require('../utils/sovereignSurface.ts');
const { readPublishedCert } = require('../services/apkRegistry.ts');

const CERT = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'cd'.repeat(32);

describe('Registro del APK', function () {
  it('sin dirección el estado es no verificada, y con huellas puede coincidir o no', function () {
    expect(
      apkRegistryStatus({ registryAddress: '', localCert: CERT, publishedCert: CERT })
    ).to.equal('unverified');
    expect(
      apkRegistryStatus({
        registryAddress: '0x0000000000000000000000000000000000000001',
        publishedCert: CERT,
        localCert: CERT,
      })
    ).to.equal('match');
    expect(
      apkRegistryStatus({
        registryAddress: '0x0000000000000000000000000000000000000001',
        publishedCert: CERT,
        localCert: OTHER,
      })
    ).to.equal('mismatch');
  });

  it('lee la huella con un proveedor falso', async () => {
    const encoded = AbiCoder.defaultAbiCoder().encode(['bytes32'], [CERT]);
    const provider = {
      async call() {
        return encoded;
      },
    };
    const got = await readPublishedCert(provider, '0x0000000000000000000000000000000000000001');
    expect(got.toLowerCase()).to.equal(CERT);
    expect(await readPublishedCert(provider, '')).to.equal('');
  });
});
