const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const root = path.resolve(__dirname, '..');
const APP_DIRS = [
  'app',
  'assets',
  'components',
  'constants',
  'hooks',
  'i18n',
  'modules',
  'plugins',
  'profile',
  'services',
  'stubs',
  'theme',
  'utils',
  'wallet',
];

function leer(rel) {
  const full = path.join(root, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

function archivos(dir, filtro) {
  const out = [];
  const walk = (abs) => {
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const child = path.join(abs, name);
      if (fs.statSync(child).isDirectory()) walk(child);
      else {
        const rel = path.relative(root, child).split(path.sep).join('/');
        if (filtro(rel)) out.push(rel);
      }
    }
  };
  walk(path.join(root, dir));
  return out;
}

describe('contenido del APK', function () {
  this.timeout(60000);

  it('EAS no sube documentos internos ni secretos', function () {
    const ig = require('ignore')().add(leer('.easignore'));
    const lista = [
      'AUDITORIA.md',
      'HANDOFF.md',
      'CONTEXTO.md',
      'README.md',
      'docs/plan.pdf',
      'informe/nota.md',
      'notas/privado.txt',
      'contracts/QuatriviumCredit.sol',
      'test/reserva.test.js',
      'scripts/deploy-arbitrum-sovereign.cjs',
      '.env',
      '.env.production',
      '.env.mainnet',
      '.env.example',
      'store-assets/x.png',
      'web/invite/index.html',
      '.git/config',
    ];
    const noIgnoradas = lista.filter((rel) => !ig.ignores(rel));
    expect(noIgnoradas).to.deep.equal([]);
  });

  it('EAS sí sube lo que la app necesita', function () {
    const ig = require('ignore')().add(leer('.easignore'));
    const lista = [
      'App.js',
      'index.js',
      'app.json',
      'eas.json',
      'package.json',
      'package-lock.json',
      'metro.config.js',
      'babel.config.js',
      'tsconfig.json',
      'polyfills.js',
      'web3Config.tsx',
      'assets/icon.png',
      'assets/gems/ruby.png',
      'plugins/withQuatriviumAndroidSecurity.js',
      'modules/quatrivium-signing-cert/index.ts',
      'modules/quatrivium-signing-cert/expo-module.config.json',
      'modules/quatrivium-signing-cert/android/src/main/java/expo/modules/quatriviumsigningcert/QuatriviumSigningCertModule.kt',
      'i18n/locales/es.json',
      'constants/deployedAddresses.ts',
      'stubs/ws-stub.js',
    ];
    const deApp = APP_DIRS.flatMap((dir) => archivos(dir, () => true));
    const ignoradas = lista.concat(deApp).filter((rel) => ig.ignores(rel));
    expect(ignoradas).to.deep.equal([]);
  });

  it('.gitignore no deja commitear .env de producción', function () {
    const ig = require('ignore')().add(leer('.gitignore'));
    const got = ['.env', '.env.production', '.env.mainnet', '.env.worker'].map((rel) =>
      ig.ignores(rel)
    );
    expect(got).to.deep.equal([true, true, true, true]);
    expect(ig.ignores('.env.example')).to.equal(false);
  });

  it('Metro no empaqueta documentos', function () {
    const metro = require(path.join(root, 'metro.config.js'));
    const { assetExts, sourceExts } = metro.resolver;
    const mal = ['pdf', 'html', 'yaml', 'yml', 'zip', 'db', 'psd', 'md', 'txt'].filter((ext) =>
      assetExts.includes(ext)
    );
    expect(mal).to.deep.equal([]);
    expect(assetExts).to.include.members(['png', 'jpg', 'ttf', 'otf']);
    expect(sourceExts).to.not.include('md');
    expect(sourceExts).to.not.include('txt');
  });

  it('blockList cierra docs y carpetas que no son app', function () {
    const metro = require(path.join(root, 'metro.config.js'));
    const blockList = metro.resolver.blockList;
    const blocked = (p) => [].concat(blockList).some((re) => re.test(p));
    const deben = [
      'AUDITORIA.md',
      'HANDOFF.md',
      'CONTEXTO.md',
      'README.md',
      'notas.pdf',
      'informe.txt',
      'contracts/QuatriviumCredit.sol',
      'test/reserva.test.js',
      'forge-test/Invariantes.t.sol',
      'scripts/deploy-arbitrum-sovereign.cjs',
      'store-assets/x.png',
      'web/invite/index.html',
      'docs/a.md',
      'informe/a.md',
      '.expo/types/x.d.ts',
      'components/__tests__/a.js',
    ];
    const noBloqueadas = deben
      .map((rel) => path.join(root, rel))
      .filter((p) => !blocked(p))
      .map((p) => path.relative(root, p).split(path.sep).join('/'));
    expect(noBloqueadas).to.deep.equal([]);
    expect(blocked(path.join(root, 'HANDOFF.md').split(path.sep).join('\\'))).to.equal(true);
    const libres = [
      'App.js',
      'index.js',
      'polyfills.js',
      'components/HomeHub.tsx',
      'i18n/locales/es.json',
      'assets/gems/ruby.png',
      'constants/deployedAddresses.ts',
      'stubs/ws-stub.js',
      'node_modules/@openzeppelin/contracts/token/ERC20/ERC20.sol',
      'node_modules/react-native/README.md',
      'node_modules/ethers/lib.commonjs/index.js',
    ];
    const bloqueadas = libres
      .map((rel) => path.join(root, rel))
      .filter((p) => blocked(p))
      .map((p) => path.relative(root, p).split(path.sep).join('/'));
    expect(bloqueadas).to.deep.equal([]);
    expect([].concat(blockList).map((re) => re.flags)).to.deep.equal(
      [].concat(blockList).map(() => '')
    );
  });

  it('Ningún console de la app sale sin __DEV__', function () {
    const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
    const files = ['App.js', 'index.js', 'polyfills.js', 'web3Config.tsx'].concat(
      APP_DIRS.filter((dir) => dir !== 'assets').flatMap((dir) =>
        archivos(dir, (rel) => exts.has(path.posix.extname(rel)))
      )
    );
    const re = /console\.(log|warn|info|debug|error)\s*\(/;
    const infractores = [];
    for (const rel of files) {
      const lines = leer(rel).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!re.test(line)) return;
        if (line.includes('typeof console') || /console\.\w+\s*=/.test(line)) return;
        const alrededor = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (!alrededor.includes('__DEV__')) infractores.push(rel + ':' + (i + 1));
      });
    }
    expect(infractores).to.deep.equal([]);
  });

  it('eas.json no sube sourcemaps ni mete claves en EXPO_PUBLIC', function () {
    const eas = JSON.parse(leer('eas.json'));
    for (const perfil of Object.values(eas.build)) {
      expect(perfil.uploadSourceMaps).to.not.equal(true);
      const env = perfil.env || {};
      for (const [clave, valor] of Object.entries(env)) {
        if (!clave.startsWith('EXPO_PUBLIC_')) continue;
        expect(clave).to.not.match(/KEY|SECRET|PRIVATE|MNEMONIC|TOKEN|PASSWORD/);
        expect(String(valor)).to.not.match(/^0x[0-9a-fA-F]{64}$/);
      }
    }
  });
});
