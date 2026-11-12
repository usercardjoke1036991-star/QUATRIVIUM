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
let gateFault = '';
let boundFault = '';
let failPasswordWrite = false;
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
    if (boundFault && key === 'quatrivium.device.boundWallet') {
      if (boundFault === 'throw') throw new Error('io');
      if (boundFault === 'hang') return new Promise(() => {});
    }
    if (gateFault && String(key).includes('lock.gate')) {
      if (gateFault === 'throw') throw new Error('io');
      if (gateFault === 'hang') return new Promise(() => {});
      if (gateFault === 'lie' && memory.has(key)) {
        return JSON.stringify({ fails: 7, until: 0, waitMs: 1, left: 1, seen: 1, chainAt: 1 });
      }
      if (gateFault === 'lie-clear' && memory.has(key)) {
        const stored = JSON.parse(memory.get(key));
        if (stored.fails === 0 && stored.left === 0) {
          return JSON.stringify({
            fails: 3,
            until: 0,
            waitMs: 1,
            left: 1,
            seen: 1,
            chainAt: 1,
            lastChain: 0,
          });
        }
      }
    }
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItemAsync(key, value, options) {
    if (failPasswordWrite && key === 'quatrivium.lock.password') throw new Error('disk');
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
const auth = loadTs(path.join(__dirname, '..', 'services', 'authenticator.ts'));
const totp = loadTs(path.join(__dirname, '..', 'utils', 'totp.ts'));
const handoff = loadTs(path.join(__dirname, '..', 'services', 'walletHandoff.ts'));
const entry = loadTs(path.join(__dirname, '..', 'utils', 'accountEntry.ts'));
const session = loadTs(path.join(__dirname, '..', 'services', 'walletSession.ts'));
const restore = loadTs(path.join(__dirname, '..', 'services', 'restoreAccount.ts'));
const binding = loadTs(path.join(__dirname, '..', 'services', 'deviceBinding.ts'));
const claim = loadTs(path.join(__dirname, '..', 'services', 'deviceClaim.ts'));
const picker = loadTs(path.join(__dirname, '..', 'utils', 'pickerHold.ts'));
const vault = loadTs(path.join(__dirname, '..', 'utils', 'walletVaultPolicy.ts'));
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
const race = loadTs(path.join(__dirname, '..', 'utils', 'lockRace.ts'));

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
    gateFault = '';
    boundFault = '';
    failPasswordWrite = false;
    lock.setVerifyBudgetForTests(null);
    lock.setLockPhaseForTests(null);
    lock.setMonoClockForTests(null);
    lock.setChainStampsForTests(() => []);
    auth.setTotpRunIdForTests(null);
    device.setScreenLockForTests(null);
    crashOnSecretPromote = false;
    randomByte = 0;
    rpc.setProductMode('live');
    lock.lockNow();
    memory.delete('quatrivium.lock.password');
    memory.delete('mem:quatrivium.lock.password.fallback');
    memory.delete('quatrivium.lock.pin');
    memory.delete('quatrivium.lock.pinWrap');
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    memory.delete('quatrivium.device.boundWallet');
    memory.delete('mem:quatrivium.device.boundWallet.fallback');
    memory.delete('quatrivium.appWallet.v1');
    memory.delete('quatrivium.appWallet.phraseAck');
    memory.delete('quatrivium.lock.recoveryWrap');
    for (const key of [...memory.keys()]) {
      if (
        String(key).startsWith('quatrivium.lock.gate.') ||
        String(key).startsWith('quatrivium.lock.attempts.')
      ) {
        memory.delete(key);
      }
    }
    memory.delete('qc_totp_secret_v1');
    memory.delete('qc_totp_wrap_v1');
    memory.delete('qc_totp_wrap_mig_v1');
    memory.delete('qc_totp_step_v1');
    memory.delete('qc_totp_step_mono_v1');
    picker.setPickerActive(false, -60_000);
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
    expect(await lock.retryDeviceProtectionForTests(PIN)).to.equal('no-lock');
    expect(memory.get(SECRET_KEY)).to.equal(hex);
    device.setScreenLockForTests(async () => true);
    randomByte = 9;
    expect(await lock.retryDeviceProtectionForTests(PIN)).to.equal('bound');
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
      await lock.retryDeviceProtectionForTests(PIN);
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
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    try {
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
    } finally {
      Date.now = realNow;
    }
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
    await lock.whenLockAnchorSettled();
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(agreed);
    const realNow = Date.now;
    let wall = early;
    Date.now = () => wall;
    wall += 30_000;
    expect(await lock.getPinLockRemaining()).to.equal(30_000);
    mono += 5_000;
    expect(await lock.getPinLockRemaining()).to.equal(25_000);
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
    await lock.whenLockAnchorSettled();
    mono = 40;
    lock.setChainStampsForTests(() => [agreed + 40_000, agreed + 41_000]);
    expect(await lock.refreshLockChain(true)).to.equal(0);
    const opened = await lock.checkPassword(PASSWORD);
    expect(opened.ok).to.equal(true);
    Date.now = realNow;
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
      await lock.whenLockAnchorSettled();
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

  it('anchors an offline failure to the chain and opens only after that clock covers the wait', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    lock.setChainStampsForTests(() => []);
    await lock.setPassword(PASSWORD);
    const miss = await lock.checkPassword('Otra-8z');
    expect(miss.remainingMs).to.equal(30_000);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(0);
    await lock.pauseLockWait();
    mono += 120_000;
    await lock.resumeLockWait();
    expect(await lock.tickLockWait()).to.equal(30_000);
    const chain = 1_800_000_000_000;
    lock.setChainStampsForTests(() => [chain, chain + 1_000, chain + 10 * 60_000]);
    expect(await lock.refreshLockChain(true)).to.equal(30_000);
    const anchored = JSON.parse(memory.get('quatrivium.lock.gate'));
    expect(anchored.chainAt).to.equal(chain - (anchored.waitMs - anchored.left));
    expect(anchored.left).to.equal(30_000);
    mono += 120_000;
    expect(await lock.tickLockWait()).to.equal(0);
    lock.setChainStampsForTests(() => [chain + 30_000, chain + 31_000]);
    expect(await lock.refreshLockChain(true)).to.equal(0);
    const opened = await lock.checkPassword(PASSWORD);
    expect(opened.ok).to.equal(true);
  });

  it('reads the chain on open and then at most once a minute across five simulated minutes', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    let reads = 0;
    const chain = 1_700_000_000_000;
    lock.setChainStampsForTests(() => {
      reads += 1;
      return [chain, chain + 1_000];
    });
    await lock.setPassword(PASSWORD);
    reads = 0;
    await lock.checkPassword('Otra-8z');
    expect(reads).to.equal(0);
    await lock.whenLockAnchorSettled();
    expect(reads).to.equal(1);
    const row = JSON.parse(memory.get('quatrivium.lock.gate'));
    row.waitMs = 600_000;
    row.left = 600_000;
    memory.set('quatrivium.lock.gate', JSON.stringify(row));
    reads = 0;
    await lock.refreshLockChain(true);
    for (let sec = 1; sec <= 300; sec += 1) {
      mono += 1_000;
      await lock.tickLockWait();
      await lock.refreshLockChain(false);
    }
    expect(reads).to.equal(6);
  });

  it('does not start a second chain read while one is still in flight', async function () {
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    memory.set(
      'quatrivium.lock.gate',
      JSON.stringify({
        fails: 1,
        until: 0,
        waitMs: 30_000,
        left: 30_000,
        seen: mono,
        chainAt: 0,
      })
    );
    let reads = 0;
    let release = () => {};
    const chain = 1_700_000_000_000;
    lock.setChainStampsForTests(
      () =>
        new Promise((resolve) => {
          reads += 1;
          release = () => resolve([chain, chain + 1_000]);
        })
    );
    const first = lock.refreshLockChain(true);
    const second = lock.refreshLockChain(true);
    try {
      for (let turn = 0; turn < 20 && reads === 0; turn += 1) {
        await Promise.resolve();
      }
      expect(reads).to.equal(1);
      release();
      await first;
      await second;
      expect(reads).to.equal(1);
    } finally {
      release();
    }
  });

  it('reports an unexpected lock failure only on the lock path', async function () {
    let seen = 0;
    race.setLockFaultReporter(() => {
      seen += 1;
    });
    try {
      const value = await race.raceMs(Promise.reject(new Error('boom')), 1000, 'fallback');
      expect(value).to.equal('fallback');
      expect(seen).to.equal(0);
      race.reportLockFault();
      expect(seen).to.equal(1);
    } finally {
      race.setLockFaultReporter(null);
    }
  });

  it('opens an anchored wait on the open clock and keeps counting with no network', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    const chain = 1_800_000_000_000;
    let reads = 0;
    lock.setChainStampsForTests(() => {
      reads += 1;
      return [chain, chain + 1_000];
    });
    await lock.setPassword(PASSWORD);
    const miss = await lock.checkPassword('Otra-8z');
    expect(miss.remainingMs).to.equal(30_000);
    await lock.whenLockAnchorSettled();
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(chain);
    reads = 0;
    for (let step = 0; step < 30; step += 1) {
      mono += 1_000;
      await lock.tickLockWait();
    }
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(0);
    expect(reads).to.equal(0);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);

    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    lock.setChainStampsForTests(() => []);
    await lock.checkPassword('Otra-8z');
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(0);
    mono += 5_000;
    expect(await lock.tickLockWait()).to.equal(25_000);

    lock.setChainStampsForTests(() => [chain, chain + 1_000]);
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.checkPassword('Otra-8z');
    await lock.whenLockAnchorSettled();
    mono += 10_000;
    expect(await lock.tickLockWait()).to.equal(20_000);
    lock.setChainStampsForTests(() => [chain, chain + 500]);
    expect(await lock.refreshLockChain(true)).to.equal(30_000);
    lock.setChainStampsForTests(() => [chain + 60_000, chain + 61_000]);
    expect(await lock.refreshLockChain(true)).to.equal(0);
  });

  it('opens a closed hour wait from two agreeing RPCs and ignores one fast node', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    const chain = 1_900_000_000_000;
    const hour = 60 * 60 * 1000;
    lock.setChainStampsForTests(() => [chain, chain + 1_000]);
    await lock.setPassword(PASSWORD);
    for (let fail = 1; fail <= 5; fail += 1) {
      if (fail > 1) {
        mono += JSON.parse(memory.get('quatrivium.lock.gate')).left;
        expect(await lock.tickLockWait()).to.equal(0);
      }
      const miss = await lock.checkPassword('Otra-8z');
      expect(miss.remainingMs).to.equal(policy.lockoutMs(fail));
    }
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).waitMs).to.equal(hour);
    await lock.whenLockAnchorSettled();
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).chainAt).to.equal(chain);
    await lock.pauseLockWait();
    mono += 2 * hour;
    await lock.resumeLockWait();
    expect(await lock.tickLockWait()).to.equal(hour);
    lock.setChainStampsForTests(() => [chain + hour, null]);
    expect(policy.agreedChainMs([chain + hour, null])).to.equal(null);
    expect(await lock.refreshLockChain(true)).to.equal(hour);
    lock.setChainStampsForTests(() => [chain + hour, chain + hour + 1_000]);
    expect(await lock.refreshLockChain(true)).to.equal(0);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('does not read the chain when no wait is active', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    let reads = 0;
    const chain = 1_700_000_000_000;
    lock.setChainStampsForTests(() => {
      reads += 1;
      return [chain, chain + 1_000];
    });
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    reads = 0;
    expect(await lock.refreshLockChain(true)).to.equal(0);
    expect(await lock.refreshLockChain(true)).to.equal(0);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
    expect((await lock.checkPin(PIN)).ok).to.equal(true);
    expect(reads).to.equal(0);
  });

  it('keeps a saved miss when verification is interrupted', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    lock.setLockPhaseForTests({
      beforeVerify: () => {
        throw new Error('crash-before-verify');
      },
    });
    try {
      await lock.checkPassword('Otra-8z');
      expect.fail();
    } catch (error) {
      expect(error.message).to.equal('crash-before-verify');
    }
    expect(JSON.parse(memory.get('quatrivium.lock.attempts')).password).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(30_000);
    lock.setLockPhaseForTests(null);
    kdf.takeKdfCalls();
    const restarted = await lock.checkPassword(PASSWORD);
    expect(restarted.locked).to.equal(true);
    expect(kdf.takeKdfCalls()).to.equal(0);

    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    lock.setLockPhaseForTests({ beforeVerify: () => new Promise(() => {}) });
    const hung = lock.checkPassword('Otra-8z');
    for (let turn = 0; turn < 50 && !memory.has('quatrivium.lock.gate'); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(JSON.parse(memory.get('quatrivium.lock.attempts')).password).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.be.greaterThan(0);
    void hung;
    lock.setMonoClockForTests(() => mono);

    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    lock.setLockPhaseForTests({
      afterMatch: () => {
        throw new Error('crash-after-match');
      },
    });
    try {
      await lock.checkPassword(PASSWORD);
      expect.fail();
    } catch (error) {
      expect(error.message).to.equal('crash-after-match');
    }
    expect(JSON.parse(memory.get('quatrivium.lock.attempts')).password).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(30_000);
  });

  it('answers a wrong password before a chain read that never returns', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    let reads = 0;
    lock.setChainStampsForTests(
      () =>
        new Promise(() => {
          reads += 1;
        })
    );
    await lock.setPassword(PASSWORD);
    reads = 0;
    const started = Date.now();
    const miss = await lock.checkPassword('Otra-8z');
    expect(Date.now() - started).to.be.below(1000);
    expect(reads).to.equal(0);
    expect(miss.locked).to.equal(true);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).left).to.equal(30_000);
    lock.setMonoClockForTests(() => mono);
  });

  it('does not ask the chain before answering a right or wrong password', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    let reads = 0;
    const chain = 1_700_000_000_000;
    lock.setChainStampsForTests(() => {
      reads += 1;
      return [chain, chain + 1_000];
    });
    await lock.setPassword(PASSWORD);
    reads = 0;
    const miss = await lock.checkPassword('Otra-8z');
    expect(reads).to.equal(0);
    expect(miss.locked).to.equal(true);
    await lock.whenLockAnchorSettled();
    expect(reads).to.equal(1);
    mono += 30_000;
    expect(await lock.tickLockWait()).to.equal(0);
    reads = 0;
    const opened = await lock.checkPassword(PASSWORD);
    expect(opened.ok).to.equal(true);
    expect(reads).to.equal(0);
  });

  it('rejects when the lock record cannot be read and does not reset the ladder', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    kdf.takeKdfCalls();
    gateFault = 'hang';
    const timed = await lock.checkPassword(PASSWORD);
    expect(timed.storeUnknown).to.equal(true);
    expect(kdf.takeKdfCalls()).to.equal(0);
    gateFault = 'throw';
    const failed = await lock.checkPassword(PASSWORD);
    expect(failed.storeUnknown).to.equal(true);
    expect(kdf.takeKdfCalls()).to.equal(0);
    gateFault = '';
    memory.set(
      'quatrivium.lock.gate',
      JSON.stringify({
        fails: 4,
        until: 0,
        waitMs: policy.lockoutMs(4),
        left: 0,
        seen: mono,
        chainAt: 0,
      })
    );
    memory.set('quatrivium.lock.attempts', JSON.stringify({ pin: 0, password: 4 }));
    gateFault = 'throw';
    const blocked = await lock.checkPassword('Otra-8z');
    expect(blocked.storeUnknown).to.equal(true);
    gateFault = '';
    const next = await lock.checkPassword('Otra-8z');
    expect(next.remainingMs).to.equal(policy.lockoutMs(5));
  });

  it('rejects the attempt when the saved miss cannot be confirmed', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    kdf.takeKdfCalls();
    gateFault = 'lie';
    const rejected = await lock.checkPassword('Otra-8z');
    expect(rejected.storeUnknown).to.equal(true);
    expect(kdf.takeKdfCalls()).to.equal(0);
  });

  it('relocks when either clock passes the limit or the phone clock goes backwards', function () {
    const start = 1_000_000;
    const limit = 20_000;
    expect(lock.shouldRelockAfterBackground(start, start + limit, start, start)).to.equal(true);
    expect(lock.shouldRelockAfterBackground(start, start, start, start + limit)).to.equal(true);
    expect(lock.shouldRelockAfterBackground(start, start - 1, start, start)).to.equal(true);
    expect(
      lock.shouldRelockAfterBackground(start, start + limit - 1, start, start + limit - 1)
    ).to.equal(false);
    expect(lock.shouldRelockAfterBackground(null, start, start, start)).to.equal(false);
  });

  it('uses the lowest agreeing chain time so a fast pair cannot win', function () {
    const stamp = 1_800_000_000_000;
    const hour = 60 * 60 * 1000;
    expect(policy.agreedChainMs([stamp, stamp + hour, stamp + hour, stamp + 2_000])).to.equal(
      stamp
    );
    expect(policy.agreedChainMs([stamp + hour, stamp, stamp + 1_000])).to.equal(stamp);
  });

  function badTotp(secret) {
    const now = Date.now();
    const window = [
      totp.totpAt(secret, now - 30_000),
      totp.totpAt(secret, now),
      totp.totpAt(secret, now + 30_000),
    ];
    return window.includes('000000') ? '111111' : '000000';
  }

  it('counts authenticator misses on the same ladder as the pin', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(3));
    memory.set('qc_totp_secret_v1', secret);
    const bad = badTotp(secret);
    const first = await auth.unlockWithAuthenticator(bad);
    expect(first.remainingMs).to.equal(policy.lockoutMs(1));
    const during = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()));
    expect(during.locked).to.equal(true);
    expect(during.ok).to.equal(false);
    expect(memory.get('qc_totp_step_v1')).to.equal(undefined);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(1);
    for (let step = 2; step <= 6; step += 1) {
      const row = JSON.parse(memory.get('quatrivium.lock.gate'));
      row.left = 0;
      memory.set('quatrivium.lock.gate', JSON.stringify(row));
      const miss = await auth.unlockWithAuthenticator(bad);
      expect(miss.remainingMs).to.equal(policy.lockoutMs(step));
    }
  });

  it('raises the shared ladder when a totp miss is followed by a pin miss', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(5));
    memory.set('qc_totp_secret_v1', secret);
    const first = await auth.unlockWithAuthenticator(badTotp(secret));
    expect(first.remainingMs).to.equal(policy.lockoutMs(1));
    const row = JSON.parse(memory.get('quatrivium.lock.gate'));
    row.left = 0;
    memory.set('quatrivium.lock.gate', JSON.stringify(row));
    const pinMiss = await lock.checkPin('193746');
    expect(pinMiss.remainingMs).to.equal(policy.lockoutMs(2));
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(2);
    const attempts = JSON.parse(memory.get('quatrivium.lock.attempts'));
    expect(attempts.totp).to.equal(1);
    expect(attempts.pin).to.equal(1);
  });

  it('rejects a repeated authenticator code and does not open the key without the device secret', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(4));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', 'aa'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    const wrap = session.getWalletWrapKey();
    const legacyKey = await box.deriveWrapKeyAsync(secret, 'qc.totp.wrap', 8000);
    memory.set('qc_totp_wrap_v1', box.sealSecret(wrap, legacyKey));
    const code = totp.totpAt(secret, Date.now());
    lock.lockNow();
    const opened = await auth.unlockWithAuthenticator(code);
    expect(opened.ok).to.equal(true);
    expect(session.getWalletWrapKey()).to.equal(wrap);
    expect(() => box.openSecret(memory.get('qc_totp_wrap_v1'), legacyKey)).to.throw();
    const again = await auth.unlockWithAuthenticator(code);
    expect(again.ok).to.equal(false);
    const alone = totp.bytesToBase32(new Uint8Array(20).fill(9));
    memory.set('qc_totp_secret_v1', alone);
    memory.delete('qc_totp_step_v1');
    const aloneKey = await box.deriveWrapKeyAsync(alone, 'qc.totp.wrap', 8000);
    memory.set('qc_totp_wrap_v1', box.sealSecret(wrap, aloneKey));
    memory.delete('quatrivium.lock.deviceSecret');
    memory.delete('quatrivium.lock.deviceAuth');
    const row = JSON.parse(memory.get('quatrivium.lock.gate'));
    row.left = 0;
    memory.set('quatrivium.lock.gate', JSON.stringify(row));
    lock.lockNow();
    const denied = await auth.unlockWithAuthenticator(totp.totpAt(alone, Date.now()));
    expect(denied.ok).to.equal(false);
    expect(session.getWalletWrapKey()).to.equal(null);
  });

  it('keeps the owner password when a foreign phrase is restored from the lock screen', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const owner = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    memory.set('quatrivium.device.boundWallet', owner.address.toLowerCase());
    memory.set('quatrivium.appWallet.v1', 'sobre-dueno');
    memory.set(
      'quatrivium.lock.gate',
      JSON.stringify({
        fails: 3,
        until: 0,
        waitMs: policy.lockoutMs(3),
        left: 0,
        seen: mono,
        chainAt: 0,
        lastChain: 0,
      })
    );
    memory.set('quatrivium.lock.attempts', JSON.stringify({ pin: 2, password: 1, totp: 0 }));
    const passwordBefore = memory.get('quatrivium.lock.password');
    const gateBefore = memory.get('quatrivium.lock.gate');
    const attemptsBefore = memory.get('quatrivium.lock.attempts');
    const walletBefore = memory.get('quatrivium.appWallet.v1');
    lock.lockNow();
    const foreign = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    const result = await restore.restoreAccountOnDevice({
      phrase: foreign.mnemonic.phrase,
      password: 'Ataque-9z',
    });
    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal('wallet-other-app');
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    expect(memory.get('quatrivium.lock.gate')).to.equal(gateBefore);
    expect(memory.get('quatrivium.lock.attempts')).to.equal(attemptsBefore);
    expect(memory.get('quatrivium.appWallet.v1')).to.equal(walletBefore);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('rejects restore when the bound wallet cannot be read', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const passwordBefore = memory.get('quatrivium.lock.password');
    const phrase = Mnemonic.fromEntropy(randomBytes(32)).phrase;
    boundFault = 'throw';
    const result = await restore.restoreAccountOnDevice({ phrase, password: 'Ataque-9z' });
    boundFault = '';
    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal('store-unknown');
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('restores the previous password when import fails after the write', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const passwordBefore = memory.get('quatrivium.lock.password');
    const owner = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    memory.set('quatrivium.device.boundWallet', owner.address.toLowerCase());
    lock.lockNow();
    const original = wallet.importFromPhrase;
    wallet.importFromPhrase = async () => {
      throw new Error('wallet-persist');
    };
    try {
      const result = await restore.restoreAccountOnDevice({
        phrase: owner.mnemonic.phrase,
        password: 'Nueva-9z',
      });
      expect(result.ok).to.equal(false);
    } finally {
      wallet.importFromPhrase = original;
    }
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('restores with the owner phrase, sets the new password and clears the ladder', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    const owner = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    const addr = owner.address.toLowerCase();
    memory.set('quatrivium.device.boundWallet', addr);
    const gateKey = `quatrivium.lock.gate.${addr}`;
    const attemptKey = `quatrivium.lock.attempts.${addr}`;
    memory.set(
      gateKey,
      JSON.stringify({
        fails: 4,
        until: 0,
        waitMs: policy.lockoutMs(4),
        left: policy.lockoutMs(4),
        seen: mono,
        chainAt: 0,
        lastChain: 0,
      })
    );
    memory.set(attemptKey, JSON.stringify({ pin: 3, password: 1, totp: 2 }));
    lock.lockNow();
    const result = await restore.restoreAccountOnDevice({
      phrase: owner.mnemonic.phrase,
      password: 'Owner-9z',
    });
    expect(result.ok).to.equal(true);
    expect(JSON.parse(memory.get(gateKey)).fails).to.equal(0);
    expect(JSON.parse(memory.get(attemptKey)).password).to.equal(0);
    expect((await lock.checkPassword('Owner-9z')).ok).to.equal(true);
  });

  it('rejects setPassword without a session or restore token when a password exists', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    lock.lockNow();
    try {
      await lock.setPassword('OtraClave-9z');
      expect.fail();
    } catch (error) {
      expect(error.message).to.equal('password-locked');
    }
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('blocks authenticator unlock after the totp fail limit', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(6));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', 'ab'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    for (let i = 0; i < lock.TOTP_FAIL_LIMIT; i += 1) {
      if (memory.has('quatrivium.lock.gate')) {
        const row = JSON.parse(memory.get('quatrivium.lock.gate'));
        row.left = 0;
        memory.set('quatrivium.lock.gate', JSON.stringify(row));
      }
      await auth.unlockWithAuthenticator(badTotp(secret));
    }
    if (memory.has('quatrivium.lock.gate')) {
      const row = JSON.parse(memory.get('quatrivium.lock.gate'));
      row.left = 0;
      memory.set('quatrivium.lock.gate', JSON.stringify(row));
    }
    const blocked = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()));
    expect(blocked.totpBlocked).to.equal(true);
    expect(blocked.ok).to.equal(false);
  });

  it('lets one attempt through when pin and password are submitted together', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    const results = await Promise.all([
      lock.checkPin('193746'),
      lock.checkPin('193746'),
      lock.checkPassword('Otra-8z'),
    ]);
    const processed = results.filter((result) => !result.busy);
    const busy = results.filter((result) => result.busy);
    const gate = JSON.parse(memory.get('quatrivium.lock.gate'));
    expect(processed).to.have.length(1);
    expect(busy).to.have.length(2);
    expect(gate.fails).to.equal(1);
  });

  it('turns a corrupt lock record into a day wait and then opens with the password', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    memory.set('quatrivium.lock.gate', '{');
    kdf.takeKdfCalls();
    const blocked = await lock.checkPassword(PASSWORD);
    expect(blocked.locked).to.equal(true);
    expect(blocked.remainingMs).to.equal(policy.lockoutMs(6));
    expect(kdf.takeKdfCalls()).to.equal(0);
    const saved = JSON.parse(memory.get('quatrivium.lock.gate'));
    expect(saved.fails).to.be.at.least(6);
    expect(saved.left).to.equal(policy.lockoutMs(6));
    expect(saved.chainAt).to.equal(0);
    mono += policy.lockoutMs(6);
    expect(await lock.tickLockWait()).to.equal(0);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
    expect(entry.restoreFromLockScreen('lock')).to.equal('restore');
    expect(entry.restoreFromLockScreen('app')).to.equal(null);
  });

  it('rejects the attempt when the bound wallet cannot be read', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    memory.set(
      'quatrivium.lock.gate',
      JSON.stringify({
        fails: 4,
        until: 0,
        waitMs: policy.lockoutMs(4),
        left: 0,
        seen: mono,
        chainAt: 0,
        lastChain: 0,
      })
    );
    boundFault = 'throw';
    const rejected = await lock.checkPassword('Otra-8z');
    expect(rejected.storeUnknown).to.equal(true);
    boundFault = '';
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(4);
  });

  it('lets the user in when the success clear cannot be confirmed', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    let seen = 0;
    race.setLockFaultReporter(() => {
      seen += 1;
    });
    gateFault = 'lie-clear';
    try {
      const opened = await lock.checkPassword(PASSWORD);
      expect(opened.ok).to.equal(true);
      expect(seen).to.equal(1);
    } finally {
      race.setLockFaultReporter(null);
    }
  });

  it('relocks when the phone clock goes backwards during a wallet handoff', function () {
    handoff.beginExternalWalletHandoff();
    try {
      expect(handoff.externalWalletHandoffActive()).to.equal(true);
      expect(lock.shouldRelockAfterBackground(5_000, 4_000, 1_000, 1_100)).to.equal(true);
    } finally {
      handoff.endExternalWalletHandoff();
    }
  });

  it('locks on a cold start whenever an account is on the phone', function () {
    expect(
      entry.nextEntryScreen({
        accountOnPhone: true,
        sessionSaved: true,
        wrapReady: true,
        unlockOn: false,
      })
    ).to.equal('unlock');
    expect(
      entry.nextEntryScreen({
        accountOnPhone: false,
        sessionSaved: false,
        wrapReady: false,
        unlockOn: false,
      })
    ).to.equal('welcome');
  });

  it('counts two urls on the same host as one rpc and ignores an older chain sample', async function () {
    const first = rpc.publicRpcList()[0];
    const host = new URL(first).hostname;
    expect(
      rpc.dedupeRpcHosts([first, `https://${host}/other`, 'https://example.test/rpc'])
    ).to.deep.equal([first, 'https://example.test/rpc']);
    const hosts = rpc.publicRpcList().map((url) => new URL(url).hostname);
    expect(new Set(hosts).size).to.equal(hosts.length);
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    const chain = 1_800_000_000_000;
    memory.set(
      'quatrivium.lock.gate',
      JSON.stringify({
        fails: 1,
        until: 0,
        waitMs: 30_000,
        left: 30_000,
        seen: mono,
        chainAt: chain,
        lastChain: chain + 60_000,
      })
    );
    lock.setChainStampsForTests(() => [chain, chain + 1_000]);
    mono += 5_000;
    expect(await lock.refreshLockChain(true)).to.equal(25_000);
    memory.set(
      'quatrivium.lock.gate',
      JSON.stringify({
        fails: 1,
        until: 0,
        waitMs: 30_000,
        left: 30_000,
        seen: mono,
        chainAt: chain,
        lastChain: chain + 60_000,
      })
    );
    lock.setChainStampsForTests(() => [chain + 70_000, chain + 71_000]);
    expect(await lock.refreshLockChain(true)).to.equal(0);
  });

  it('does not open the biometric wrap when the phone cancels, and live mode does not fall back', async function () {
    installMock('expo-local-authentication', {
      async authenticateAsync() {
        return { success: false };
      },
    });
    const wrap = `0x${'ab'.repeat(32)}`;
    memory.set('quatrivium.wallet.wrap.v1', wrap);
    expect(await lock.loadWrapFromBiometric()).to.equal(null);
    installMock('expo-local-authentication', {
      async authenticateAsync() {
        return { success: true };
      },
    });
    expect(await lock.loadWrapFromBiometric()).to.equal(wrap);
    failPasswordWrite = true;
    rpc.setProductMode('live');
    try {
      await lock.setPassword(PASSWORD);
      expect.fail();
    } catch (error) {
      expect(error.message).to.equal('password-persist');
    }
    expect(memory.has('mem:quatrivium.lock.password.fallback')).to.equal(false);
  });

  it('releases the verifying mark when an internal wait never finishes', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    lock.setVerifyBudgetForTests(80);
    lock.setLockPhaseForTests({ beforeVerify: () => new Promise(() => {}) });
    const hung = await lock.checkPassword('Otra-8z');
    expect(hung.ok).to.equal(false);
    lock.setLockPhaseForTests(null);
    lock.setVerifyBudgetForTests(null);
    const next = await lock.checkPassword('Otra-8z');
    expect(next.busy).to.not.equal(true);
    expect(next.locked || next.ok === false).to.equal(true);
  });

  it('migrates the authenticator wrap once and refuses the legacy format afterwards', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    await lock.setPin(PIN);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(7));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', 'cd'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    const wrap = session.getWalletWrapKey();
    const legacyKey = await box.deriveWrapKeyAsync(secret, 'qc.totp.wrap', 8000);
    memory.set('qc_totp_wrap_v1', box.sealSecret(wrap, legacyKey));
    memory.delete('qc_totp_wrap_mig_v1');
    lock.lockNow();
    expect((await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()))).ok).to.equal(true);
    expect(memory.get('qc_totp_wrap_mig_v1')).to.equal('1');
    memory.set('qc_totp_wrap_v1', box.sealSecret(wrap, legacyKey));
    memory.delete('qc_totp_step_v1');
    memory.delete('qc_totp_step_mono_v1');
    const row = JSON.parse(memory.get('quatrivium.lock.gate') || '{"fails":0,"left":0}');
    row.left = 0;
    memory.set('quatrivium.lock.gate', JSON.stringify({ ...row, fails: 0, left: 0, waitMs: 0 }));
    lock.lockNow();
    const denied = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now() + 60_000));
    expect(denied.ok).to.equal(false);
  });

  it('keeps a totp wrap when the device secret is missing and the guard is not lost', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(8));
    memory.set('qc_totp_secret_v1', secret);
    const wrap = session.getWalletWrapKey();
    const legacyKey = await box.deriveWrapKeyAsync(secret, 'qc.totp.wrap', 8000);
    memory.set('qc_totp_wrap_v1', box.sealSecret(wrap, legacyKey));
    memory.delete('quatrivium.lock.deviceSecret');
    memory.delete('quatrivium.lock.deviceAuth');
    lock.lockNow();
    const gone = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()));
    expect(gone.ok).to.equal(false);
    expect(memory.has('qc_totp_wrap_v1')).to.equal(true);
    expect(memory.get('qc_totp_secret_v1')).to.equal(secret);
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '0');
    memory.set('quatrivium.lock.deviceSecret', 'ef'.repeat(32));
    await auth.persistAuthenticatorWrap(wrap);
    memory.delete('qc_totp_step_v1');
    memory.delete('qc_totp_step_mono_v1');
    if (memory.has('quatrivium.lock.gate')) {
      const row = JSON.parse(memory.get('quatrivium.lock.gate'));
      row.left = 0;
      memory.set('quatrivium.lock.gate', JSON.stringify(row));
    }
    lock.lockNow();
    const openOnly = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()));
    expect(openOnly.ok).to.equal(false);
    memory.delete('qc_totp_step_v1');
    memory.delete('qc_totp_step_mono_v1');
    if (memory.has('quatrivium.lock.gate')) {
      const row = JSON.parse(memory.get('quatrivium.lock.gate'));
      row.left = 0;
      memory.set('quatrivium.lock.gate', JSON.stringify(row));
    }
    expect((await auth.verifyAuthenticator(totp.totpAt(secret, Date.now() + 30_000))).ok).to.equal(
      true
    );
  });

  it('rejects a totp step too far ahead of the last accepted mono clock', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(2));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', '11'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    await auth.persistAuthenticatorWrap(session.getWalletWrapKey());
    const first = totp.totpAt(secret, Date.now());
    expect((await auth.verifyAuthenticator(first)).ok).to.equal(true);
    memory.set('qc_totp_step_mono_v1', String(performance.now()));
    const far = totp.totpAt(secret, Date.now() + 10 * 60_000);
    if (memory.has('quatrivium.lock.gate')) {
      const row = JSON.parse(memory.get('quatrivium.lock.gate'));
      row.left = 0;
      memory.set('quatrivium.lock.gate', JSON.stringify(row));
    }
    const rejected = await auth.verifyAuthenticator(far);
    expect(rejected.ok).to.equal(false);
    await auth.confirmAuthenticator(secret, totp.totpAt(secret, Date.now()));
    expect(memory.get('qc_totp_step_v1')).to.equal(undefined);
  });

  it('punishes a gate object with fails but no wait fields', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    memory.set('quatrivium.lock.gate', JSON.stringify({ fails: 5 }));
    const blocked = await lock.checkPassword(PASSWORD);
    expect(blocked.locked).to.equal(true);
    expect(blocked.remainingMs).to.be.at.least(policy.lockoutMs(6) - 1);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).fails).to.equal(6);
    expect(JSON.parse(memory.get('quatrivium.lock.gate')).waitMs).to.equal(policy.lockoutMs(6));
  });

  it('exposes bound wallet unknown without calling it another app', async function () {
    boundFault = 'hang';
    const looked = await claim.lookupBoundWalletOnThisDevice();
    boundFault = '';
    expect(looked.status).to.equal('unknown');
    expect(binding.BOUND_UNKNOWN).to.equal('desconocido');
  });

  it('relocks when the image picker hold lasts more than two minutes', function () {
    const start = 1_000_000;
    picker.setPickerActive(true, start);
    expect(picker.isPickerHeld(start + 60_000)).to.equal(true);
    expect(lock.shouldRelockAfterBackground(start, start + 60_000, start, start + 60_000)).to.equal(
      false
    );
    expect(picker.isPickerHeld(start + 2 * 60_000)).to.equal(false);
    expect(
      lock.shouldRelockAfterBackground(start, start + 2 * 60_000, start, start + 2 * 60_000)
    ).to.equal(true);
  });

  it('keeps live wallets off AsyncStorage and falls back after biometric cancel', async function () {
    expect(vault.allowWalletAsyncFallback('live')).to.equal(false);
    expect(vault.allowWalletAsyncFallback('demo')).to.equal(true);
    expect(
      entry.nextUnlockAfterBiometricFail(['pin', 'password'], {
        pinSet: true,
        passwordSet: true,
        authOn: false,
      })
    ).to.equal('pin');
    expect(
      entry.nextUnlockAfterBiometricFail(['password'], {
        pinSet: false,
        passwordSet: true,
        authOn: false,
      })
    ).to.equal('password');
  });

  it('rejects a foreign restore when the bound link is gone but the wallet remains', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    memory.set('quatrivium.appWallet.v1', 'sobre-dueno-intact');
    memory.delete('quatrivium.device.boundWallet');
    memory.delete('mem:quatrivium.device.boundWallet.fallback');
    const passwordBefore = memory.get('quatrivium.lock.password');
    const walletBefore = memory.get('quatrivium.appWallet.v1');
    lock.lockNow();
    const foreign = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    const result = await restore.restoreAccountOnDevice({
      phrase: foreign.mnemonic.phrase,
      password: 'Ataque-9z',
    });
    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal('store-unknown');
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    expect(memory.get('quatrivium.appWallet.v1')).to.equal(walletBefore);
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('keeps a successful password when abort runs after setPassword', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    await lock.setPassword('Nueva-9z');
    expect(memory.get('quatrivium.lock.password')).to.be.a('string');
    await lock.abortPasswordSetup();
    expect(memory.get('quatrivium.lock.password')).to.be.a('string');
    expect((await lock.checkPassword('Nueva-9z')).ok).to.equal(true);
  });

  it('rejects an expired or foreign restore token', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const owner = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    const passwordBefore = memory.get('quatrivium.lock.password');
    memory.set('quatrivium.device.boundWallet', owner.address.toLowerCase());
    memory.delete('mem:quatrivium.device.boundWallet.fallback');
    lock.lockNow();
    let issued = '';
    lock.setReplaceTokenObserverForTests((token) => {
      issued = token;
      throw new Error('capture-token');
    });
    const paused = await restore.restoreAccountOnDevice({
      phrase: owner.mnemonic.phrase,
      password: 'Nueva-9z',
    });
    lock.setReplaceTokenObserverForTests(null);
    expect(paused.ok).to.equal(false);
    expect(paused.reason).to.equal('capture-token');
    expect(issued).to.be.a('string').and.not.equal('');
    let foreign = '';
    try {
      await lock.setPassword('Nueva-9z', undefined, {
        replaceToken: issued,
        restoreAddress: `0x${'ab'.repeat(20)}`,
      });
    } catch (error) {
      foreign = error instanceof Error ? error.message : 'throw';
    }
    expect(foreign).to.equal('password-locked');
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    lock.advanceReplaceClockForTests(61_000);
    let late = '';
    try {
      await lock.setPassword('Nueva-9z', undefined, {
        replaceToken: issued,
        restoreAddress: owner.address,
      });
    } catch (error) {
      late = error instanceof Error ? error.message : 'throw';
    }
    expect(late).to.equal('password-locked');
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    for (const key of [...memory.keys()]) {
      if (String(key).startsWith('quatrivium.lock.gate')) memory.delete(key);
    }
    expect((await lock.checkPassword(PASSWORD)).ok).to.equal(true);
  });

  it('rejects a restore token used twice', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const owner = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(randomBytes(32)));
    memory.set('quatrivium.device.boundWallet', owner.address.toLowerCase());
    lock.lockNow();
    let issued = '';
    lock.setReplaceTokenObserverForTests((token) => {
      issued = token;
    });
    const first = await restore.restoreAccountOnDevice({
      phrase: owner.mnemonic.phrase,
      password: 'Nueva-9z',
    });
    lock.setReplaceTokenObserverForTests(null);
    expect(first.ok).to.equal(true);
    const saved = memory.get('quatrivium.lock.password');
    lock.lockNow();
    let again = '';
    try {
      await lock.setPassword('OtraClave-9z', undefined, {
        replaceToken: issued,
        restoreAddress: owner.address,
      });
    } catch (error) {
      again = error instanceof Error ? error.message : 'throw';
    }
    expect(again).to.equal('password-locked');
    expect(memory.get('quatrivium.lock.password')).to.equal(saved);
    for (const key of [...memory.keys()]) {
      if (String(key).startsWith('quatrivium.lock.gate')) memory.delete(key);
    }
    expect((await lock.checkPassword('Nueva-9z')).ok).to.equal(true);
  });

  it('accepts a valid totp ten minutes later after an app restart', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(3));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', '22'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    await auth.persistAuthenticatorWrap(session.getWalletWrapKey());
    const first = totp.totpAt(secret, Date.now());
    expect((await auth.verifyAuthenticator(first)).ok).to.equal(true);
    for (const key of [...memory.keys()]) {
      if (String(key).startsWith('quatrivium.lock.gate')) memory.delete(key);
      if (String(key).includes('totp_step_run')) memory.delete(key);
    }
    auth.setTotpRunIdForTests('run-b');
    memory.set('qc_totp_step_mono_v1', String(performance.now() + 500_000));
    const future = Date.now() + 10 * 60_000;
    const later = totp.totpAt(secret, future);
    const realNow = Date.now;
    Date.now = () => future;
    try {
      const opened = await auth.verifyAuthenticator(later);
      expect(opened.ok).to.equal(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('still rejects a used totp after an app restart', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    memory.delete('quatrivium.lock.gate');
    memory.delete('quatrivium.lock.attempts');
    await lock.setPassword(PASSWORD);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(1));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', '33'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    await auth.persistAuthenticatorWrap(session.getWalletWrapKey());
    const code = totp.totpAt(secret, Date.now());
    expect((await auth.verifyAuthenticator(code)).ok).to.equal(true);
    memory.delete('qc_totp_step_run_v1');
    memory.set('qc_totp_step_mono_v1', '1');
    if (typeof auth.setTotpRunIdForTests === 'function') {
      auth.setTotpRunIdForTests('run-c');
    }
    if (memory.has('quatrivium.lock.gate')) {
      const row = JSON.parse(memory.get('quatrivium.lock.gate'));
      row.left = 0;
      memory.set('quatrivium.lock.gate', JSON.stringify(row));
    }
    expect((await auth.verifyAuthenticator(code)).ok).to.equal(false);
  });

  it('does not open the wallet when a late success arrives after the verify budget', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    lock.lockNow();
    const passwordBefore = memory.get('quatrivium.lock.password');
    for (const key of [...memory.keys()]) {
      if (String(key).startsWith('quatrivium.lock.gate')) memory.delete(key);
    }
    lock.setVerifyBudgetForTests(50);
    let release = () => {};
    lock.setLockPhaseForTests({
      afterMatch: () =>
        new Promise((done) => {
          release = () => done();
        }),
    });
    const hung = lock.checkPassword(PASSWORD);
    await new Promise((done) => setTimeout(done, 150));
    release();
    const result = await hung;
    if (!result.timeout) throw new Error(`timeout-miss ${JSON.stringify(result)}`);
    expect(result.timeout).to.equal(true);
    expect(result.ok).to.equal(false);
    expect(session.getWalletWrapKey()).to.equal(null);
    expect(memory.get('quatrivium.lock.password')).to.equal(passwordBefore);
    expect(copy.lockFailureCopy('pin', result).key).to.equal('lockVerifyTimeout');
    lock.setLockPhaseForTests(null);
    lock.setVerifyBudgetForTests(null);
  });

  it('keeps the authenticator wrap when the system prompt is cancelled', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(4));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', '44'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    await auth.persistAuthenticatorWrap(session.getWalletWrapKey());
    const wrap = memory.get('qc_totp_wrap_v1');
    expect(wrap).to.be.a('string');
    rejectDeviceAuth = true;
    authError = 'user canceled the authentication';
    lock.lockNow();
    const cancelled = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()));
    rejectDeviceAuth = false;
    expect(cancelled.ok).to.equal(false);
    expect(memory.get('qc_totp_secret_v1')).to.equal(secret);
    expect(memory.get('qc_totp_wrap_v1')).to.equal(wrap);
  });

  it('refuses the legacy totp wrap when the migration mark cannot be read', async function () {
    const { sha256 } = require('@noble/hashes/sha2');
    kdf.setPbkdf2ForTests(async (secret) => sha256(secret));
    await lock.setPassword(PASSWORD);
    const secret = totp.bytesToBase32(new Uint8Array(20).fill(5));
    memory.set('qc_totp_secret_v1', secret);
    memory.set('quatrivium.lock.deviceAuth', '1');
    memory.set('quatrivium.lock.deviceSecret', '55'.repeat(32));
    secretMeta.set('quatrivium.lock.deviceSecret', { requireAuthentication: true });
    const wrap = session.getWalletWrapKey();
    const legacyKey = await box.deriveWrapKeyAsync(secret, 'qc.totp.wrap', 8000);
    memory.set('qc_totp_wrap_v1', box.sealSecret(wrap, legacyKey));
    memory.delete('qc_totp_wrap_mig_v1');
    const store = require('expo-secure-store');
    const previous = store.getItemAsync;
    store.getItemAsync = async (key, options) => {
      if (String(key).includes('totp_wrap_mig')) return new Promise(() => {});
      return previous(key, options);
    };
    lock.lockNow();
    const denied = await auth.unlockWithAuthenticator(totp.totpAt(secret, Date.now()));
    store.getItemAsync = previous;
    expect(denied.ok).to.equal(false);
    expect(session.getWalletWrapKey()).to.equal(null);
  });
});
