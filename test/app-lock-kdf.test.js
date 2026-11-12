const path = require('path');
const Module = require('module');
const { expect } = require('chai');
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

let crashOnLiveWrap = false;
let crashOnSecretPromote = false;
let rejectDeviceAuth = false;
let authError = 'no-credential';
let randomByte = 0;
const secureWrites = [];
const secretReads = [];
const secretMeta = new Map();
const SECRET_KEY = 'quatrivium.lock.deviceSecret';

installMock('expo-secure-store', {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
  async getItemAsync(key, options) {
    if (key === SECRET_KEY) secretReads.push(key);
    if (options && options.requireAuthentication) {
      if (!memory.has(key)) return null;
      if (rejectDeviceAuth) throw new Error(authError);
    } else if (secretMeta.get(key) && secretMeta.get(key).requireAuthentication) {
      throw new Error('auth-required');
    }
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItemAsync(key, value, options) {
    if (crashOnLiveWrap && key === PIN_WRAP) throw new Error('crash');
    if (crashOnSecretPromote && key === SECRET_KEY && memory.has(`${SECRET_KEY}.next`)) {
      throw new Error('crash');
    }
    if (rejectDeviceAuth && options && options.requireAuthentication) {
      throw new Error(authError);
    }
    secretMeta.set(key, options || {});
    secureWrites.push({ key, options: options || null });
    memory.set(key, value);
  },
  async deleteItemAsync(key) {
    secretMeta.delete(key);
    memory.delete(key);
  },
});

installMock('expo-crypto', {
  randomUUID: () => 'sal-prueba',
  async getRandomBytesAsync(size) {
    return new Uint8Array(size).fill(randomByte);
  },
});

installMock('@react-native-async-storage/async-storage', {
  async getItem(key) {
    return memory.has(`mem:${key}`) ? memory.get(`mem:${key}`) : null;
  },
  async setItem(key, value) {
    memory.set(`mem:${key}`, value);
  },
  async removeItem(key) {
    memory.delete(`mem:${key}`);
  },
});

installMock('expo-application', {
  async getAndroidId() {
    return 'device';
  },
  nativeApplicationVersion: '0',
});

installMock('react-native', {
  Platform: { OS: 'android' },
});

const kdf = loadTs(path.join(__dirname, '..', 'utils', 'pinKdf.ts'));
const copy = loadTs(path.join(__dirname, '..', 'utils', 'lockFailureCopy.ts'));
const errors = loadTs(path.join(__dirname, '..', 'utils', 'txErrors.ts'));
const box = loadTs(path.join(__dirname, '..', 'utils', 'secretBox.ts'));
const lock = loadTs(path.join(__dirname, '..', 'services', 'appLock.ts'));
const device = loadTs(path.join(__dirname, '..', 'utils', 'deviceSecret.ts'));
const wallet = loadTs(path.join(__dirname, '..', 'services', 'appWallet.ts'));
const rpc = loadTs(path.join(__dirname, '..', 'constants', 'rpcConfig.ts'));
const { sha256, toUtf8Bytes } = require('ethers');

const PIN_RECORD = 'quatrivium.lock.pin';
const PIN_WRAP = 'quatrivium.lock.pinWrap';
const PIN_NEXT = 'quatrivium.lock.pinWrap.next';

const PIN = '847291';
const PASSWORD = 'Clave-9f';
const policy = loadTs(path.join(__dirname, '..', 'utils', 'pinPolicy.ts'));

let mono = 1_000_000;

describe('app lock PBKDF2', function () {
  this.timeout(120000);

  beforeEach(function () {
    mono = 1_000_000;
    lock.setMonoClockForTests(() => mono);
    lock.setChainStampsForTests(() => []);
  });

  afterEach(function () {
    kdf.resetPbkdf2ForTests();
    lock.setLockClockForTests(null);
    lock.setMonoClockForTests(null);
    lock.setChainStampsForTests(() => []);
    device.setScreenLockForTests(null);
    crashOnSecretPromote = false;
    randomByte = 0;
    rpc.setProductMode('live');
  });

  it('matches the published PBKDF2 vector and refuses a missing implementation', async function () {
    const vector = await kdf.pbkdf2Sha256Hex('password', 'salt', 4096);
    expect(vector).to.equal('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
    kdf.setPbkdf2ForTests(null);
    let missing = '';
    try {
      await lock.setPin(PIN);
    } catch (error) {
      missing = error.message;
    }
    expect(missing).to.equal('pbkdf2-missing');
    expect(memory.has(PIN_RECORD)).to.equal(false);
    const text = errors.humanizeTxError({ message: 'pbkdf2-missing' });
    expect(text.includes('candado') || text.includes('lock key')).to.equal(true);
  });

  it('sets and checks a pin and a password with one derivation and without subtle', async function () {
    const previous = global.crypto;
    global.crypto = {};
    try {
      kdf.takeKdfCalls();
      kdf.takeKdfBlocks();
      const wrap = await lock.setPin(PIN);
      expect(kdf.takeKdfCalls()).to.equal(1);
      expect(kdf.takeKdfBlocks()).to.equal(1);
      expect(/^0x[0-9a-f]{64}$/.test(wrap)).to.equal(true);
      const saved = [...memory.values()].find((value) => String(value).includes('pbkdf2-sha256'));
      const record = JSON.parse(saved);
      expect(record.split).to.equal(2);
      expect(record.rounds).to.equal(9000);
      expect(record.device).to.equal(1);
      const deviceHex = memory.get('quatrivium.lock.deviceSecret');
      expect(
        secureWrites.some(
          (row) =>
            row.key === 'quatrivium.lock.deviceSecret' &&
            row.options &&
            row.options.requireAuthentication
        )
      ).to.equal(true);
      const material = await kdf.derivePinMaterial(
        kdf.boundPin(PIN, deviceHex),
        record.salt,
        record.rounds
      );
      expect(kdf.takeKdfCalls()).to.equal(1);
      expect(kdf.takeKdfBlocks()).to.equal(1);
      expect(material.verifier).to.not.equal(material.wrap.slice(2));
      expect(material.verifier).to.equal(record.hash);
      expect(material.wrap).to.equal(wrap);
      const matched = await lock.matchPin(PIN);
      expect(matched).to.equal(true);
      expect(kdf.takeKdfCalls()).to.equal(1);
      expect(kdf.takeKdfBlocks()).to.equal(1);
      const right = await lock.checkPin(PIN);
      expect(right.ok).to.equal(true);
      expect(kdf.takeKdfCalls()).to.equal(1);
      expect(kdf.takeKdfBlocks()).to.equal(1);
      const passwordWrap = await lock.setPassword(PASSWORD);
      expect(kdf.takeKdfCalls()).to.equal(1);
      expect(/^0x[0-9a-f]{64}$/.test(passwordWrap)).to.equal(true);
      const good = await lock.checkPassword(PASSWORD);
      expect(good.ok).to.equal(true);
      expect(kdf.takeKdfCalls()).to.equal(1);
      const bad = await lock.checkPassword('Otra-8z');
      expect(bad.ok).to.equal(false);
      expect(kdf.takeKdfCalls()).to.equal(1);
      memory.delete('quatrivium.lock.gate');
      memory.delete('quatrivium.lock.gate');
      const wrong = await lock.checkPin('193746');
      expect(wrong.ok).to.equal(false);
      expect(kdf.takeKdfCalls()).to.equal(1);
    } finally {
      global.crypto = previous;
    }
  });

  it('migrates a 64-byte pin and a legacy pin, and survives a crash between the two writes', async function () {
    const session = await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    kdf.takeKdfCalls();
    kdf.takeKdfBlocks();
    const wide = await kdf.deriveWidePinMaterial(PIN, 'sal-prueba', 4);
    expect(kdf.takeKdfCalls()).to.equal(1);
    expect(kdf.takeKdfBlocks()).to.equal(2);
    memory.set(
      PIN_RECORD,
      JSON.stringify({
        v: 3,
        salt: 'sal-prueba',
        hash: wide.verifier,
        rounds: 4,
        kdf: 'pbkdf2-sha256',
        split: 1,
      })
    );
    memory.set(PIN_WRAP, box.sealSecret(session, wide.wrap));
    memory.delete('quatrivium.lock.gate');
    crashOnLiveWrap = true;
    let crashed = '';
    try {
      await lock.checkPin(PIN);
    } catch (error) {
      crashed = error.message;
    }
    crashOnLiveWrap = false;
    expect(crashed).to.equal('crash');
    const mid = JSON.parse(memory.get(PIN_RECORD));
    expect(mid.split).to.equal(2);
    expect(mid.rounds).to.equal(9000);
    expect(mid.device).to.equal(1);
    expect(memory.has(PIN_NEXT)).to.equal(true);
    expect(box.openSecret(memory.get(PIN_WRAP), wide.wrap)).to.equal(session);
    memory.delete('quatrivium.lock.gate');
    kdf.takeKdfCalls();
    kdf.takeKdfBlocks();
    const recovered = await lock.checkPin(PIN);
    expect(recovered.ok).to.equal(true);
    expect(kdf.takeKdfCalls()).to.equal(1);
    expect(kdf.takeKdfBlocks()).to.equal(1);
    expect(memory.has(PIN_NEXT)).to.equal(false);

    const legacyHash = sha256(toUtf8Bytes(`sal-prueba:${PIN}`)).slice(2);
    const legacyKey = await box.deriveWrapKeyAsync(PIN, 'sal-prueba', 1);
    memory.set(
      PIN_RECORD,
      JSON.stringify({
        v: 1,
        salt: 'sal-prueba',
        hash: legacyHash,
        rounds: 1,
        kdf: 'sha256',
      })
    );
    memory.set(PIN_WRAP, box.sealSecret(session, legacyKey));
    memory.delete('quatrivium.lock.gate');
    kdf.takeKdfCalls();
    kdf.takeKdfBlocks();
    const legacy = await lock.checkPin(PIN);
    expect(legacy.ok).to.equal(true);
    const moved = JSON.parse(memory.get(PIN_RECORD));
    expect(moved.split).to.equal(2);
    expect(moved.kdf).to.equal('pbkdf2-sha256');
    expect(moved.rounds).to.equal(9000);
    expect(moved.device).to.equal(1);
    expect(kdf.takeKdfBlocks()).to.equal(1);
  });

  it('blocks the pin after ten misses and never deletes the wallet', async function () {
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    memory.set('quatrivium.appWallet.v1', 'sobre');
    memory.delete('quatrivium.lock.attempts');
    kdf.setPbkdf2ForTests(async () => new Uint8Array(32));
    for (let i = 0; i < 9; i += 1) {
      memory.delete('quatrivium.lock.gate');
      const wrong = await lock.checkPin('193746');
      expect(wrong.pinBlocked).to.equal(undefined);
    }
    memory.delete('quatrivium.lock.gate');
    const blocked = await lock.checkPin('193746');
    expect(blocked.pinBlocked).to.equal(true);
    kdf.takeKdfCalls();
    const still = await lock.checkPin(PIN);
    expect(still.pinBlocked).to.equal(true);
    expect(kdf.takeKdfCalls()).to.equal(0);
    memory.delete('quatrivium.lock.gate');
    for (let i = 0; i < 6; i += 1) {
      const gateKey = 'quatrivium.lock.gate';
      if (memory.has(gateKey)) {
        const row = JSON.parse(memory.get(gateKey));
        row.left = 0;
        memory.set(gateKey, JSON.stringify(row));
      }
      const miss = await lock.checkPassword('Otra-8z');
      expect(miss.ok).to.equal(false);
      expect(memory.get('quatrivium.appWallet.v1')).to.equal('sobre');
      if (i === 5) expect(miss.remainingMs).to.be.greaterThan(23 * 60 * 60 * 1000);
    }
    expect(JSON.parse(memory.get('quatrivium.lock.attempts')).password).to.equal(6);
  });

  it('counts failures per wallet and a good pin or password clears that wallet only', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    const walletA = `0x${'11'.repeat(20)}`;
    const walletB = `0x${'22'.repeat(20)}`;
    memory.delete('quatrivium.lock.attempts');
    memory.delete('quatrivium.lock.gate');
    memory.set('quatrivium.device.boundWallet', walletA);
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    memory.set('quatrivium.appWallet.v1', 'sobre');
    for (let i = 0; i < 6; i += 1) {
      const gateKey = `quatrivium.lock.gate.${walletA}`;
      if (memory.has(gateKey)) {
        const row = JSON.parse(memory.get(gateKey));
        row.left = 0;
        memory.set(gateKey, JSON.stringify(row));
      }
      await lock.checkPassword('Otra-8z');
    }
    expect(memory.get('quatrivium.appWallet.v1')).to.equal('sobre');
    expect(JSON.parse(memory.get(`quatrivium.lock.attempts.${walletA}`)).password).to.equal(6);
    memory.set('quatrivium.device.boundWallet', walletB);
    await lock.checkPassword('Otra-8z');
    expect(JSON.parse(memory.get(`quatrivium.lock.attempts.${walletB}`)).password).to.equal(1);
    expect(JSON.parse(memory.get(`quatrivium.lock.attempts.${walletA}`)).password).to.equal(6);
    const gateB = `quatrivium.lock.gate.${walletB}`;
    const waitingB = JSON.parse(memory.get(gateB));
    waitingB.left = 0;
    memory.set(gateB, JSON.stringify(waitingB));
    const opened = await lock.checkPassword(PASSWORD);
    expect(opened.ok).to.equal(true);
    expect(JSON.parse(memory.get(`quatrivium.lock.attempts.${walletB}`)).password).to.equal(0);
    expect(JSON.parse(memory.get(`quatrivium.lock.attempts.${walletA}`)).password).to.equal(6);
    memory.set('quatrivium.device.boundWallet', walletA);
    const gateA = `quatrivium.lock.gate.${walletA}`;
    const waiting = JSON.parse(memory.get(gateA));
    waiting.left = 0;
    memory.set(gateA, JSON.stringify(waiting));
    const pinOk = await lock.checkPin(PIN);
    expect(pinOk.ok).to.equal(true);
    const cleared = JSON.parse(memory.get(`quatrivium.lock.attempts.${walletA}`));
    expect(cleared.pin).to.equal(0);
    expect(cleared.password).to.equal(0);
    expect(memory.get('quatrivium.appWallet.v1')).to.equal('sobre');
    memory.delete('quatrivium.device.boundWallet');
  });

  it('names a blocked pin, a wait in minutes, and a phone read failure', function () {
    const seen = [];
    const t = (key, vars) => {
      seen.push({ key, vars });
      return key;
    };
    const blocked = copy.describeLockFailure(
      'pin',
      { ok: false, remainingMs: 0, locked: true, pinBlocked: true },
      t
    );
    const zero = copy.describeLockFailure('pin', { ok: false, remainingMs: 0, locked: true }, t);
    const wrong = copy.describeLockFailure('pin', { ok: false, remainingMs: 0, locked: false }, t);
    const minutes = copy.describeLockFailure(
      'password',
      { ok: false, remainingMs: 5 * 60 * 1000, locked: true },
      t
    );
    const phone = copy.describeLockFailure(
      'pin',
      { ok: false, remainingMs: 0, locked: false, deviceAuth: true },
      t
    );
    expect(blocked).to.equal('lockPinBlocked');
    expect(zero).to.equal('lockPinBlocked');
    expect(wrong).to.equal('lockPinWrong');
    expect(minutes).to.equal('lockCooldownMinutes');
    expect(seen[3].vars.minutes).to.equal(5);
    expect(phone).to.equal('lockDeviceAuth');
    expect(JSON.stringify(seen).includes('"seconds":0')).to.equal(false);
  });

  it('never opens the live wallet from AsyncStorage', async function () {
    rpc.setProductMode('live');
    memory.set('mem:quatrivium.appWallet.v1.fallback', 'sobre-async');
    const opened = await wallet.loadAppWallet();
    expect(opened).to.equal(null);
    expect(memory.has('mem:quatrivium.appWallet.v1.fallback')).to.equal(false);
    memory.set('quatrivium.appWallet.v1', 'sobre-seguro');
    const still = await wallet.loadAppWallet();
    expect(still).to.equal(null);
    expect(memory.has('mem:quatrivium.appWallet.v1.fallback')).to.equal(false);
  });

  it('keeps a readable secret when the mark is missing and a password ack does not replace it', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.device.boundWallet');
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.deviceSecret');
    memory.delete('quatrivium.lock.deviceAuth');
    secretMeta.clear();
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const hex = memory.get('quatrivium.lock.deviceSecret');
    memory.delete('quatrivium.lock.deviceAuth');
    const loaded = await device.loadDeviceSecret();
    expect(loaded.hex).to.equal(hex);
    expect(loaded.repair).to.equal(true);
    expect(memory.get('quatrivium.lock.deviceSecret')).to.equal(hex);
    const opened = await lock.checkPin(PIN);
    expect(opened.ok).to.equal(true);
    const acked = await lock.checkPassword(PASSWORD);
    expect(acked.ok).to.equal(true);
    expect(memory.has('quatrivium.lock.deviceRepair')).to.equal(false);
    expect(memory.get('quatrivium.lock.deviceSecret')).to.equal(hex);
  });

  it('retries with a new secret only after the phone has a screen lock', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.device.boundWallet');
    memory.delete('quatrivium.lock.gate');
    memory.delete(SECRET_KEY);
    memory.delete('quatrivium.lock.deviceAuth');
    secretMeta.clear();
    rejectDeviceAuth = true;
    try {
      await lock.setPin(PIN);
    } finally {
      rejectDeviceAuth = false;
    }
    const hex = memory.get(SECRET_KEY);
    const previous = JSON.parse(memory.get(PIN_RECORD)).hash;
    expect(memory.get('quatrivium.lock.deviceAuth')).to.equal('0');
    device.setScreenLockForTests(async () => false);
    expect(await lock.retryDeviceProtection(PIN)).to.equal('no-lock');
    expect(memory.get(SECRET_KEY)).to.equal(hex);
    device.setScreenLockForTests(async () => true);
    randomByte = 9;
    expect(await lock.retryDeviceProtection(PIN)).to.equal('bound');
    const next = memory.get(SECRET_KEY);
    expect(next).to.not.equal(hex);
    expect(/^[0-9a-f]{64}$/.test(next)).to.equal(true);
    expect(memory.get('quatrivium.lock.deviceAuth')).to.equal('1');
    expect(JSON.parse(memory.get(PIN_RECORD)).hash).to.not.equal(previous);
    expect(memory.has(`${SECRET_KEY}.next`)).to.equal(false);
    const opened = await lock.checkPin(PIN);
    expect(opened.ok).to.equal(true);
  });

  it('finishes a secret retry that crashed after the pin was resealed', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.device.boundWallet');
    memory.delete(SECRET_KEY);
    memory.delete('quatrivium.lock.deviceAuth');
    memory.delete('quatrivium.lock.gate');
    secretMeta.clear();
    rejectDeviceAuth = true;
    try {
      await lock.setPin(PIN);
    } finally {
      rejectDeviceAuth = false;
    }
    const hex = memory.get(SECRET_KEY);
    device.setScreenLockForTests(async () => true);
    randomByte = 4;
    crashOnSecretPromote = true;
    let crashed = '';
    try {
      await lock.retryDeviceProtection(PIN);
    } catch (error) {
      crashed = error.message;
    }
    expect(crashed).to.equal('crash');
    expect(memory.get(SECRET_KEY)).to.equal(hex);
    expect(memory.has(`${SECRET_KEY}.next`)).to.equal(true);
    crashOnSecretPromote = false;
    const opened = await lock.checkPin(PIN);
    expect(opened.ok).to.equal(true);
    expect(memory.get(SECRET_KEY)).to.not.equal(hex);
    expect(memory.get('quatrivium.lock.deviceAuth')).to.equal('1');
    expect(memory.has(`${SECRET_KEY}.next`)).to.equal(false);
  });

  it('does not read the device secret when the notice mounts or the app becomes active', async function () {
    memory.set('quatrivium.lock.deviceAuth', '0');
    memory.set(SECRET_KEY, 'ab'.repeat(32));
    secretMeta.set(SECRET_KEY, { requireAuthentication: true });
    rpc.setProductMode('demo');
    secretReads.length = 0;
    expect(await device.refreshDeviceNotice()).to.equal('');
    expect(await device.refreshDeviceNotice()).to.equal('');
    expect(secretReads).to.deep.equal([]);
    rpc.setProductMode('live');
    secretReads.length = 0;
    expect(await device.refreshDeviceNotice()).to.equal('lockDeviceNoLock');
    device.setScreenLockForTests(async () => true);
    expect(await device.refreshDeviceNotice()).to.equal('lockDeviceOpen');
    expect(await device.armDeviceRetry()).to.equal('ready');
    expect(secretReads).to.deep.equal([]);
    expect(memory.get('quatrivium.lock.deviceRetry')).to.equal('1');
  });

  it('does not shorten a wait when the clock jumps forward or backward', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    let now = 1_700_000_000_000;
    lock.setLockClockForTests(() => now);
    await lock.setPassword(PASSWORD);
    const first = await lock.checkPassword('Otra-8z');
    expect(first.remainingMs).to.equal(30_000);
    now += 60 * 60 * 1000;
    const jumped = await lock.checkPassword('Otra-8z');
    expect(jumped.locked).to.equal(true);
    expect(jumped.remainingMs).to.equal(30_000);
    now -= 10 * 60 * 1000;
    const backward = await lock.checkPassword('Otra-8z');
    expect(backward.locked).to.equal(true);
    expect(backward.remainingMs).to.equal(30_000);
    now += 30_000;
    const exact = await lock.getPinLockRemaining();
    expect(exact).to.equal(30_000);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(30_000);
  });

  it('counts only open monotonic steps and opens on an agreed chain time', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    const early = 1_700_000_000_000;
    const other = early + 10 * 60_000;
    const agreed = early + 60 * 60_000;
    expect(policy.agreedChainMs([early, other, agreed, agreed + 20_000])).to.equal(agreed);
    expect(policy.agreedChainMs([early, other])).to.equal(null);
    lock.setChainStampsForTests(() => [early, other, agreed, agreed + 20_000]);
    await lock.setPassword(PASSWORD);
    const first = await lock.checkPassword('Otra-8z');
    expect(first.remainingMs).to.equal(30_000);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(agreed);
    let wall = early;
    lock.setLockClockForTests(() => wall);
    wall += 30_000;
    expect(await lock.getPinLockRemaining()).to.equal(30_000);
    mono += 5_000;
    expect(await lock.getPinLockRemaining()).to.equal(30_000);
    lock.setChainStampsForTests(() => []);
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.checkPassword('Otra-8z');
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(0);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(30_000);
    wall += 30_000;
    expect(await lock.getPinLockRemaining()).to.equal(30_000);
    await lock.pauseLockWait();
    mono += 60_000;
    await lock.resumeLockWait();
    expect(await lock.getPinLockRemaining()).to.equal(30_000);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(30_000);
    for (let step = 0; step < 3; step += 1) {
      mono += 5_000;
      expect(await lock.getPinLockRemaining()).to.equal(30_000 - (step + 1) * 5_000);
    }
    mono += 15_000;
    expect(await lock.getPinLockRemaining()).to.equal(0);
    lock.setChainStampsForTests(() => [agreed, agreed + 1_000]);
    memory.delete('quatrivium.lock.gate');
    await lock.checkPassword('Otra-8z');
    mono = 40;
    lock.setChainStampsForTests(() => [agreed + 40_000, agreed + 41_000]);
    expect(await lock.getPinLockRemaining()).to.equal(0);
    const opened = await lock.checkPassword(PASSWORD);
    expect(opened.ok).to.equal(true);
  });

  it('reads the block time from any two agreeing public RPCs', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    rpc.setRuntimeMode('live');
    const urls = rpc.publicRpcList();
    expect(urls.length).to.be.at.least(4);
    const seconds = [1_800_000_000, 1_800_000_600, 1_800_003_600, 1_800_003_630];
    lock.setChainStampsForTests(null);
    const previous = global.fetch;
    global.fetch = async (url) => {
      const index = urls.indexOf(String(url));
      const stamp = seconds[index];
      return {
        json: async () => ({
          result: stamp ? { timestamp: `0x${stamp.toString(16)}` } : null,
        }),
      };
    };
    try {
      await lock.setPassword(PASSWORD);
      const miss = await lock.checkPassword('Otra-8z');
      expect(miss.remainingMs).to.equal(30_000);
      expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(seconds[2] * 1000);
    } finally {
      global.fetch = previous;
      lock.setChainStampsForTests(() => []);
    }
  });

  it('keeps the unlock when the protection retry is cancelled', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    memory.delete(SECRET_KEY);
    memory.delete('quatrivium.lock.deviceAuth');
    secretMeta.clear();
    rejectDeviceAuth = true;
    try {
      await lock.setPin(PIN);
    } finally {
      rejectDeviceAuth = false;
    }
    const hex = memory.get(SECRET_KEY);
    device.setScreenLockForTests(async () => true);
    expect(await device.armDeviceRetry()).to.equal('ready');
    rejectDeviceAuth = true;
    try {
      const opened = await lock.checkPin(PIN);
      expect(opened.ok).to.equal(true);
    } finally {
      rejectDeviceAuth = false;
    }
    expect(memory.get('quatrivium.lock.deviceRetry')).to.equal('1');
    expect(memory.get(SECRET_KEY)).to.equal(hex);
    expect(memory.get('quatrivium.lock.deviceAuth')).to.equal('0');
    expect(await device.refreshDeviceNotice()).to.equal('lockDeviceOpen');
  });

  it('retries protection after a correct password when there is no pin', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    memory.delete(PIN_RECORD);
    memory.delete(SECRET_KEY);
    memory.delete('quatrivium.lock.deviceAuth');
    secretMeta.clear();
    await lock.setPassword(PASSWORD);
    device.setScreenLockForTests(async () => true);
    expect(await device.armDeviceRetry()).to.equal('ready');
    randomByte = 6;
    const opened = await lock.checkPassword(PASSWORD);
    expect(opened.ok).to.equal(true);
    expect(memory.get('quatrivium.lock.deviceAuth')).to.equal('1');
    expect(memory.get(SECRET_KEY)).to.equal('06'.repeat(32));
    expect(memory.has('quatrivium.lock.deviceRetry')).to.equal(false);
    expect(memory.has(PIN_RECORD)).to.equal(false);
  });

  it('keeps the global counter until a wallet is bound', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.device.boundWallet');
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    memory.delete('quatrivium.lock.gate.none');
    memory.delete('quatrivium.lock.attempts.none');
    await lock.setPassword(PASSWORD);
    memory.delete('quatrivium.lock.gate');
    await lock.checkPassword('Otra-8z');
    expect(memory.has('quatrivium.lock.attempts.none')).to.equal(false);
    expect(memory.has('quatrivium.lock.gate.none')).to.equal(false);
    expect(JSON.parse(memory.get('quatrivium.lock.attempts')).password).to.equal(1);
    memory.delete('quatrivium.lock.gate');
    const walletA = `0x${'ab'.repeat(20)}`;
    memory.set('quatrivium.device.boundWallet', walletA);
    const moved = await lock.checkPassword('Otra-8z');
    expect(moved.ok).to.equal(false);
    expect(memory.has('quatrivium.lock.attempts')).to.equal(false);
    expect(JSON.parse(memory.get(`quatrivium.lock.attempts.${walletA}`)).password).to.equal(2);
    memory.delete('quatrivium.device.boundWallet');
  });

  it('does not count a new fingerprint as a wrong pin and lets the pin be redone', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    memory.delete('quatrivium.lock.deviceSecret');
    memory.delete('quatrivium.lock.deviceAuth');
    secretMeta.clear();
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const hex = memory.get('quatrivium.lock.deviceSecret');
    authError = 'KeyPermanentlyInvalidatedException';
    rejectDeviceAuth = true;
    try {
      const reset = await lock.checkPin(PIN);
      expect(reset.deviceKeyReset).to.equal(true);
      expect(reset.ok).to.equal(false);
      expect(memory.get('quatrivium.lock.deviceSecret')).to.equal(hex);
      expect(memory.has('quatrivium.lock.attempts')).to.equal(false);
    } finally {
      rejectDeviceAuth = false;
      authError = 'no-credential';
    }
    const redone = await lock.setPin(PIN);
    expect(/^0x[0-9a-f]{64}$/.test(redone)).to.equal(true);
    const again = await lock.checkPin(PIN);
    expect(again.ok).to.equal(true);
  });

  it('keeps the secret when the phone cannot ask for a credential', async function () {
    memory.clear();
    secureWrites.length = 0;
    rejectDeviceAuth = true;
    try {
      const wrap = await lock.setPin(PIN);
      expect(/^0x[0-9a-f]{64}$/.test(wrap)).to.equal(true);
      const saved = [...memory.values()].find((value) => String(value).includes('pbkdf2-sha256'));
      const record = JSON.parse(saved);
      expect(record.device).to.equal(1);
      expect(record.deviceAuth).to.equal(0);
      expect(memory.get('quatrivium.lock.deviceAuth')).to.equal('0');
      expect(/^[0-9a-f]{64}$/.test(memory.get('quatrivium.lock.deviceSecret'))).to.equal(true);
    } finally {
      rejectDeviceAuth = false;
    }
  });
});
