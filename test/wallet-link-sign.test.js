const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { Wallet, verifyTypedData } = require('ethers');

const BIND_TYPES = {
  BindWallet: [
    { name: 'appWallet', type: 'address' },
    { name: 'externalWallet', type: 'address' },
    { name: 'purpose', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

describe('wallet link requires a bind signature', function () {
  it('recovers the external wallet from bind typed data', async function () {
    const signer = Wallet.createRandom();
    const app = Wallet.createRandom().address;
    const timestamp = Date.now();
    const domain = {
      name: 'Quatrivium Credit',
      version: '2',
      chainId: 97,
      verifyingContract: '0x0000000000000000000000000000000000000001',
    };
    const value = {
      appWallet: app,
      externalWallet: signer.address,
      purpose: 'vincular-billetera',
      timestamp,
    };
    const signature = await signer.signTypedData(domain, BIND_TYPES, value);
    const recovered = verifyTypedData(domain, BIND_TYPES, value, signature);
    expect(recovered).to.equal(signer.address);
  });

  it('does not save a link until proveAndSaveLinkedWallet runs', function () {
    const form = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LinkWalletForm.tsx'),
      'utf8'
    );
    const card = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LinkedWalletCard.tsx'),
      'utf8'
    );
    const linked = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'linkedWallet.ts'),
      'utf8'
    );
    const auth = fs.readFileSync(path.join(__dirname, '..', 'services', 'walletAuth.ts'), 'utf8');
    expect(form).to.include('proveAndSaveLinkedWallet');
    expect(form).to.include('linkWalletSignNeed');
    expect(form).to.not.match(/saveLinkedExternalWallet\(internalWallet, address\)/);
    expect(card).to.include('proveAndSaveLinkedWallet');
    expect(card).to.include('sessionLive');
    expect(card).to.include('linkWalletSessionOff');
    expect(card).to.not.include('saveLinkedExternalWallet(');
    expect(linked).to.include('signBindExternalWallet');
    expect(linked).to.include('proven:');
    const transfer = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'TransferWalletsModal.tsx'),
      'utf8'
    );
    const handlers = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useHomeHandlers.ts'),
      'utf8'
    );
    const charge = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'founderUsdtCharge.ts'),
      'utf8'
    );
    expect(transfer).to.not.include('saveLinkedExternalWallet');
    expect(handlers).to.not.include('saveLinkedExternalWallet');
    expect(charge).to.not.include('saveLinkedExternalWallet');
    expect(auth).to.include("BIND_WALLET_PURPOSE = 'vincular-billetera'");
    expect(auth).to.include('signBindExternalWallet');
    expect(auth).to.include('purpose: BIND_WALLET_PURPOSE');
  });

  it('keeps a chain 56 proof out of chain 97', function () {
    const linked = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'linkedWallet.ts'),
      'utf8'
    );
    const flat = linked.replace(/\s+/g, ' ');
    expect(flat).to.include(
      'linkedWalletStorageKey( internalWallet: string, chainId = NETWORK_CONFIG.chainId )'
    );
    expect(flat).to.include(
      "return `${PREFIX}${chainId}:${String(internalWallet || '') .trim() .toLowerCase()}`;"
    );
    expect(linked).to.include('AsyncStorage.getItem(linkedWalletStorageKey(internalWallet))');
    expect(linked).to.not.include('AsyncStorage.getItem(`${PREFIX}${');

    const prefix = 'qv:';
    const wallet = '0xAbC';
    const key = (chainId) => `${prefix}${chainId}:${wallet.trim().toLowerCase()}`;
    const store = new Map();
    store.set(key(56), 'proven:0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047');
    expect(store.get(key(97))).to.equal(undefined);
    expect(store.get(key(56))).to.match(/^proven:/);
    expect(key(56)).to.not.equal(key(97));
  });
});
