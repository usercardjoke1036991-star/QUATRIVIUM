function bag(group) {
  const dev = globalThis.__qcDev;
  if (!dev || !dev[group]) throw new Error(`dev-probes-missing:${group}`);
  return dev[group];
}

function attachLock(lock) {
  Object.assign(lock, bag('lock'));
}

function attachKdf(kdf) {
  Object.assign(kdf, bag('kdf'));
}

function attachAuth(auth) {
  Object.assign(auth, bag('auth'));
}

function attachDevice(device) {
  Object.assign(device, bag('device'));
}

function attachWrite(write) {
  Object.assign(write, bag('write'));
}

function attachWallet(wallet) {
  Object.assign(wallet, bag('wallet'));
}

function attachEntry(entry) {
  Object.assign(entry, bag('entry'));
}

module.exports = {
  attachLock,
  attachKdf,
  attachAuth,
  attachDevice,
  attachWrite,
  attachWallet,
  attachEntry,
};
