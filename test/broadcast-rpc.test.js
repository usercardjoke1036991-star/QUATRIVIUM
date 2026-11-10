const path = require('path');
const { expect } = require('chai');
const { loadTs } = require('./loadTsApp.cjs');

const broadcast = loadTs(path.join(__dirname, '..', 'utils', 'broadcastRpc.ts'));

const HASH = '0x' + 'ab'.repeat(32);
const RAW = '0xsigned';

function world(spec) {
  const sent = [];
  const call = async (url, method, params) => {
    const node = spec[url];
    if (!node) throw new Error('missing');
    if (method === 'eth_sendRawTransaction') {
      sent.push({ url, raw: params[0] });
      if (node.delay) await new Promise((resolve) => setTimeout(resolve, node.delay));
      if (node.failSend) throw new Error('down');
      return node.returnHash || HASH;
    }
    if (method === 'eth_getTransactionByHash') {
      return node.see ? { hash: HASH } : null;
    }
    if (method === 'eth_getTransactionCount') {
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

  it('does not send a second transaction when one node fails, lies or is slow', async function () {
    const failThenSlow = world({
      'https://fail.example': { failSend: true, nonce: 5 },
      'https://slow.example': { delay: 40, see: true, nonce: 5 },
    });
    const hash = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://fail.example', 'https://slow.example'],
      raw: RAW,
      from: '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047',
      nonce: 5,
      hash: HASH,
      call: failThenSlow.call,
    });
    expect(hash).to.equal(HASH);
    expect(new Set(failThenSlow.sent.map((row) => row.raw)).size).to.equal(1);
    expect(failThenSlow.sent.map((row) => row.url)).to.deep.equal([
      'https://fail.example',
      'https://slow.example',
    ]);

    const liar = world({
      'https://liar.example': { nonce: 5, see: false },
      'https://witness.example': { nonce: 6, see: false, failSend: true },
    });
    const kept = await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://liar.example', 'https://witness.example'],
      raw: RAW,
      from: '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047',
      nonce: 5,
      hash: HASH,
      call: liar.call,
    });
    expect(kept).to.equal(HASH);
    expect(liar.sent).to.deep.equal([{ url: 'https://liar.example', raw: RAW }]);

    const slowFirst = world({
      'https://slow.example': { delay: 30, see: true, nonce: 5 },
      'https://liar.example': { nonce: 5, see: false },
    });
    await broadcast.broadcastRawAcrossRpcs({
      urls: ['https://slow.example', 'https://liar.example'],
      raw: RAW,
      from: '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047',
      nonce: 5,
      hash: HASH,
      call: slowFirst.call,
    });
    expect(slowFirst.sent.map((row) => row.url)).to.deep.equal(['https://slow.example']);
    expect(new Set(slowFirst.sent.map((row) => row.raw)).size).to.equal(1);

    let calls = 0;
    try {
      await broadcast.broadcastRawAcrossRpcs({
        urls: ['https://liar.example', 'https://slow.example'],
        raw: RAW,
        from: '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047',
        nonce: 5,
        hash: HASH,
        call: async (_url, method) => {
          calls += 1;
          if (method === 'eth_sendRawTransaction') return '0x' + 'cd'.repeat(32);
          return null;
        },
      });
      expect.fail('a different hash must stop the walk');
    } catch (error) {
      expect(error.message).to.equal('hash-mismatch');
    }
    expect(calls).to.equal(1);
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
