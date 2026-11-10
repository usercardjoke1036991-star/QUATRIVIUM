const path = require('path');
const { expect } = require('chai');
const { loadTs } = require('./loadTsApp.cjs');

const hold = loadTs(path.join(__dirname, '..', 'utils', 'pendingHold.ts'));
const broadcast = loadTs(path.join(__dirname, '..', 'utils', 'broadcastRpc.ts'));
const wait = loadTs(path.join(__dirname, '..', 'utils', 'waitMined.ts'));
const errors = loadTs(path.join(__dirname, '..', 'utils', 'txErrors.ts'));

const FROM = '0x' + '11'.repeat(20);
const HASH = '0x' + 'ab'.repeat(32);

function memoryStore() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
  };
}

describe('pending send hold', function () {
  it('keeps one signature after a cut and drops a send that never landed', async function () {
    const store = memoryStore();
    expect(
      await hold.settleHold(store, { from: FROM, nonce: 4, hash: HASH, release: false })
    ).to.equal('held');
    const again = memoryStore();
    await again.set('quatrivium.pendingSend.v1', await store.get('quatrivium.pendingSend.v1'));
    const saved = await hold.readHold(again, FROM);
    expect(saved.nonce).to.equal(4);
    expect(saved.hash).to.equal(HASH);
    expect(hold.shouldReleaseHold(1, 4, saved)).to.equal(false);
    expect(hold.shouldReleaseHold(0, 4, saved)).to.equal(true);
    expect(
      await hold.settleHold(store, { from: FROM, nonce: 4, hash: HASH, release: true })
    ).to.equal('released');
    expect(await hold.readHold(store, FROM)).to.equal(null);
  });

  it('does not sign another nonce after a cut, and a restart still blocks', async function () {
    const sent = [];
    let emitted = false;
    const call = async (url, method, params) => {
      if (method === 'eth_sendRawTransaction') {
        sent.push(params[0]);
        if (url.endsWith('a')) {
          emitted = true;
          throw new Error('timeout');
        }
        throw new Error('down');
      }
      if (method === 'eth_getTransactionByHash') {
        return url.endsWith('a') && emitted ? { hash: HASH } : null;
      }
      if (method === 'eth_getTransactionCount') return '0x4';
      throw new Error(method);
    };
    const first = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://a', 'https://b'],
      raw: '0xsigned',
      from: FROM,
      nonce: 4,
      hash: HASH,
      call,
    });
    expect(first.kind).to.equal('pending');
    expect(sent.length > 0).to.equal(true);
    expect(sent.every((raw) => raw === '0xsigned')).to.equal(true);
    const store = memoryStore();
    await hold.writeHold(store, FROM, { nonce: 4, hash: first.hash });
    const restarted = memoryStore();
    await restarted.set('quatrivium.pendingSend.v1', await store.get('quatrivium.pendingSend.v1'));
    const saved = await hold.readHold(restarted, FROM);
    let blocked = '';
    try {
      broadcast.nonceAfterHold(4, saved);
    } catch (error) {
      blocked = error.message;
    }
    expect(blocked).to.equal('pending-nonce');
    try {
      broadcast.rejectReusedNonce(saved, 5, '0x' + 'cd'.repeat(32));
      blocked = 'signed';
    } catch (error) {
      blocked = error.message;
    }
    expect(blocked).to.equal('pending-nonce');
    broadcast.rejectReusedNonce(saved, 4, HASH);
    expect(sent.every((raw) => raw === '0xsigned')).to.equal(true);
  });

  it('shows a pending hash instead of a failed wait', async function () {
    let message = '';
    let hash = '';
    try {
      await wait.waitMined({ hash: HASH, broadcastKind: 'pending' }, 20);
    } catch (error) {
      message = error.message;
      hash = error.hash;
    }
    expect(message).to.equal('tx-pending');
    expect(hash).to.equal(HASH);
    const text = errors.humanizeTxError({ message: 'tx-pending', hash: HASH });
    expect(text.includes(HASH)).to.equal(true);
    expect(text.toLowerCase().includes('pending') || text.includes('pendiente')).to.equal(true);
  });
});
