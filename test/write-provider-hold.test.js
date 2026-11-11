const path = require('path');
const Module = require('module');
const { expect } = require('chai');
const { JsonRpcProvider, Transaction, Wallet } = require('ethers');
const { loadTs } = require('./loadTsApp.cjs');

const memory = new Map();

function installMock(name, exports) {
  const file = require.resolve(name);
  const loaded = new Module(file);
  loaded.filename = file;
  loaded.loaded = true;
  loaded.exports = exports;
  Module._cache[file] = loaded;
}

installMock('@react-native-async-storage/async-storage', {
  async getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItem(key, value) {
    memory.set(key, value);
  },
  async removeItem(key) {
    memory.delete(key);
  },
});

const hold = loadTs(path.join(__dirname, '..', 'utils', 'pendingHold.ts'));
const write = loadTs(path.join(__dirname, '..', 'services', 'writeRpc.ts'));
const wait = loadTs(path.join(__dirname, '..', 'utils', 'waitMined.ts'));

const HASH = '0x' + 'ab'.repeat(32);
const store = {
  async get(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  async set(key, value) {
    memory.set(key, value);
  },
  async del(key) {
    memory.delete(key);
  },
};

function node() {
  return new JsonRpcProvider(
    'https://a.example',
    { chainId: 42161, name: 'arbitrum' },
    { staticNetwork: true, batchMaxCount: 1 }
  );
}

function provider(chainId, call) {
  return write.createWriteProvider(chainId, 'arbitrum', {
    urls: ['https://a.example', 'https://b.example'],
    nodes: [node()],
    call,
  });
}

describe('write provider pending hold', function () {
  this.timeout(20000);

  beforeEach(function () {
    memory.clear();
    write.setUnseenRecheckForTests(0);
  });

  it('releases when no RPC saw the hash and the nonce did not move, including a lower nonce', async function () {
    const signer = Wallet.createRandom();
    await hold.writeHold(store, 42161, signer.address, { nonce: 4, hash: HASH });
    const calls = { hash: 0 };
    const rpc = provider(42161, async (url, method) => {
      if (method === 'eth_getTransactionCount') return '0x3';
      if (method === 'eth_getTransactionByHash') {
        calls.hash += 1;
        return null;
      }
      throw new Error(method + url);
    });
    expect(await rpc.getTransactionCount(signer.address, 'pending')).to.equal(3);
    expect(calls.hash).to.equal(2);
    expect(await hold.readHold(store, 42161, signer.address)).to.equal(null);
  });

  it('keeps a hold from another chain and drops one whose nonce already moved', async function () {
    const signer = Wallet.createRandom();
    await hold.writeHold(store, 42161, signer.address, { nonce: 4, hash: HASH });
    const other = provider(421614, async (_url, method) => {
      if (method === 'eth_getTransactionCount') return '0x5';
      if (method === 'eth_getTransactionByHash') return null;
      throw new Error(method);
    });
    expect(await other.getTransactionCount(signer.address, 'pending')).to.equal(5);
    expect((await hold.readHold(store, 42161, signer.address)).nonce).to.equal(4);

    const inflated = provider(42161, async (_url, method) => {
      if (method === 'eth_getTransactionCount') return '0x8';
      if (method === 'eth_getTransactionByHash') return null;
      throw new Error(method);
    });
    expect(await inflated.getTransactionCount(signer.address, 'pending')).to.equal(8);
    expect(await hold.readHold(store, 42161, signer.address)).to.equal(null);
  });

  it('polls a send seen by one RPC and blocks the next nonce', async function () {
    const signer = Wallet.createRandom();
    const raw = await signer.signTransaction({
      to: signer.address,
      nonce: 4,
      gasLimit: 21_000,
      gasPrice: 1,
      chainId: 42161,
      value: 0,
    });
    const hash = Transaction.from(raw).hash;
    let receipts = 0;
    const rpc = provider(42161, async (url, method) => {
      if (method === 'eth_getTransactionCount') return '0x4';
      if (method === 'eth_sendRawTransaction') throw new Error('timeout');
      if (method === 'eth_getTransactionByHash') {
        return url.endsWith('a.example') ? { hash } : null;
      }
      throw new Error(method);
    });
    rpc.getTransactionReceipt = async () => {
      receipts += 1;
      return null;
    };
    const first = await rpc.broadcastTransaction(raw);
    expect(first.broadcastSeen).to.equal(1);
    expect(first.broadcastKind).to.equal('pending');
    expect((await hold.readHold(store, 42161, signer.address)).nonce).to.equal(4);
    let pending = '';
    try {
      await wait.waitMined(first, 20);
    } catch (error) {
      pending = error.message;
    }
    expect(pending).to.equal('tx-pending');
    expect(receipts).to.be.greaterThan(0);
    const second = await signer.signTransaction({
      to: signer.address,
      nonce: 5,
      gasLimit: 21_000,
      gasPrice: 1,
      chainId: 42161,
      value: 0,
    });
    let blocked = '';
    try {
      await rpc.broadcastTransaction(second);
    } catch (error) {
      blocked = error.message;
    }
    expect(blocked).to.equal('pending-nonce');
  });

  it('says the send never reached the network after a second look, and a discard clears it', async function () {
    const signer = Wallet.createRandom();
    const raw = await signer.signTransaction({
      to: signer.address,
      nonce: 4,
      gasLimit: 21_000,
      gasPrice: 1,
      chainId: 42161,
      value: 0,
    });
    let lookups = 0;
    const rpc = provider(42161, async (_url, method) => {
      if (method === 'eth_getTransactionCount') return '0x4';
      if (method === 'eth_sendRawTransaction') throw new Error('timeout');
      if (method === 'eth_getTransactionByHash') {
        lookups += 1;
        return null;
      }
      throw new Error(method);
    });
    let unseen = '';
    try {
      await rpc.broadcastTransaction(raw);
    } catch (error) {
      unseen = error.message;
    }
    expect(unseen).to.equal('broadcast-unseen');
    expect(lookups).to.be.greaterThan(2);
    expect(await hold.readHold(store, 42161, signer.address)).to.equal(null);
    await hold.writeHold(store, 42161, signer.address, { nonce: 4, hash: HASH });
    expect(await write.discardPendingSends(42161)).to.equal(1);
    expect(await hold.readHold(store, 42161, signer.address)).to.equal(null);
  });
});
