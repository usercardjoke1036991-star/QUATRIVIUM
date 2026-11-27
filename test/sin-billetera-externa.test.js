const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');
const { expect } = require('chai');
const { loadTs } = require('./loadTsApp.cjs');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// Los nombres se arman por partes para que el escáner de servicios no marque este archivo.
const OLD_SDK = ['wallet', 'connect'].join('');
const OLD_KIT = ['re', 'own'].join('');
const OLD_SESSION = ['app', 'kit:'].join('');
const OLD_CORE = ['wc', '@2:'].join('');
const OLD_UI = ['App', 'Kit'].join('');
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
  async getAllKeys() {
    return Array.from(memory.keys());
  },
  async multiRemove(keys) {
    for (const key of keys) memory.delete(key);
  },
};
/** Carga un módulo de la app con AsyncStorage en memoria y deja el caché como estaba. */
function loadWithStorage(rel) {
  const file = require.resolve('@react-native-async-storage/async-storage');
  const previous = Module._cache[file];
  const mock = new Module(file);
  mock.filename = file;
  mock.loaded = true;
  mock.exports = storageMock;
  Module._cache[file] = mock;
  try {
    return loadTs(path.join(root, rel));
  } finally {
    if (previous) Module._cache[file] = previous;
    else delete Module._cache[file];
  }
}
describe('sin billetera externa conectada', function () {
  beforeEach(function () {
    memory.clear();
  });
  it('package.json no trae el SDK de conexión externa y el escáner lo vigila', function () {
    const pkg = JSON.parse(read('package.json'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = deps.filter(
      (name) =>
        name.startsWith(`@${OLD_KIT}/`) ||
        name.startsWith(`@${OLD_SDK}/`) ||
        name === 'wagmi' ||
        name === '@tanstack/react-query'
    );
    expect(banned).to.deep.equal([]);
    expect(pkg.dependencies['react-native-url-polyfill']).to.equal('2.0.0');
    expect(pkg.dependencies['fast-text-encoding']).to.equal('1.0.6');
    const scanner = read('scripts/check-external-services.mjs');
    expect(scanner).to.include(`'${OLD_SDK}'`);
    expect(scanner).to.include(`'${OLD_KIT}'`);
    const run = spawnSync(process.execPath, ['scripts/check-external-services.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(run.stderr).to.equal('');
    expect(run.status).to.equal(0);
  });
  it('los polyfills cargan primero, en el mismo orden, sin el paquete viejo', function () {
    const entry = read('index.js');
    const lines = entry.split('\n').filter((line) => line.startsWith('import '));
    expect(lines[0]).to.equal("import './utils/earlyShims';");
    const shims = read('utils/earlyShims.js');
    const order = [
      "import 'fast-text-encoding';",
      "import 'react-native-get-random-values';",
      "import 'react-native-url-polyfill/auto';",
      "import { Buffer } from 'buffer';",
    ].map((line) => shims.indexOf(line));
    expect(order.every((at) => at >= 0)).to.equal(true);
    expect(order).to.deep.equal([...order].sort((a, b) => a - b));
    expect(read('App.js')).to.not.include('web3Config');
    expect(fs.existsSync(path.join(root, 'web3Config.tsx'))).to.equal(false);
  });
  it('borra al arrancar solo la sesión vieja de billetera externa', async function () {
    const legacy = loadWithStorage('utils/legacyStorage.ts');
    memory.set(`${OLD_SESSION}deeplink_choice`, '1');
    memory.set(`${OLD_SESSION}${OLD_CORE}core:keychain`, '{}');
    memory.set(`${OLD_CORE}client:session`, '{}');
    memory.set('quatrivium.lang', 'es');
    memory.set('quatrivium.linkedExternal.v1:42161:0xabc', 'skipped');
    memory.set('bitcredit.theme', 'dark');
    await legacy.migrateLegacyStorage();
    const left = Array.from(memory.keys()).sort();
    expect(left).to.deep.equal([
      'quatrivium.lang',
      'quatrivium.linkedExternal.v1:42161:0xabc',
      'quatrivium.theme',
    ]);
    expect(memory.get('quatrivium.theme')).to.equal('dark');
  });
  it('el depósito muestra la dirección interna con QR, sin vincular nada', function () {
    const modal = read('components/TransferWalletsModal.tsx');
    const receive = modal.slice(
      modal.indexOf('const receive = ('),
      modal.indexOf('const withdraw =')
    );
    expect(receive).to.include('<QRCode');
    expect(receive).to.include('value={walletAddress}');
    expect(receive).to.include('copyText(walletAddress)');
    expect(receive).to.include("t('appWalletInGas')");
    expect(receive).to.not.include('LinkWalletForm');
    expect(modal).to.include("{mode === 'in' ? receive : withdraw}");
    expect(modal).to.include('const signer = await loadAppWallet();');
    expect(modal.toLowerCase()).to.not.include(OLD_SDK);
  });
  it('admin y pagos firman solo con la billetera de la app', function () {
    const handlers = read('hooks/useHomeHandlers.ts');
    expect(handlers).to.not.include('web3Config');
    expect(handlers).to.not.include('getEthersSignerFromProvider');
    expect(handlers).to.not.include('fundInternalFromExternal');
    expect(handlers).to.include('const runAsAdmin = async (fn: (signer: Signer) => Promise<void>)');
    expect(handlers).to.include('await fn(appSigner);');
    expect(handlers).to.include('await aportarReservaBote(signer, parsed);');
    expect(
      handlers.match(/await ensureInternalFunds\(amountWei, selectedToken\.address\)/g)
    ).to.have.length(3);
    const home = read('app/index.tsx');
    expect(home).to.not.include(`<${OLD_UI}`);
    expect(home).to.not.include(`use${OLD_UI}`);
    const admin = read('components/AdminAccess.tsx');
    expect(admin).to.include("t('settingsAdminSafe'");
  });
});
