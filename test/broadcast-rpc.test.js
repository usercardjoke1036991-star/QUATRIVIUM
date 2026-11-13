const path = require('path');
const { expect } = require('chai');
const { loadTs } = require('./loadTsApp.cjs');

const broadcast = loadTs(path.join(__dirname, '..', 'utils', 'broadcastRpc.ts'));

const HASH = '0x' + 'ab'.repeat(32);
const RAW = '0xsigned';

function world(spec) {
  const sent = [];
  let emitted = false;
  const call = async (url, method, params) => {
    const node = spec[url];
    if (!node) throw new Error('missing');
    if (method === 'eth_sendRawTransaction') {
      sent.push({ url, raw: params[0] });
      if (node.delay) await new Promise((resolve) => setTimeout(resolve, node.delay));
      if (node.sendError) {
        if (node.emit) emitted = true;
        throw new Error(node.sendError);
      }
      if (node.failSend) throw new Error('down');
      emitted = true;
      return node.returnHash || HASH;
    }
    if (method === 'eth_getTransactionByHash') {
      const visible = node.see === 'after' ? emitted : Boolean(node.see);
      return visible ? { hash: HASH } : null;
    }
    if (method === 'eth_getTransactionCount') {
      if (node.countError) throw new Error('down');
      return '0x' + (node.nonce ?? 5).toString(16);
    }
    throw new Error(method);
  };
  return { call, sent };
}

describe('rpc broadcast and money quorum', function () {
  it('compares two sources and hides a lie or a single answer', async function () {
    const { agreeValues: agree } = broadcast;
    const mismatch = await agree(
      [
        async () => {
          throw new Error('down');
        },
        async () => 10n,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return 99n;
        },
      ],
      (left, right) => left === right
    );
    expect(mismatch.kind).to.equal('mismatch');
    const agreed = await agree(
      [
        async () => {
          throw new Error('down');
        },
        async () => 7n,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return 7n;
        },
      ],
      (left, right) => left === right
    );
    expect(agreed).to.deep.equal({ kind: 'value', value: 7n });
    const none = await agree(
      [
        async () => {
          throw new Error('a');
        },
        async () => {
          throw new Error('b');
        },
      ],
      (left, right) => left === right
    );
    expect(none.kind).to.equal('unavailable');
  });

  const FROM = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';

  it('does not sign a second transaction when a node fails, lies or answers late', async function () {
    const failThenSlow = world({
      'https://fail.example': { failSend: true, nonce: 5 },
      'https://slow.example': { delay: 40, see: true, nonce: 5 },
    });
    const pending = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://fail.example', 'https://slow.example'],
      raw: RAW,
      from: FROM,
      nonce: 5,
      hash: HASH,
      call: failThenSlow.call,
    });
    expect(pending).to.deep.equal({ kind: 'pending', hash: HASH });
    expect(new Set(failThenSlow.sent.map((row) => row.raw)).size).to.equal(1);

    const accepted = world({
      'https://liar.example': { nonce: 5, see: false },
      'https://witness.example': { nonce: 9, see: false, failSend: true },
    });
    const kept = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://liar.example', 'https://witness.example'],
      raw: RAW,
      from: FROM,
      nonce: 5,
      hash: HASH,
      call: accepted.call,
    });
    expect(kept.kind).to.equal('pending');
    expect(accepted.sent).to.deep.equal([{ url: 'https://liar.example', raw: RAW }]);

    const oneWitness = world({
      'https://slow.example': { delay: 20, see: true, nonce: 5 },
      'https://liar.example': { nonce: 5, see: false },
    });
    const hidden = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://slow.example', 'https://liar.example'],
      raw: RAW,
      from: FROM,
      nonce: 5,
      hash: HASH,
      call: oneWitness.call,
    });
    expect(hidden.kind).to.equal('pending');
    expect(oneWitness.sent.map((row) => row.url)).to.deep.equal(['https://slow.example']);
  });

  it('treats a cut response and already-known as the same transaction', async function () {
    const net = world({
      'https://cut.example': { sendError: 'aborted', emit: true },
      'https://known.example': { sendError: 'already known', see: 'after' },
      'https://low.example': { sendError: 'nonce too low', see: 'after' },
    });
    const sent = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://cut.example', 'https://known.example', 'https://low.example'],
      raw: RAW,
      from: FROM,
      nonce: 5,
      hash: HASH,
      call: net.call,
    });
    expect(sent).to.deep.equal({ kind: 'sent', hash: HASH });
    expect(new Set(net.sent.map((row) => row.raw)).size).to.equal(1);

    const unseen = world({
      'https://cut.example': { sendError: 'aborted', see: false },
      'https://known.example': { sendError: 'already known', see: false },
      'https://low.example': { sendError: 'nonce too low', see: false },
    });
    const waiting = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://cut.example', 'https://known.example', 'https://low.example'],
      raw: RAW,
      from: FROM,
      nonce: 5,
      hash: HASH,
      call: unseen.call,
    });
    expect(waiting).to.deep.equal({ kind: 'pending', hash: HASH });
    expect(new Set(unseen.sent.map((row) => row.raw)).size).to.equal(1);
  });

  it('does not trust one rpc that claims to see the transaction', async function () {
    const lie = world({
      'https://liar.example': { see: true, nonce: 4 },
      'https://a.example': { see: false, nonce: 4 },
      'https://b.example': { see: false, nonce: 4 },
    });
    const outcome = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://liar.example', 'https://a.example', 'https://b.example'],
      raw: RAW,
      from: FROM,
      nonce: 4,
      hash: HASH,
      call: lie.call,
    });
    expect(outcome.kind).to.equal('pending');
    expect(
      await broadcast.hashSightings(
        ['https://liar.example', 'https://a.example', 'https://b.example'],
        HASH,
        lie.call
      )
    ).to.equal(1);
  });

  it('takes the highest pending nonce when the first rpc is down or behind', async function () {
    const down = world({
      'https://down.example': { countError: true },
      'https://ok.example': { nonce: 5 },
      'https://ahead.example': { nonce: 8 },
    });
    expect(
      await broadcast.highestPendingNonce(
        ['https://down.example', 'https://ok.example', 'https://ahead.example'],
        FROM,
        down.call
      )
    ).to.equal(8);
    const behind = world({
      'https://old.example': { nonce: 3 },
      'https://new.example': { nonce: 6 },
    });
    expect(
      await broadcast.highestPendingNonce(
        ['https://old.example', 'https://new.example'],
        FROM,
        behind.call
      )
    ).to.equal(6);
    try {
      await broadcast.highestPendingNonce(
        ['https://down.example', 'https://ok.example'],
        FROM,
        down.call
      );
      expect.fail('one source is not a nonce');
    } catch (error) {
      expect(error.message).to.equal('nonce-unconfirmed');
    }
    let heldNonce = '';
    try {
      broadcast.nonceAfterHold(5, { nonce: 5, hash: HASH });
    } catch (error) {
      heldNonce = error.message;
    }
    expect(heldNonce).to.equal('pending-nonce');
    expect(broadcast.nonceAfterHold(8, { nonce: 5, hash: HASH })).to.equal(8);
    let otherNonce = '';
    try {
      broadcast.rejectReusedNonce({ nonce: 5, hash: HASH }, 6, HASH);
    } catch (error) {
      otherNonce = error.message;
    }
    expect(otherNonce).to.equal('pending-nonce');
    try {
      broadcast.rejectReusedNonce({ nonce: 5, hash: HASH }, 5, '0x' + 'cd'.repeat(32));
      otherNonce = 'signed';
    } catch (error) {
      otherNonce = error.message;
    }
    expect(otherNonce).to.equal('pending-nonce');
    broadcast.rejectReusedNonce({ nonce: 5, hash: HASH }, 5, HASH);
    const fee = await broadcast.highestFee([
      async () => {
        throw new Error('down');
      },
      async () => ({ maxFee: 10n, tip: 1n }),
      async () => ({ maxFee: 30n, tip: 2n }),
    ]);
    expect(fee).to.deep.equal({ maxFee: 30n, tip: 2n });
  });

  it('text: the 17 languages have the money warning', function () {
    const fs = require('fs');
    const path = require('path');
    const langs = [
      'es',
      'en',
      'zh',
      'hi',
      'ar',
      'bn',
      'pt',
      'ru',
      'ur',
      'id',
      'fr',
      'ja',
      'de',
      'ko',
      'tr',
      'vi',
      'it',
    ];
    const seen = new Set();
    for (const lang of langs) {
      const data = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'i18n', 'locales', `${lang}.json`), 'utf8')
      );
      expect(typeof data.rpcMoneyUnconfirmed).to.equal('string');
      expect(data.rpcMoneyUnconfirmed.length).to.be.greaterThan(0);
      seen.add(data.rpcMoneyUnconfirmed);
    }
    expect(seen.size).to.equal(langs.length);
  });
});
