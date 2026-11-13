const path = require('path');
const { expect } = require('chai');
const { loadTs } = require('./loadTsApp.cjs');

const lock = loadTs(path.join(__dirname, '..', 'utils', 'lockMigration.ts'));

function memoryStore(failKey) {
  const data = new Map();
  let armed = false;
  return {
    data,
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      if (failKey && key === failKey && armed) throw new Error('disk');
      if (failKey && key === failKey) armed = true;
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
  };
}

describe('pin and password key migration', function () {
  const pin = '847291';
  const salt = 'user-salt';
  const live = 'pin-wrap';
  const staging = 'pin-wrap:next';

  async function sealOld(store, secret, rounds) {
    const { sealSecret } = loadTs(path.join(__dirname, '..', 'utils', 'secretBox.ts'));
    const oldKey = await lock.legacyPasswordWrap(secret, salt, rounds);
    await store.set(live, sealSecret('wallet-key', oldKey));
    return oldKey;
  }

  it('opens a one-round seal, reseals with PBKDF2, and keeps the old blob if the write fails', async function () {
    expect(lock.legacyPinWrapRounds({ v: 3, rounds: 600000 })).to.equal(1);
    const store = memoryStore();
    const oldKey = await sealOld(store, pin, 1);
    const before = await store.get(live);
    const newKey = await lock.wrapKeyFromPbkdf2(pin, salt);
    const plain = await lock.migrateSealedValue(store, live, staging, [oldKey], newKey);
    expect(plain).to.equal('wallet-key');
    const { openSecret } = loadTs(path.join(__dirname, '..', 'utils', 'secretBox.ts'));
    expect(openSecret(await store.get(live), newKey)).to.equal('wallet-key');
    let stale = '';
    try {
      openSecret(await store.get(live), oldKey);
    } catch (error) {
      stale = error.message;
    }
    expect(stale.length).to.be.greaterThan(0);
    expect(await store.get(staging)).to.equal(null);

    const closed = memoryStore();
    await sealOld(closed, pin, 1);
    const again = await lock.migrateSealedValue(closed, live, staging, [oldKey], newKey);
    expect(again).to.equal('wallet-key');

    const broken = memoryStore(live);
    const oldBroken = await sealOld(broken, pin, 1);
    const previous = await broken.get(live);
    let failed = '';
    try {
      await lock.migrateSealedValue(broken, live, staging, [oldBroken], newKey);
    } catch (error) {
      failed = error.message;
    }
    expect(failed).to.equal('disk');
    expect(await broken.get(live)).to.equal(previous);
    expect(openSecret(await broken.get(live), oldBroken)).to.equal('wallet-key');
    expect(before).to.be.a('string');
  });

  it('rejects a wrong pin or password and accepts the right one', async function () {
    const record = {
      v: 3,
      salt,
      hash: await lock.pinVerifier(pin, {
        v: 3,
        salt,
        hash: '',
        kdf: 'pbkdf2-sha256',
        rounds: 600000,
      }),
      kdf: 'pbkdf2-sha256',
      rounds: 600000,
    };
    expect(lock.verifierMatches(await lock.pinVerifier(pin, record), record.hash)).to.equal(true);
    expect(lock.verifierMatches(await lock.pinVerifier('111111', record), record.hash)).to.equal(
      false
    );
    const store = memoryStore();
    const oldKey = await sealOld(store, pin, 1);
    const previous = await store.get(live);
    let wrong = '';
    try {
      await lock.migrateSealedValue(
        store,
        live,
        staging,
        [await lock.legacyPasswordWrap('000000', salt, 1)],
        await lock.wrapKeyFromPbkdf2('000000', salt)
      );
    } catch (error) {
      wrong = error.message;
    }
    expect(wrong).to.equal('locked');
    expect(await store.get(live)).to.equal(previous);
    const password = 'ClaveValida1';
    const passKey = await lock.legacyPasswordWrap(password, salt, 32);
    const { sealSecret, openSecret } = loadTs(path.join(__dirname, '..', 'utils', 'secretBox.ts'));
    await store.set('password-wrap', sealSecret('phrase', passKey));
    const next = await lock.wrapKeyFromPbkdf2(password, salt);
    expect(
      await lock.migrateSealedValue(store, 'password-wrap', 'password-wrap:next', [passKey], next)
    ).to.equal('phrase');
    expect(openSecret(await store.get('password-wrap'), next)).to.equal('phrase');
    let locked = '';
    try {
      lock.assertSessionBeforePinWrite(true, null);
    } catch (error) {
      locked = error.message;
    }
    expect(locked).to.equal('locked');
    lock.assertSessionBeforePinWrite(true, oldKey);
    expect(oldKey.startsWith('0x')).to.equal(true);
  });
});
