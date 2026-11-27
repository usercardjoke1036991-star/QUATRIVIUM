const fs = require('fs');
const path = require('path');
const Module = require('module');
const { expect } = require('chai');
const { Wallet, getAddress } = require('ethers');
const { loadTs } = require('./loadTsApp.cjs');
const root = path.join(__dirname, '..');
const CHALLENGE_FILE = path.join(root, 'services', 'linkChallenge.ts');
const LINKED_FILE = path.join(root, 'services', 'linkedWallet.ts');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BASE_TS = 1_700_000_000;
const H0 = 5_000_000;
const memory = new Map();
const storageMock = {
  async getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItem(key, value) {
    memory.set(key, String(value));
  },
  async removeItem(key) {
    memory.delete(key);
  },
};
/** Carga con AsyncStorage en memoria. `fresh` borra el módulo del caché: es la app recién abierta. */
function loadWithStorage(file, fresh = false) {
  const storageFile = require.resolve('@react-native-async-storage/async-storage');
  const previous = Module._cache[storageFile];
  const mock = new Module(storageFile);
  mock.filename = storageFile;
  mock.loaded = true;
  mock.exports = storageMock;
  Module._cache[storageFile] = mock;
  if (fresh) delete Module._cache[file];
  try {
    return loadTs(file);
  } finally {
    if (previous) Module._cache[storageFile] = previous;
    else delete Module._cache[storageFile];
  }
}
function challengeModule(fresh = false) {
  expect(fs.existsSync(CHALLENGE_FILE), 'services/linkChallenge.ts').to.equal(true);
  return loadWithStorage(CHALLENGE_FILE, fresh);
}
const hex = (n) => `0x${n.toString(16)}`;
const word = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const topic = (address) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
function makeWorld() {
  return {
    head: H0,
    transfers: [],
    hash: (n) => word(n + 0xabc),
    ts: (n) => BASE_TS + n,
  };
}
function toLog(world, t) {
  return {
    address: t.token,
    topics: [TRANSFER_TOPIC, topic(t.from), topic(t.to)],
    data: word(t.amount),
    blockNumber: hex(t.block),
    blockHash: world.hash(t.block),
    transactionHash: t.hash,
    removed: false,
  };
}
/** Nodo que no filtra por remitente ni destino: la app tiene que validar cada log. */
function honest(world, { maxRange = 0, ignoreRange = false, anyToken = false, extra = [] } = {}) {
  const all = () => world.transfers.concat(extra);
  return async (method, params) => {
    if (method === 'eth_blockNumber') return hex(world.head);
    if (method === 'eth_getBlockByNumber') {
      const n = Number.parseInt(params[0], 16);
      if (n > world.head) return null;
      return { number: hex(n), hash: world.hash(n), timestamp: hex(world.ts(n)) };
    }
    if (method === 'eth_getLogs') {
      const { address, fromBlock, toBlock } = params[0];
      const from = Number.parseInt(fromBlock, 16);
      const to = Number.parseInt(toBlock, 16);
      if (maxRange && to - from + 1 > maxRange) throw new Error('block range too large');
      return all()
        .filter((t) => anyToken || t.token.toLowerCase() === address.toLowerCase())
        .filter((t) => ignoreRange || (t.block >= from && t.block <= to))
        .map((t) => toLog(world, t));
    }
    if (method === 'eth_getTransactionReceipt') {
      const t = all().find((row) => row.hash === params[0]);
      if (!t || t.block > world.head) return null;
      return {
        status: '0x1',
        transactionHash: t.hash,
        blockNumber: hex(t.block),
        blockHash: world.hash(t.block),
        logs: [toLog(world, t)],
      };
    }
    throw new Error(`method ${method}`);
  };
}
/** Nodo que oculta todo: sin logs ni recibos. */
function hider(world) {
  const base = honest(world);
  return async (method, params) => {
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_getTransactionReceipt') return null;
    return base(method, params);
  };
}
function down() {
  return async () => {
    throw new Error('offline');
  };
}
function rpc(nodes) {
  const urls = Object.keys(nodes);
  return { urls, call: (url, method, params) => nodes[url](method, params) };
}
const INTERNAL = getAddress(Wallet.createRandom().address);
const EXTERNAL = getAddress(Wallet.createRandom().address);
const STRANGER = getAddress(Wallet.createRandom().address);
const TOKEN = getAddress('0x93b346b6BC2548dA6A1E7d98E9a421B42541425b');
let txSeq = 1;
const txHash = () => word(0xfeed0000 + txSeq++);
async function newChallenge(world, nodes, slot = 4242) {
  const mod = challengeModule();
  return mod.createLinkChallenge({
    internal: INTERNAL,
    external: EXTERNAL,
    token: TOKEN,
    decimals: 18,
    slot: () => slot,
    rpc: rpc(nodes),
  });
}
function send(world, challenge, overrides = {}) {
  const t = {
    token: TOKEN,
    from: EXTERNAL,
    to: INTERNAL,
    amount: BigInt(challenge.amountWei),
    block: challenge.startBlock + 10,
    hash: txHash(),
    ...overrides,
  };
  world.transfers.push(t);
  return t;
}
describe('vínculo de retiro por transferencia de prueba', function () {
  beforeEach(function () {
    memory.clear();
  });
  it('crea un monto único de 0,01 LUSD con 8 decimales y no repite uno usado', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = { 'https://a': honest(world), 'https://b': honest(world) };
    const amount = mod.linkTestAmountWei(18, 4242);
    expect(amount).to.equal(1_004_242n * 10n ** 10n);
    const slots = [4242, 4242, 7];
    const ch = await mod.createLinkChallenge({
      internal: INTERNAL,
      external: EXTERNAL.toLowerCase(),
      token: TOKEN,
      decimals: 18,
      used: [amount.toString()],
      slot: () => slots.shift(),
      rpc: rpc(nodes),
    });
    expect(ch.amountWei).to.equal((1_000_007n * 10n ** 10n).toString());
    expect(ch.external).to.equal(EXTERNAL);
    expect(ch.startBlock).to.equal(H0);
    expect(ch.startTime).to.equal(BASE_TS + H0);
    for (let i = 0; i < 200; i += 1) {
      const slot = mod.randomLinkSlot();
      expect(slot).to.be.within(1, mod.LINK_AMOUNT_SLOTS);
    }
    expect(mod.checkExternalAddress(INTERNAL, 'hola')).to.deep.equal({
      ok: false,
      error: 'linkWalletAddressInvalid',
    });
    expect(mod.checkExternalAddress(INTERNAL, INTERNAL.toLowerCase()).error).to.equal(
      'linkWalletAddressSelf'
    );
  });
  it('vincula cuando dos RPC confirman el Transfer exacto, y guarda transfer:', async function () {
    const mod = challengeModule();
    const linked = loadWithStorage(LINKED_FILE);
    const world = makeWorld();
    const nodes = { 'https://a': honest(world), 'https://b': honest(world), 'https://c': down() };
    const ch = await newChallenge(world, nodes);
    const t = send(world, ch);
    world.head = ch.startBlock + 100;
    const result = await mod.checkLinkChallenge(ch, rpc(nodes));
    expect(result).to.deep.equal({
      status: 'linked',
      proof: { external: EXTERNAL, txHash: t.hash, chainId: ch.chainId },
    });
    const saved = await linked.saveLinkedExternalWallet(INTERNAL, result.proof);
    expect(saved).to.equal(EXTERNAL);
    const key = linked.linkedWalletStorageKey(INTERNAL);
    expect(memory.get(key)).to.equal(`transfer:${EXTERNAL}:${t.hash}`);
    expect(await linked.loadRequiredExternalWallet(INTERNAL)).to.equal(EXTERNAL);
    memory.set(key, `proven:${STRANGER}`);
    expect(await linked.loadRequiredExternalWallet(INTERNAL)).to.equal(STRANGER);
    memory.set(key, `typed:${STRANGER}`);
    expect(await linked.loadRequiredExternalWallet(INTERNAL)).to.equal('');
    memory.set(key, `transfer:${STRANGER}`);
    expect(await linked.loadRequiredExternalWallet(INTERNAL)).to.equal('');
    let threw = 0;
    for (const proof of [
      { ...result.proof, chainId: ch.chainId + 1 },
      { ...result.proof, txHash: '0x1234' },
      { ...result.proof, external: INTERNAL },
    ]) {
      try {
        await linked.saveLinkedExternalWallet(INTERNAL, proof);
      } catch {
        threw += 1;
      }
    }
    expect(threw).to.equal(3);
  });
  it('no vincula con remitente equivocado, monto distinto u otro token', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = { 'https://a': honest(world), 'https://b': honest(world) };
    const ch = await newChallenge(world, nodes);
    send(world, ch, { from: STRANGER });
    send(world, ch, { amount: BigInt(ch.amountWei) + 1n });
    send(world, ch, { to: STRANGER });
    world.head = ch.startBlock + 100;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('waiting');
    const other = getAddress(`0x${'22'.repeat(20)}`);
    send(world, ch, { token: other });
    const anyToken = {
      'https://a': honest(world, { anyToken: true }),
      'https://b': honest(world, { anyToken: true }),
    };
    expect((await mod.checkLinkChallenge(ch, rpc(anyToken))).status).to.equal('waiting');
  });
  it('no acepta una transferencia anterior al desafío aunque el RPC la devuelva', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = {
      'https://a': honest(world, { ignoreRange: true }),
      'https://b': honest(world, { ignoreRange: true }),
    };
    const ch = await newChallenge(world, nodes);
    send(world, ch, { block: ch.startBlock - 5 });
    world.head = ch.startBlock + 100;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('waiting');
  });
  it('caduca: una transferencia después del plazo no vale y el desafío queda expired', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = { 'https://a': honest(world), 'https://b': honest(world) };
    const ch = await newChallenge(world, nodes);
    world.head = ch.startBlock + 1000;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('waiting');
    send(world, ch, { block: ch.startBlock + mod.LINK_TTL_SECONDS + 5 });
    world.head = ch.startBlock + mod.LINK_TTL_SECONDS + 200;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('expired');
  });
  it('espera confirmaciones: una transferencia muy reciente todavía no vincula', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = { 'https://a': honest(world), 'https://b': honest(world) };
    const ch = await newChallenge(world, nodes);
    send(world, ch, { block: ch.startBlock + 50 });
    world.head = ch.startBlock + 55;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('waiting');
    world.head = ch.startBlock + 50 + mod.LINK_CONFIRMATIONS;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('linked');
  });
  it('un RPC que inventa el log y su recibo no basta para vincular', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const ch = await newChallenge(world, {
      'https://a': honest(world),
      'https://b': honest(world),
      'https://c': honest(world),
    });
    world.head = ch.startBlock + 100;
    const fake = {
      token: TOKEN,
      from: EXTERNAL,
      to: INTERNAL,
      amount: BigInt(ch.amountWei),
      block: ch.startBlock + 10,
      hash: txHash(),
    };
    const nodes = {
      'https://a': honest(world, { extra: [fake] }),
      'https://b': honest(world),
      'https://c': honest(world),
    };
    const result = await mod.checkLinkChallenge(ch, rpc(nodes));
    expect(result.status).to.equal('unconfirmed');
    expect(result).to.not.have.property('proof');
  });
  it('un RPC que oculta los logs o devuelve vacío no impide vincular con otros dos', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = {
      'https://a': hider(world),
      'https://b': honest(world),
      'https://c': honest(world),
    };
    const ch = await newChallenge(world, nodes);
    const t = send(world, ch);
    world.head = ch.startBlock + 100;
    const result = await mod.checkLinkChallenge(ch, rpc(nodes));
    expect(result.status).to.equal('linked');
    expect(result.proof.txHash).to.equal(t.hash);
    const lonely = { 'https://a': hider(world), 'https://b': honest(world), 'https://c': down() };
    expect((await mod.checkLinkChallenge(ch, rpc(lonely))).status).to.equal('unconfirmed');
  });
  it('parte eth_getLogs cuando el RPC limita el rango de bloques', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const nodes = {
      'https://a': honest(world, { maxRange: 1000 }),
      'https://b': honest(world, { maxRange: 600 }),
    };
    const ch = await newChallenge(world, nodes);
    send(world, ch, { block: ch.startBlock + 3000 });
    world.head = ch.startBlock + 3100;
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('linked');
  });
  it('sin red: offline al crear y al comprobar', async function () {
    const mod = challengeModule();
    const world = makeWorld();
    const ch = await newChallenge(world, { 'https://a': honest(world) });
    const nodes = { 'https://a': down(), 'https://b': down() };
    expect((await mod.checkLinkChallenge(ch, rpc(nodes))).status).to.equal('offline');
    let error = '';
    try {
      await newChallenge(world, nodes);
    } catch (caught) {
      error = caught.message;
    }
    expect(error).to.equal('offline');
  });
  it('reanuda tras cerrar la app: el desafío guardado se recupera y se comprueba', async function () {
    const world = makeWorld();
    const nodes = { 'https://a': honest(world), 'https://b': honest(world) };
    const first = challengeModule();
    const ch = await newChallenge(world, nodes, 99);
    await first.saveLinkChallenge(ch);
    const t = send(world, ch);
    world.head = ch.startBlock + 100;
    const reopened = challengeModule(true);
    expect(reopened).to.not.equal(first);
    const stored = await reopened.loadLinkChallenge(INTERNAL);
    expect(stored).to.deep.equal(ch);
    const result = await reopened.checkLinkChallenge(stored, rpc(nodes));
    expect(result.status).to.equal('linked');
    expect(result.proof.txHash).to.equal(t.hash);
    await reopened.clearLinkChallenge(INTERNAL);
    expect(await reopened.loadLinkChallenge(INTERNAL)).to.equal(null);
    expect(await reopened.usedLinkAmounts(INTERNAL)).to.deep.equal([ch.amountWei]);
    const key = reopened.linkChallengeKey(INTERNAL);
    memory.set(key, JSON.stringify({ challenge: { ...ch, chainId: ch.chainId + 1 }, used: [] }));
    expect(await reopened.loadLinkChallenge(INTERNAL)).to.equal(null);
    memory.set(key, '{roto');
    expect(await reopened.loadLinkChallenge(INTERNAL)).to.equal(null);
  });
  it('el formulario pide la clave de la app antes de guardar y retoma el desafío', function () {
    const form = fs.readFileSync(path.join(root, 'components', 'LinkWalletForm.tsx'), 'utf8');
    const check = form.indexOf('await checkLinkChallenge(current)');
    const confirm = form.indexOf("await confirmFunds('security')");
    const save = form.indexOf('saveLinkedExternalWallet(internalWallet, result.proof)');
    expect(check).to.be.greaterThan(-1);
    expect(confirm).to.be.greaterThan(check);
    expect(save).to.be.greaterThan(confirm);
    expect(form).to.include('loadLinkChallenge(internalWallet)');
    expect(form).to.include('saveLinkChallenge(next)');
    expect(form).to.include("t('linkTestKept')");
    expect(form).to.not.include('typed:');
  });
});
