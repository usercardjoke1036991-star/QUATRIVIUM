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
      chainId: 42161,
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

  it('does not save a link without a test transfer confirmed on chain', function () {
    const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
    const form = read('components', 'LinkWalletForm.tsx');
    const card = read('components', 'LinkedWalletCard.tsx');
    const linked = read('services', 'linkedWallet.ts');
    const auth = read('services', 'walletAuth.ts');
    expect(linked).to.include('proof: LinkProof');
    expect(linked).to.include("TRANSFER_PREFIX = 'transfer:'");
    expect(linked).to.include("PROVEN_PREFIX = 'proven:'");
    expect(linked).to.not.include('typed:');
    expect(form).to.include('saveLinkedExternalWallet(internalWallet, result.proof)');
    expect(card).to.not.include('saveLinkedExternalWallet');
    expect(card).to.include('LinkWalletForm');
    const transfer = read('components', 'TransferWalletsModal.tsx');
    const handlers = read('hooks', 'useHomeHandlers.ts');
    expect(transfer).to.not.include('saveLinkedExternalWallet');
    expect(handlers).to.not.include('saveLinkedExternalWallet');
    expect(auth).to.include("BIND_WALLET_PURPOSE = 'vincular-billetera'");
    expect(auth).to.include('signBindExternalWallet');
    expect(auth).to.include('purpose: BIND_WALLET_PURPOSE');
  });

  it('keeps an Arbitrum One proof out of Arbitrum Sepolia', function () {
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
    store.set(key(42161), 'proven:0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047');
    expect(store.get(key(421614))).to.equal(undefined);
    expect(store.get(key(42161))).to.match(/^proven:/);
    expect(key(42161)).to.not.equal(key(421614));
  });
});
