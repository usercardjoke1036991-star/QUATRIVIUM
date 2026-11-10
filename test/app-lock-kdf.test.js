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

installMock('expo-secure-store', {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
  async getItemAsync(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItemAsync(key, value) {
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
const lock = loadTs(path.join(__dirname, '..', 'services', 'appLock.ts'));

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
    expect(memory.size).to.equal(0);
    const text = errors.humanizeTxError({ message: 'pbkdf2-missing' });
    expect(text.includes('candado') || text.includes('lock key')).to.equal(true);
  });

  it('sets and checks a pin and a password with one derivation and without subtle', async function () {
    const previous = global.crypto;
    global.crypto = {};
    try {
      kdf.takeKdfCalls();
      const wrap = await lock.setPin(PIN);
      expect(kdf.takeKdfCalls()).to.equal(1);
      expect(/^0x[0-9a-f]{64}$/.test(wrap)).to.equal(true);
      const saved = [...memory.values()].find((value) => String(value).includes('pbkdf2-sha256'));
      const record = JSON.parse(saved);
      expect(record.split).to.equal(1);
      expect(record.rounds).to.equal(600000);
      const right = await lock.checkPin(PIN);
      expect(right.ok).to.equal(true);
      expect(kdf.takeKdfCalls()).to.equal(1);
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
});
