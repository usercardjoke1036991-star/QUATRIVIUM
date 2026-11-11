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
let rejectDeviceAuth = false;
const secureWrites = [];

installMock('expo-secure-store', {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
  async getItemAsync(key, options) {
    if (rejectDeviceAuth && options && options.requireAuthentication) {
      throw new Error('no-credential');
    }
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItemAsync(key, value, options) {
    if (crashOnLiveWrap && key === PIN_WRAP) throw new Error('crash');
    if (rejectDeviceAuth && options && options.requireAuthentication) {
      throw new Error('no-credential');
    }
    secureWrites.push({ key, options: options || null });
    memory.set(key, value);
  },
  async deleteItemAsync(key) {
    memory.delete(key);
  },
});

installMock('expo-crypto', {
  randomUUID: () => 'sal-prueba',
  async getRandomBytesAsync(size) {
    return new Uint8Array(size);
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
const errors = loadTs(path.join(__dirname, '..', 'utils', 'txErrors.ts'));
const box = loadTs(path.join(__dirname, '..', 'utils', 'secretBox.ts'));
const lock = loadTs(path.join(__dirname, '..', 'services', 'appLock.ts'));
const wallet = loadTs(path.join(__dirname, '..', 'services', 'appWallet.ts'));
const rpc = loadTs(path.join(__dirname, '..', 'constants', 'rpcConfig.ts'));
const { sha256, toUtf8Bytes } = require('ethers');

const PIN_RECORD = 'quatrivium.lock.pin';
const PIN_WRAP = 'quatrivium.lock.pinWrap';
const PIN_NEXT = 'quatrivium.lock.pinWrap.next';

const PIN = '847291';
const PASSWORD = 'Clave-9f';

describe('app lock PBKDF2', function () {
  this.timeout(120000);

  afterEach(function () {
    kdf.resetPbkdf2ForTests();
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

  it('blocks the pin after ten misses, warns before the fifth password, and wipes the wallet', async function () {
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
    for (let i = 0; i < 3; i += 1) {
      memory.delete('quatrivium.lock.gate');
      const miss = await lock.checkPassword('Otra-8z');
      expect(miss.wipeWarning).to.equal(undefined);
      expect(miss.wiped).to.equal(undefined);
    }
    memory.delete('quatrivium.lock.gate');
    const warning = await lock.checkPassword('Otra-8z');
    expect(warning.wipeWarning).to.equal(true);
    expect(memory.get('quatrivium.appWallet.v1')).to.equal('sobre');
    memory.delete('quatrivium.lock.gate');
    const wiped = await lock.checkPassword('Otra-8z');
    expect(wiped.wiped).to.equal(true);
    expect(memory.has('quatrivium.appWallet.v1')).to.equal(false);
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
