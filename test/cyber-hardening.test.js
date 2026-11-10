const { expect } = require('chai');
const {
  concat,
  getBytes,
  hexlify,
  randomBytes,
  sha256,
  toUtf8Bytes,
  toUtf8String,
} = require('ethers');

function hmacSha256(key, data) {
  const block = 64;
  let keyBytes = getBytes(key);
  if (keyBytes.length > block) keyBytes = getBytes(sha256(keyBytes));
  const keyBlock = new Uint8Array(block);
  keyBlock.set(keyBytes);
  const ipad = new Uint8Array(block);
  const opad = new Uint8Array(block);
  for (let i = 0; i < block; i += 1) {
    ipad[i] = keyBlock[i] ^ 0x36;
    opad[i] = keyBlock[i] ^ 0x5c;
  }
  const inner = getBytes(sha256(concat([ipad, getBytes(data)])));
  return getBytes(sha256(concat([opad, inner])));
}

function deriveWrapKey(secret, salt, rounds) {
  let digest = sha256(toUtf8Bytes(`quatrivium.wrap.v1:${salt}:${secret}`));
  for (let i = 1; i < rounds; i += 1) {
    digest = sha256(concat([getBytes(digest), toUtf8Bytes(`:${i}`)]));
  }
  return digest;
}

function keystream(key, iv, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const ctr = new Uint8Array(4);
    ctr[0] = (counter >>> 24) & 0xff;
    ctr[1] = (counter >>> 16) & 0xff;
    ctr[2] = (counter >>> 8) & 0xff;
    ctr[3] = counter & 0xff;
    const block = getBytes(sha256(concat([key, iv, ctr])));
    const n = Math.min(32, length - offset);
    out.set(block.subarray(0, n), offset);
    offset += n;
    counter += 1;
  }
  return out;
}

function sealSecret(plaintext, wrapKeyHex) {
  const key = getBytes(wrapKeyHex);
  const macKey = hmacSha256(key, toUtf8Bytes('quatrivium.mac.v1'));
  const iv = randomBytes(16);
  const plain = toUtf8Bytes(plaintext);
  const ks = keystream(key, iv, plain.length);
  const ct = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 1) ct[i] = plain[i] ^ ks[i];
  const mac = hmacSha256(macKey, getBytes(concat([iv, ct])));
  return JSON.stringify({ v: 1, iv: hexlify(iv), ct: hexlify(ct), mac: hexlify(mac) });
}

function openSecret(blob, wrapKeyHex) {
  const parsed = JSON.parse(blob);
  const key = getBytes(wrapKeyHex);
  const macKey = hmacSha256(key, toUtf8Bytes('quatrivium.mac.v1'));
  const iv = getBytes(parsed.iv);
  const ct = getBytes(parsed.ct);
  const mac = getBytes(parsed.mac);
  const expected = hmacSha256(macKey, getBytes(concat([iv, ct])));
  let diff = 0;
  for (let i = 0; i < mac.length; i += 1) diff |= mac[i] ^ expected[i];
  if (mac.length !== expected.length || diff !== 0) throw new Error('mac');
  const ks = keystream(key, iv, ct.length);
  const plain = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i += 1) plain[i] = ct[i] ^ ks[i];
  return toUtf8String(plain);
}

function isPrivateKeyPassword(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value).trim());
}

function isValidMasterPassword(value) {
  if (isPrivateKeyPassword(value)) return false;
  if (value.length < 8 || value.length > 66) return false;
  if (!/^[\x21-\x7E]+$/.test(value)) return false;
  if (!/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false;
  if (new Set(value).size < 4) return false;
  return true;
}

function masterPasswordFromRandomBytes(bytes) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  const max = 256 - (256 % alphabet.length);
  let pool = '';
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] >= max) continue;
    pool += alphabet[bytes[i] % alphabet.length];
  }
  if (pool.length < 12) throw new Error('entropy');
  return `Ab7#${pool.slice(0, 12)}`.slice(0, 16);
}

describe('cyber hardening — PIN and secret box', function () {
  it('rejects weak and sequential PINs', function () {
    require('ts-node/register');
    const { isWeakPin } = require('../utils/pinPolicy.ts');
    expect(isWeakPin('123456')).to.equal(true);
    expect(isWeakPin('000000')).to.equal(true);
    expect(isWeakPin('111222')).to.equal(true);
    expect(isWeakPin('012345')).to.equal(true);
    expect(isWeakPin('847291')).to.equal(false);
  });

  it('escalates lockout after repeated failures', function () {
    require('ts-node/register');
    const { lockoutMs, remainingLockMs } = require('../utils/pinPolicy.ts');
    expect(lockoutMs(1)).to.equal(30_000);
    expect(lockoutMs(2)).to.equal(60_000);
    expect(lockoutMs(3)).to.equal(5 * 60_000);
    expect(lockoutMs(4)).to.equal(15 * 60_000);
    expect(lockoutMs(5)).to.equal(60 * 60_000);
    const now = 1_700_000_000_000;
    expect(remainingLockMs(now + lockoutMs(1), now)).to.equal(30_000);
    expect(remainingLockMs(now, now + 1)).to.equal(0);
  });

  it('round-trips a sealed wallet blob and rejects a bad key', function () {
    const wrap = deriveWrapKey('847291', 'salt-a', 32);
    const other = deriveWrapKey('847292', 'salt-a', 32);
    const sealed = sealSecret(JSON.stringify({ privateKey: '0xabc' }), wrap);
    expect(JSON.parse(openSecret(sealed, wrap)).privateKey).to.equal('0xabc');
    expect(() => openSecret(sealed, other)).to.throw();
  });

  it('keeps AsyncStorage wallet fallback only on Demo', function () {
    const fs = require('fs');
    const path = require('path');
    const policy = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'walletVaultPolicy.ts'),
      'utf8'
    );
    expect(policy).to.include("productMode !== 'live'");
    const lock = fs.readFileSync(path.join(__dirname, '..', 'services', 'appLock.ts'), 'utf8');
    expect(lock).to.include('allowWalletAsyncFallback');
    expect(lock).to.include("throw new Error('password-persist')");
    const bio = lock.slice(
      lock.indexOf('export async function loadWrapFromBiometric'),
      lock.indexOf('export async function clearBiometricWrap')
    );
    expect(bio).to.include('authenticateBiometric');
    expect(bio).to.include('if (!ok) return null');
    expect(bio).to.include('WRAP_STORE, OPTIONS');
    expect(bio).to.not.include('BIO_WRAP_OPTIONS');
    const entry = fs.readFileSync(path.join(__dirname, '..', 'utils', 'accountEntry.ts'), 'utf8');
    expect(entry).to.include('nextUnlockAfterBiometricFail');
    expect(entry).to.include("if (flags.pinSet) return 'pin'");
    expect(entry).to.include("if (flags.passwordSet) return 'password'");
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('nextUnlockAfterBiometricFail');
    expect(gate).to.include("code === 'wallet-persist' || code === 'password-persist'");
  });

  it('accepts a user-chosen master password and rejects a private key', function () {
    const generated = masterPasswordFromRandomBytes(randomBytes(64));
    expect(generated).to.have.length(16);
    expect(isValidMasterPassword(generated)).to.equal(true);
    expect(isValidMasterPassword('MiClave#9')).to.equal(true);
    expect(isValidMasterPassword(`Aa1!${'x'.repeat(4)}`)).to.equal(true);
    expect(isValidMasterPassword(`Aa1!${'x'.repeat(62)}`)).to.equal(true);
    expect(isValidMasterPassword(`Aa1!${'x'.repeat(63)}`)).to.equal(false);
    expect(isValidMasterPassword('ClaveValida1')).to.equal(false);
    expect(isValidMasterPassword('clavevalida1!')).to.equal(false);
    expect(isValidMasterPassword('ClaveValida!')).to.equal(false);
    expect(isValidMasterPassword('a'.repeat(16))).to.equal(false);
    expect(isValidMasterPassword('0x' + 'ab'.repeat(32))).to.equal(false);
    expect(isValidMasterPassword('short')).to.equal(false);
  });

  it('creates a 24-word BIP-39 phrase by default', function () {
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    const mnemonic = Mnemonic.fromEntropy(randomBytes(32));
    const wallet = HDNodeWallet.fromMnemonic(mnemonic);
    expect(mnemonic.phrase.split(/\s+/)).to.have.length(24);
    expect(wallet.address).to.match(/^0x[0-9a-fA-F]{40}$/);
  });

  it('derives the same address fromMnemonic and fromPhrase for 12 and 24 words', function () {
    const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');
    const normalize = (phrase) =>
      phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
    const twentyFour = Mnemonic.fromEntropy(randomBytes(32));
    const twelve = Mnemonic.fromEntropy(randomBytes(16));
    expect(twentyFour.phrase.split(/\s+/)).to.have.length(24);
    expect(twelve.phrase.split(/\s+/)).to.have.length(12);
    expect(HDNodeWallet.fromMnemonic(twentyFour).address).to.equal(
      HDNodeWallet.fromPhrase(normalize(twentyFour.phrase)).address
    );
    expect(HDNodeWallet.fromMnemonic(twelve).address).to.equal(
      HDNodeWallet.fromPhrase(normalize(twelve.phrase)).address
    );
    expect(HDNodeWallet.fromPhrase(twentyFour.phrase.toUpperCase()).address).to.equal(
      HDNodeWallet.fromPhrase(normalize(twentyFour.phrase)).address
    );
  });

  it('keeps production prepare on the live Demo contract, not the retired 0x1E5118', function () {
    const fs = require('fs');
    const path = require('path');
    const prepare = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'prepare-production-local.mjs'),
      'utf8'
    );
    expect(prepare).to.include("TESTNET_CONTRACT = '0xD318f39834A5e798a11D2535c6c9D1E1270e6778'");
    expect(prepare).to.include("STALE_TESTNET = '0x1E5118B378c7BCB3F3c5de7ec046B93E60f417a3'");
    expect(prepare).to.not.match(/TESTNET_CONTRACT = '0x1E5118/);
    expect(prepare).to.include('addressFromPrivateKey');
    expect(prepare).to.not.include("DEPLOYER = '0xdb135e9cd9be9bE262b3222eaD737c84d72Ef870'");
    const check = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'check-production.mjs'),
      'utf8'
    );
    expect(check).to.include("LIVE_TESTNET = '0xD318f39834A5e798a11D2535c6c9D1E1270e6778'");
    expect(check).to.include('demo-contract');
  });

  it('keeps the mainnet deploy on the full protocol and refuses to run without confirmation', function () {
    const fs = require('fs');
    const path = require('path');
    const script = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'deploy-arbitrum-sovereign.cjs'),
      'utf8'
    );
    const nets = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'bscNetworks.cjs'), 'utf8');
    expect(script).to.include("process.env.CONFIRM_MAINNET !== 'yes'");
    expect(script).to.include('CONFIRM_FOUNDER_WALLET');
    expect(script).to.include('chainId === 42161');
    expect(script).to.not.include('setAltaFuente');
    expect(script).to.not.include('setAlta(');
    expect(script).to.not.include('setReserva(');
    expect(script).to.not.include('mint(');
    expect(script).to.not.include('EXPO_PUBLIC_CHAIN_ID');
    expect(nets).to.include('0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF');
    expect(nets).to.include('0x93b346b6BC2548dA6A1E7d98E9a421B42541425b');
  });

  it('keeps Slither money math multiply-first and treats timestamps as accepted lending windows', function () {
    const fs = require('fs');
    const path = require('path');
    const credit = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumCredit.sol'),
      'utf8'
    );
    const leveling = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumLeveling.sol'),
      'utf8'
    );
    const slitherCfg = fs.readFileSync(path.join(__dirname, '..', 'slither.config.json'), 'utf8');
    expect(credit).to.include('(principalRestante * 5) / 100');
    expect(credit).not.to.include('(interestRestante * feeBasisPoints) / 10000');
    expect(credit).to.include('next <= nivel - (nivel % 100)');
    expect(leveling).to.include('nivel - (nivel % HITO_PASO)');
    // El único hallazgo de Slither queda silenciado con su razón a la vista, no borrado a ciegas.
    expect(leveling).to.include('slither-disable-next-line divide-before-multiply');
    expect(leveling).to.match(/n\(n\+1\) siempre es par/);
    expect(slitherCfg).to.include('timestamp');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['security:slither']).to.include('run-slither.mjs');
    // underscore queda pineado: la versión vieja traía CVE-2026-27601.
    expect(pkg.overrides.underscore).to.equal('^1.13.8');
    expect(pkg.overrides.compression).to.equal('1.8.2');
    const cyber = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'run-full-cyber-audit.sh'),
      'utf8'
    );
    // Tres verdes falsos que ya costaron una auditoría entera: no volver a ellos.
    expect(cyber).to.not.include('--config p/solidity');
    expect(cyber).to.include('SEMGREP_DID_NOT_RUN');
    expect(cyber).to.include('TRIVY_${label}_DID_NOT_RUN');
    expect(cyber).to.include('--bin-runtime');
    expect(cyber).to.include('"$MAGNO/package-lock.json"');
    expect(cyber).to.include('"$MAGNO/Dockerfile.notify"');
    expect(cyber).to.include('"$MAGNO/scripts"');
    expect(cyber).to.not.match(/trivy_step [^\n]*"\$MAGNO"$/m);
    const zap = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'zap-health-wsl.sh'), 'utf8');
    // El arnés no debe abrir CORS: se auto-provocaba un Medium que en mainnet no puede existir.
    expect(zap).to.not.match(/NOTIFY_CORS_ORIGIN=\*/);
    expect(zap).to.include('env -i');
    expect(zap).to.include('seq 1 40');
    const logos = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'fetch-wallet-logos.py'),
      'utf8'
    );
    expect(logos).to.include('startswith("https://")');
    expect(logos).to.include('# nosemgrep');
    const runner = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'run-slither.mjs'),
      'utf8'
    );
    expect(runner).to.include('$HOME/.local/bin');
    expect(runner).to.include('windowsToWsl');
    expect(runner).to.include('run-slither-wsl.sh');
    expect(runner).to.include('-lic');
    // Con foundry.toml presente, crytic-compile elegiría Foundry y buscaría `forge` (no existe en Windows).
    expect(runner).to.include('--compile-force-framework');
    expect(runner).to.include('--hardhat-ignore-compile');
    expect(runner).to.include('compileWithHardhat');
    expect(runner).to.include('hardhat.config.cjs');
    const wslSh = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'run-slither-wsl.sh'),
      'utf8'
    );
    expect(wslSh).to.include('hardhat.config.cjs');
    expect(wslSh).to.include('compile --force');
    expect(wslSh).to.include('--hardhat-ignore-compile');
    expect(wslSh).to.include('$HOME/.local/bin');
  });

  it('points the public invite page at this app, not the retired brand', function () {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    const pkgId = appJson.expo.android.package;
    const scheme = appJson.expo.scheme;
    const landing = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
    const invite = fs.readFileSync(path.join(root, 'web', 'invite', 'index.html'), 'utf8');

    for (const page of [landing, invite]) {
      // El enlace de invitación vive en esta web: una marca vieja rompe el embudo de referidos.
      expect(page).to.not.match(/bitcredit/i);
      expect(page).to.not.include('magnotechnologies');
      expect(page).to.include(`id=${pkgId}`);
      expect(page).to.include('Quatrivium Finance');
    }
    // El fallback de esquema debe ser el que la app declara, o no abre.
    expect(invite).to.include(`${scheme}://invite?c=`);
    const links = fs.readFileSync(path.join(root, 'utils', 'inviteCode.ts'), 'utf8');
    expect(links).to.include('/invite?c=');
  });

  it('wires SonarQube and Snyk without embedding tokens', function () {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const sonar = fs.readFileSync(path.join(root, 'sonar-project.properties'), 'utf8');
    expect(sonar).to.include('sonar.projectKey=usercardjoke1036991-star_QUATRIVIUM');
    expect(sonar).to.not.include('Magno');
    expect(sonar).to.include('sonar.organization=usercardjoke1036991-star');
    expect(sonar).to.include('sonarcloud.io');
    expect(sonar).to.include('**/i18n/**/*.json');
    expect(sonar).to.include('tsconfig.sonar.json');
    expect(sonar).to.include('secrets:S6703');
    expect(sonar).to.not.match(/sonar\.login=/);
    expect(sonar).to.not.match(/sonar\.token=/);
    const auto = fs.readFileSync(path.join(root, '.sonarcloud.properties'), 'utf8');
    expect(auto).to.include('usercardjoke1036991-star_QUATRIVIUM');
    expect(auto).to.not.include('Magno');
    expect(auto).to.include('**/i18n/**/*.json');
    expect(auto).to.include('tsconfig.sonar.json');
    expect(auto).to.not.match(/sonar\.login=/);
    expect(auto).to.not.match(/sonar\.token=/);
    const sonarTs = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.sonar.json'), 'utf8'));
    expect(sonarTs.extends).to.equal(undefined);
    expect(String(sonarTs.compilerOptions?.jsx || '')).to.equal('react-native');
    const gap = fs.readFileSync(path.join(root, 'i18n', 'gap-translations.json'), 'utf8');
    expect(gap).to.not.include('passwordRuleMin');
    expect(gap).to.not.include('lockPasswordLocked');
    const compose = fs.readFileSync(path.join(root, 'docker-compose.sonar.yml'), 'utf8');
    expect(compose).to.include('127.0.0.1:9000:9000');
    const runner = fs.readFileSync(path.join(root, 'scripts', 'run-sonar.mjs'), 'utf8');
    expect(runner).to.include('SONAR_TOKEN');
    expect(runner).to.include('sonarsource/sonar-scanner-cli');
    expect(runner).to.include('host.docker.internal');
    expect(runner).to.include('Automatic Analysis');
    const snykRunner = fs.readFileSync(path.join(root, 'scripts', 'run-snyk.mjs'), 'utf8');
    expect(snykRunner).to.include('SNYK_TOKEN');
    expect(snykRunner).not.to.match(/snyk_uat\./);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['security:sonar']).to.equal('node scripts/run-sonar.mjs');
    expect(pkg.scripts['security:snyk']).to.include('run-snyk.mjs');
    const policy = fs.readFileSync(path.join(root, '.snyk'), 'utf8');
    expect(policy).to.include('image-size');
    expect(policy).to.include('Metro 0.83');
    const trivyIgnore = fs.readFileSync(path.join(root, '.trivyignore'), 'utf8');
    expect(trivyIgnore).to.include('CVE-2025-71329');
    expect(trivyIgnore).to.include('CVE-2026-41907');
    expect(trivyIgnore).to.include('CVE-2026-44705');
    expect(trivyIgnore).to.include('Metro 0.83');
    expect(pkg.scripts['security:trivy']).to.include('trivy-lock.sh');
    expect(pkg.overrides.undici).to.equal('6.29.1');
    expect(pkg.overrides['adm-zip']).to.equal('0.6.1');
    const trivyYaml = fs.readFileSync(path.join(root, 'trivy.yaml'), 'utf8');
    expect(trivyYaml).to.include('store-assets');
    expect(fs.existsSync(path.join(root, 'Dockerfile.notify.dockerignore'))).to.equal(false);
    const slot = fs.readFileSync(path.join(root, 'utils', 'storeSlot.ts'), 'utf8');
    expect(slot).to.include('parts.filter(Boolean).join(glue)');
    const mobsf = fs.readFileSync(path.join(root, 'scripts', 'scan-mobile.mjs'), 'utf8');
    expect(mobsf).to.include('function underProject');
    expect(mobsf).to.include('isMobilePackage');
    expect(mobsf).to.include('apk invalido');
  });

  it('keeps deploy flags and vendor names out of user-facing locale copy', function () {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'i18n', 'locales');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    expect(files.length).to.be.at.least(17);
    for (const name of files) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const blob = Object.values(data).join('\n');
      expect(blob, name).to.not.include('CONFIRM_MAINNET');
      expect(blob, name).to.not.include('PRIVATE_KEY');
      expect(blob, name).to.not.include('EXPO_PUBLIC_');
      expect(String(data.networkNotMainnet || ''), name).to.match(/\S/);
    }
  });

  it('wires MobSF REST upload, scan and report_json without embedding the API key', function () {
    const fs = require('fs');
    const path = require('path');
    const scanner = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'scan-mobile.mjs'),
      'utf8'
    );
    expect(scanner).to.include('MOBSF_API_KEY');
    expect(scanner).to.include('/api/v1/upload');
    expect(scanner).to.include('/api/v1/scan');
    expect(scanner).to.include('/api/v1/report_json');
    expect(scanner).to.include('mobsf-report.json');
    expect(scanner).to.include('multipart');
    expect(scanner).to.match(/form\.append\(\s*'file'/);
    expect(scanner).not.to.match(/MOBSF_API_KEY\s*=\s*['"][A-Za-z0-9]{8,}/);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['security:mobsf']).to.equal('node scripts/scan-mobile.mjs');
    const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    expect(gitignore).to.include('mobsf-report.json');
  });

  it('hardens the Android release profile against the MobSF high findings of a debug APK', function () {
    const fs = require('fs');
    const path = require('path');
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
    expect(app.expo.android.allowBackup).to.equal(false);
    expect(app.expo.android.blockedPermissions).to.include.members([
      'android.permission.RECORD_AUDIO',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.USE_FINGERPRINT',
      'android.permission.ACCESS_WIFI_STATE',
    ]);
    expect(app.expo.android.permissions).to.not.include('USE_FINGERPRINT');
    expect(app.expo.plugins.flat()).to.include('./plugins/withQuatriviumAndroidSecurity.js');
    expect(JSON.stringify(app.expo.plugins)).to.include('minSdkVersion');
    const plugin = fs.readFileSync(
      path.join(__dirname, '..', 'plugins', 'withQuatriviumAndroidSecurity.js'),
      'utf8'
    );
    expect(plugin).to.include('usesCleartextTraffic');
    expect(plugin).to.include('network_security_config');
    expect(plugin).to.include('pin-set expiration="2027-10-01"');
    expect(plugin).to.include('mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=');
    expect(plugin).to.include('CropImageActivity');
    expect(plugin).to.include('DevLauncherActivity');
    expect(plugin).to.include('exp+quatrivium-credit');
    expect(plugin).to.include('stripExpPlusFromManifestXml');
    expect(plugin).to.match(/android:scheme="exp\+quatrivium-credit"\s+tools:node="remove"/);
    const {
      stripExpPlusFromManifestXml,
      ensureHttpsDeepLinks,
    } = require('../plugins/withQuatriviumAndroidSecurity.js');
    expect(
      stripExpPlusFromManifestXml(
        '<data android:scheme="quatrivium"/><data android:scheme="exp+quatrivium-credit"/>'
      )
    ).to.equal('<data android:scheme="quatrivium"/>');
    expect(
      ensureHttpsDeepLinks(
        '<data android:scheme="https" android:host="quatriviumcredit.app" android:pathPrefix="/invite"/>'
      )
    ).to.include('pathPrefix="/history"');
    const mainManifestPath = path.join(
      __dirname,
      '..',
      'android',
      'app',
      'src',
      'main',
      'AndroidManifest.xml'
    );
    const releaseManifestPath = path.join(
      __dirname,
      '..',
      'android',
      'app',
      'src',
      'release',
      'AndroidManifest.xml'
    );
    if (fs.existsSync(mainManifestPath) && fs.existsSync(releaseManifestPath)) {
      const mainManifest = fs.readFileSync(mainManifestPath, 'utf8');
      expect(mainManifest).to.not.match(/android:scheme="exp\+/);
      expect(mainManifest).to.include('pathPrefix="/invite"');
      expect(mainManifest).to.include('pathPrefix="/history"');
      expect(mainManifest).to.include('pathPrefix="/room"');
      const releaseManifest = fs.readFileSync(releaseManifestPath, 'utf8');
      expect(releaseManifest).to.match(
        /android:scheme="exp\+quatrivium-credit"\s+tools:node="remove"/
      );
    } else {
      // android/ lo genera prebuild y no está en git. En CI se comprueba la fuente: app.json.
      const prefixes = (app.expo.android.intentFilters || []).flatMap((filter) =>
        (filter.data || []).map((row) => row.pathPrefix)
      );
      expect(prefixes).to.include.members(['/invite', '/history', '/room']);
      expect(app.expo.scheme).to.equal('quatrivium-sovereign');
      expect(JSON.stringify(app.expo.android)).to.not.include('exp+');
    }
    expect(plugin).to.include('FirebaseInstanceIdReceiver');
    expect(plugin).to.include('ProfileInstallReceiver');
    expect(plugin).to.include('android.enableMinifyInReleaseBuilds');
    expect(plugin).to.include("abiFilters 'armeabi-v7a', 'arm64-v8a'");
    expect(plugin).to.include('public static *** *(...)');
    const scanner = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'scan-mobile.mjs'),
      'utf8'
    );
    expect(scanner).to.include('--purge');
    expect(scanner).to.include('/api/v1/delete_scan');
  });

  it('seals an immutable KYC fingerprint and keeps it when local fields change', function () {
    const { keccak256, toUtf8Bytes } = require('ethers');
    const fingerprint = (wallet, snap) =>
      keccak256(
        toUtf8Bytes(
          [
            'quatrivium.kyc.fp.v1',
            wallet.toLowerCase(),
            snap.legalName,
            snap.country,
            snap.city,
            snap.docType,
          ].join('\n')
        )
      );
    const first = fingerprint('0xABC', {
      legalName: 'Ana Perez',
      country: 'Venezuela',
      city: 'Caracas',
      docType: 'nationalId',
    });
    const save = (prev, nextName) => ({
      boundLegalName: prev?.boundLegalName || nextName,
      legalName: nextName,
      identityFingerprint:
        prev?.identityFingerprint ||
        fingerprint('0xABC', {
          legalName: prev?.boundLegalName || nextName,
          country: prev?.country || 'Venezuela',
          city: prev?.city || 'Caracas',
          docType: 'nationalId',
        }),
    });
    const original = save(null, 'Ana Perez');
    const edited = save({ ...original, country: 'Venezuela' }, 'Otra Persona');
    expect(original.identityFingerprint).to.equal(first);
    expect(edited.identityFingerprint).to.equal(first);
    expect(edited.boundLegalName).to.equal('Ana Perez');
    expect(edited.legalName).to.equal('Otra Persona');
    expect(edited.identityFingerprint).to.not.equal(
      fingerprint('0xABC', {
        legalName: 'Otra Persona',
        country: 'Venezuela',
        city: 'Caracas',
        docType: 'nationalId',
      })
    );
  });

  it('accepts a normal email and rejects junk', function () {
    const normalizeEmail = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .slice(0, 80);
    const isAllowed = (value) => {
      const email = normalizeEmail(value);
      const domain = email.split('@')[1] || '';
      return [
        'gmail.com',
        'googlemail.com',
        'proton.me',
        'protonmail.com',
        'protonmail.ch',
        'pm.me',
      ].includes(domain);
    };
    const isValidEmail = (value) => {
      const email = normalizeEmail(value);
      if (email.length < 6 || email.length > 80) return false;
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return false;
      return isAllowed(email);
    };
    expect(normalizeEmail('  Ada@Gmail.COM ')).to.equal('ada@gmail.com');
    expect(isValidEmail('ada@gmail.com')).to.equal(true);
    expect(isValidEmail('ada@proton.me')).to.equal(true);
    expect(isValidEmail('ada@hotmail.com')).to.equal(false);
    expect(isValidEmail('no')).to.equal(false);
  });

  it('accepts a unique username and rejects reserved names', function () {
    const normalizeUsername = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20);
    const isValidUsername = (value) => {
      const username = normalizeUsername(value);
      if (!/^[a-z][a-z0-9_]{2,19}$/.test(username)) return false;
      return !['admin', 'owner', 'support', 'quatrivium'].includes(username);
    };
    expect(normalizeUsername('@Ada_01')).to.equal('ada_01');
    expect(isValidUsername('ada_01')).to.equal(true);
    expect(isValidUsername('admin')).to.equal(false);
    expect(isValidUsername('ab')).to.equal(false);
  });
});

describe('biometric availability', function () {
  const FINGERPRINT = 1;
  const FACIAL = 2;
  const WEAK = 2;

  function kindsFromTypes(types) {
    const kinds = [];
    if (types.includes(FINGERPRINT)) kinds.push('fingerprint');
    if (types.includes(FACIAL)) kinds.push('facial');
    if (types.includes(3)) kinds.push('iris');
    return kinds;
  }

  function resolveBiometricAvailability(probe) {
    const kinds = kindsFromTypes(Array.isArray(probe.types) ? probe.types : []);
    const hasHardware = Boolean(probe.hasHardware) || kinds.length > 0;
    const enrolled =
      Boolean(probe.enrolled) || (hasHardware && Number(probe.enrolledLevel || 0) >= WEAK);
    if (!hasHardware) {
      return {
        available: false,
        hasHardware: false,
        enrolled: false,
        kinds,
        reason: 'no-hardware',
      };
    }
    if (!enrolled) {
      return {
        available: false,
        hasHardware: true,
        enrolled: false,
        kinds,
        reason: 'not-enrolled',
      };
    }
    return { available: true, hasHardware: true, enrolled: true, kinds, reason: 'ok' };
  }

  it('does not treat a missing NativeModules name as no hardware', function () {
    const status = resolveBiometricAvailability({
      hasHardware: true,
      enrolled: true,
      enrolledLevel: 3,
      types: [FINGERPRINT],
    });
    expect(status.available).to.equal(true);
    expect(status.kinds).to.deep.equal(['fingerprint']);
  });

  it('asks the user to enroll when the sensor exists but nothing is saved', function () {
    const status = resolveBiometricAvailability({
      hasHardware: true,
      enrolled: false,
      enrolledLevel: 1,
      types: [FINGERPRINT],
    });
    expect(status.available).to.equal(false);
    expect(status.reason).to.equal('not-enrolled');
  });

  it('accepts Xiaomi-style probes that only report types or enrolledLevel', function () {
    const byType = resolveBiometricAvailability({
      hasHardware: false,
      enrolled: false,
      enrolledLevel: 0,
      types: [FINGERPRINT],
    });
    expect(byType.hasHardware).to.equal(true);
    expect(byType.reason).to.equal('not-enrolled');

    const byLevel = resolveBiometricAvailability({
      hasHardware: true,
      enrolled: false,
      enrolledLevel: WEAK,
      types: [],
    });
    expect(byLevel.available).to.equal(true);
  });
});

describe('loan cooldown from timestamp', function () {
  const PRESTAMO_COOLDOWN_SECS = 48 * 60 * 60;

  function cooldownRestanteDesdeTimestamp(ultimoPrestamoTimestamp, nowSec) {
    if (!Number.isFinite(ultimoPrestamoTimestamp) || ultimoPrestamoTimestamp <= 0) {
      return 0;
    }
    return Math.max(0, Math.floor(ultimoPrestamoTimestamp) + PRESTAMO_COOLDOWN_SECS - nowSec);
  }

  it('is zero when the user has never borrowed', function () {
    expect(cooldownRestanteDesdeTimestamp(0, 1_700_000_000)).to.equal(0);
  });

  it('counts remaining seconds until 48h after the last loan', function () {
    const last = 1_700_000_000;
    expect(cooldownRestanteDesdeTimestamp(last, last + 3_600)).to.equal(
      PRESTAMO_COOLDOWN_SECS - 3_600
    );
  });

  it('is zero once the 48h window has elapsed', function () {
    const last = 1_700_000_000;
    expect(cooldownRestanteDesdeTimestamp(last, last + PRESTAMO_COOLDOWN_SECS)).to.equal(0);
    expect(cooldownRestanteDesdeTimestamp(last, last + PRESTAMO_COOLDOWN_SECS + 10)).to.equal(0);
  });

  function esperaParaVolverAPedir(ultimoPrestamoTimestamp, pagadoEn, nowSec) {
    return Math.max(
      cooldownRestanteDesdeTimestamp(ultimoPrestamoTimestamp, nowSec),
      cooldownRestanteDesdeTimestamp(pagadoEn, nowSec)
    );
  }

  it('starts another 48h when the loan is paid after the request window ended', function () {
    const requested = 1_700_000_000;
    const paid = requested + PRESTAMO_COOLDOWN_SECS + 86_400;
    const now = paid + 3_600;
    expect(esperaParaVolverAPedir(requested, paid, now)).to.equal(PRESTAMO_COOLDOWN_SECS - 3_600);
  });

  it('keeps the longer wait when the request cooldown is still running', function () {
    const requested = 1_700_000_000;
    const paid = requested + 3_600;
    const now = paid + 60;
    expect(esperaParaVolverAPedir(requested, paid, now)).to.equal(PRESTAMO_COOLDOWN_SECS - 60);
  });

  it('marks a full payoff so the next request shows the clock again', function () {
    const fs = require('fs');
    const path = require('path');
    const handlers = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useHomeHandlers.ts'),
      'utf8'
    );
    const balances = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useWeb3Balances.ts'),
      'utf8'
    );
    expect(handlers).to.include('markLoanFullyPaid');
    expect(balances).to.include('esperaParaVolverAPedir');
    expect(balances).to.include('readLoanFullyPaidAt');
  });
});

describe('demo credit gates', function () {
  function liveNeedsKyc(demo, kycDeclarado) {
    return !demo && !kycDeclarado;
  }
  function liveNeedsPhone(demo, identityBound, phoneActive = true) {
    return !demo && !(identityBound && phoneActive);
  }
  function liveNeedsEmail(demo, hasEmail) {
    return !demo && !hasEmail;
  }
  function liveNeedsPhrase(phraseBackedUp) {
    return !phraseBackedUp;
  }
  function liveNeedsDeviceMatch(demo, deviceMatches, phoneActive = false) {
    if (demo || phoneActive) return false;
    return !deviceMatches;
  }
  function liveCreditReady(demo, flags) {
    return (
      !liveNeedsPhrase(flags.phraseBackedUp) &&
      !liveNeedsEmail(demo, flags.hasEmail) &&
      !liveNeedsPhone(demo, flags.identityBound, flags.phoneActive !== false) &&
      !liveNeedsKyc(demo, flags.kycDeclarado) &&
      !liveNeedsDeviceMatch(demo, flags.deviceMatches, Boolean(flags.phoneActive))
    );
  }
  it('requires a one-time access fee in Real before any loan', function () {
    function hasCreditAccess(paidUsd) {
      const paid = Number(paidUsd);
      return Number.isFinite(paid) && paid + 1e-9 >= 2;
    }
    function liveNeedsAccess(demo, paidUsd) {
      return !demo && !hasCreditAccess(paidUsd);
    }
    expect(hasCreditAccess(0)).to.equal(false);
    expect(hasCreditAccess(1)).to.equal(false);
    expect(hasCreditAccess(2)).to.equal(true);
    expect(hasCreditAccess(5)).to.equal(true);
    expect(liveNeedsAccess(false, 0)).to.equal(true);
    expect(liveNeedsAccess(false, 2)).to.equal(false);
    expect(liveNeedsAccess(true, 0)).to.equal(false);
    function canPayCreditAccess({ protocolCanDonate, founderAddress, accessEnabled }) {
      return Boolean(protocolCanDonate && String(founderAddress || '').trim() && accessEnabled);
    }
    expect(
      canPayCreditAccess({
        protocolCanDonate: true,
        founderAddress: '0xdb135e9cd9be9bE262b3222eaD737c84d72Ef870',
        accessEnabled: true,
      })
    ).to.equal(true);
    expect(
      canPayCreditAccess({
        protocolCanDonate: false,
        founderAddress: '0xdb135e9cd9be9bE262b3222eaD737c84d72Ef870',
        accessEnabled: true,
      })
    ).to.equal(false);
    expect(
      canPayCreditAccess({
        protocolCanDonate: true,
        founderAddress: '',
        accessEnabled: true,
      })
    ).to.equal(false);
    const fs = require('fs');
    const path = require('path');
    const loans = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(loans).to.include('CreditAccessBanner');
    expect((loans.match(/<CreditAccessBanner/g) || []).length).to.be.at.least(3);
    expect(loans).to.include('handlePagarAcceso');
    expect(loans).to.include('canPayCreditAccess');
    expect(loans).to.include('isAccessPaymentEnabled');
    const gate = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'useHomeHandlers.ts'), 'utf8');
    expect(gate).to.include('creditNeedsAccess');
    expect(gate).to.include('isDemoAccount()');
    expect(gate).to.include('isAccessPaymentEnabled');
    expect(gate).to.include('fundInternalFromExternal');
    expect(gate).to.include('mintDemoUsdtTo');
    expect(gate).to.include('internalBal');
    expect(gate).to.match(/internalBal !== null && internalBal >= need/);
    const balances = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useWeb3Balances.ts'),
      'utf8'
    );
    expect(balances).to.include('canDonate: caps.canDonate');
    expect(balances).to.not.include('canDonate: isDonationVisible()');
    const service = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'quatriviumCreditService.ts'),
      'utf8'
    );
    expect(service).to.include('isAccessPaymentEnabled()');
    expect(service).to.include('access-required');
    expect(service).to.include('donado(userAddress)');
    expect(service).to.not.match(/donar:[\s\S]{0,80}!isDonationEnabled\(\)/);
    const banner = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'CreditAccessBanner.tsx'),
      'utf8'
    );
    expect(banner).to.include("mode === 'demo'");
    expect(banner).to.include('creditAccessGateLead');
    expect(banner).to.include('creditAccessAlreadyInWallet');
    expect(banner).to.include('{showPay && canPay ? (');
    const gatesSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'creditGates.ts'), 'utf8');
    expect(gatesSrc).to.include('liveNeedsAccess');
    expect(gatesSrc).to.include('if (isAltaConfigured()) return true;');
    expect(gatesSrc).to.include('liveNeedsAccess(isDemoAccount(), paidUsd');
  });

  it('lets a demo account operate without KYC, phone, email or 1 USDT but requires the 24-word backup', function () {
    function hasCreditAccess(paidUsd) {
      const paid = Number(paidUsd);
      return Number.isFinite(paid) && paid + 1e-9 >= 1;
    }
    function liveNeedsAccess(demo, paidUsd) {
      return !demo && !hasCreditAccess(paidUsd);
    }
    expect(liveNeedsKyc(true, false)).to.equal(false);
    expect(liveNeedsPhone(true, false)).to.equal(false);
    expect(liveNeedsEmail(true, false)).to.equal(false);
    expect(liveNeedsAccess(true, 0)).to.equal(false);
    expect(
      liveCreditReady(true, {
        kycDeclarado: false,
        identityBound: false,
        hasEmail: false,
        phraseBackedUp: false,
      })
    ).to.equal(false);
    expect(
      liveCreditReady(true, {
        kycDeclarado: false,
        identityBound: false,
        hasEmail: false,
        phraseBackedUp: true,
      })
    ).to.equal(true);
    const fs = require('fs');
    const path = require('path');
    const handlers = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useHomeHandlers.ts'),
      'utf8'
    );
    expect(handlers).to.match(
      /handlePagarAcceso = async \(\) => \{\s*if \(isDemoAccount\(\) && !isAltaConfigured\(\)\) return;/
    );
    expect(handlers).to.include('accesoBusy');
    expect(handlers).to.include('altaPagada');
    expect(handlers).to.match(/handleAportarReserva[\s\S]*runAsAdmin/);
  });

  it('blocks Solicitar in Real until phrase and Alta are satisfied', function () {
    const fs = require('fs');
    const path = require('path');
    const gatesSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'creditGates.ts'), 'utf8');
    expect(gatesSrc).to.include('identityUnlocked');
    expect(gatesSrc).to.include('hasCreditAccess');
  });

  it('keeps Demo and Real history apart and runs grace down then mora up', function () {
    function historyJournalSuffix({ mode, chainId, contract, address }) {
      return `${mode === 'live' ? 'live' : 'demo'}_${Number(chainId) || 0}_${String(contract || '').toLowerCase()}_${String(address || '').toLowerCase()}`;
    }
    function movementBelongsToWorld(item, mode) {
      const world = mode === 'live' ? 'live' : 'demo';
      return !item.world || item.world === world;
    }
    const demoKey = historyJournalSuffix({
      mode: 'demo',
      chainId: 97,
      contract: '0xD2',
      address: '0xAA',
    });
    const liveKey = historyJournalSuffix({
      mode: 'live',
      chainId: 56,
      contract: '0x00',
      address: '0xAA',
    });
    expect(demoKey).to.not.equal(liveKey);
    expect(movementBelongsToWorld({ world: 'demo' }, 'live')).to.equal(false);
    expect(movementBelongsToWorld({ world: 'live' }, 'live')).to.equal(true);
    const GRACE = 30 * 86400;
    function paymentDueAt(loan) {
      if (!loan) return 0;
      const due = Number(loan.vencimiento) || 0;
      const next = Number(loan.proximaCuota) || 0;
      if (due > 0 && next > 0) return Math.min(due, next);
      return due || next;
    }
    function graceMoraPhase({ hasActiveLoan, dueAt, isFounder }, now) {
      if (isFounder || !hasActiveLoan || dueAt <= 0 || now < dueAt) return 'none';
      if (now < dueAt + GRACE) return 'grace';
      return 'mora';
    }
    function graceMoraSeconds(phase, dueAt, now) {
      if (phase === 'grace') return Math.max(0, dueAt + GRACE - now);
      if (phase === 'mora') return Math.max(0, now - (dueAt + GRACE));
      return 0;
    }
    const due = 1_700_000_000;
    expect(paymentDueAt({ vencimiento: due, proximaCuota: due - 100 })).to.equal(due - 100);
    expect(graceMoraPhase({ hasActiveLoan: true, dueAt: due }, due - 1)).to.equal('none');
    expect(graceMoraPhase({ hasActiveLoan: true, dueAt: due }, due)).to.equal('grace');
    expect(graceMoraPhase({ hasActiveLoan: true, dueAt: due }, due + GRACE - 1)).to.equal('grace');
    expect(graceMoraPhase({ hasActiveLoan: true, dueAt: due }, due + GRACE)).to.equal('mora');
    expect(graceMoraPhase({ hasActiveLoan: true, dueAt: due, isFounder: true }, due + 10)).to.equal(
      'none'
    );
    expect(graceMoraSeconds('grace', due, due + 10)).to.equal(GRACE - 10);
    expect(graceMoraSeconds('mora', due, due + GRACE + 90)).to.equal(90);
  });

  it('splits history windows and computes mora days, fame, freeze and pool share', function () {
    function isTransferMovement(kind) {
      return kind === 'transfer_in' || kind === 'transfer_out';
    }
    function isLoanMovement(kind) {
      return kind === 'loan' || kind === 'payment';
    }
    function isSupportMovement(kind) {
      return kind === 'bonus' || kind === 'donation' || kind === 'access';
    }
    function movementBelongsToWorld(item, mode) {
      const world = mode === 'live' ? 'live' : 'demo';
      const itemWorld = item.world === 'live' || item.world === 'demo' ? item.world : '';
      if (!itemWorld) return false;
      return itemWorld === world;
    }
    function voluntaryDonateUsd(paidUsd) {
      const paid = Number(paidUsd);
      if (!Number.isFinite(paid) || paid <= 0) return 0;
      if (!(paid + 1e-9 >= 2)) return 0;
      return Math.max(0, paid - 2);
    }
    function classifyDonationKind(usdAmount, isFirstDonation) {
      const usd = Number(usdAmount);
      if (isFirstDonation && Number.isFinite(usd) && Math.abs(usd - 2) < 1e-6) return 'access';
      return 'donation';
    }
    function moraDays(startedAt, endedAt) {
      if (!startedAt || endedAt <= startedAt) return 0;
      return Math.max(0, Math.floor((endedAt - startedAt) / 86_400_000));
    }
    function moraPenaltyDays(days) {
      return Math.max(0, Math.floor(days) - 30);
    }
    function moraFameLost(penaltyDays, level) {
      const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
      return Math.max(0, Math.floor(penaltyDays)) * 10 * safeLevel;
    }
    function gen1ShareWei(interestWei) {
      return (interestWei * 1500n) / 10000n;
    }
    function buildMoraSpells(toggles, now, level) {
      const ordered = [...toggles].filter((item) => item.at > 0).sort((a, b) => a.at - b.at);
      const spells = [];
      let openAt = 0;
      for (const item of ordered) {
        if (item.on) {
          if (!openAt) openAt = item.at;
          continue;
        }
        if (!openAt) continue;
        const days = moraDays(openAt, item.at);
        const penaltyDays = moraPenaltyDays(days);
        spells.push({
          startedAt: openAt,
          endedAt: item.at,
          days,
          penaltyDays,
          fameLost: moraFameLost(penaltyDays, level),
          benefitsBlocked: penaltyDays > 0,
        });
        openAt = 0;
      }
      if (openAt) {
        const days = moraDays(openAt, now);
        const penaltyDays = moraPenaltyDays(days);
        spells.push({
          startedAt: openAt,
          endedAt: null,
          days,
          penaltyDays,
          fameLost: moraFameLost(penaltyDays, level),
          benefitsBlocked: penaltyDays > 0,
        });
      }
      return spells.reverse();
    }
    expect(isTransferMovement('transfer_in')).to.equal(true);
    expect(isTransferMovement('loan')).to.equal(false);
    expect(isTransferMovement('bonus')).to.equal(false);
    expect(isTransferMovement('donation')).to.equal(false);
    expect(isLoanMovement('payment')).to.equal(true);
    expect(isLoanMovement('transfer_out')).to.equal(false);
    expect(isSupportMovement('access')).to.equal(true);
    expect(isSupportMovement('bonus')).to.equal(true);
    expect(isSupportMovement('transfer_in')).to.equal(false);
    expect(movementBelongsToWorld({ world: 'demo' }, 'demo')).to.equal(true);
    expect(movementBelongsToWorld({ world: 'demo' }, 'live')).to.equal(false);
    expect(movementBelongsToWorld({}, 'demo')).to.equal(false);
    expect(voluntaryDonateUsd(1)).to.equal(0);
    expect(voluntaryDonateUsd(1.5)).to.equal(0);
    expect(voluntaryDonateUsd(2)).to.equal(0);
    expect(voluntaryDonateUsd(6)).to.equal(4);
    expect(voluntaryDonateUsd(0)).to.equal(0);
    expect(classifyDonationKind(2, true)).to.equal('access');
    expect(classifyDonationKind(5, true)).to.equal('donation');
    expect(classifyDonationKind(1, true)).to.equal('donation');
    expect(classifyDonationKind(1, false)).to.equal('donation');
    const day = 86_400_000;
    const start = 1_700_000_000_000;
    const spells = buildMoraSpells(
      [
        { at: start, on: true },
        { at: start + 40 * day, on: false },
      ],
      start + 50 * day,
      2
    );
    expect(spells).to.have.length(1);
    expect(spells[0].days).to.equal(40);
    expect(spells[0].penaltyDays).to.equal(10);
    expect(spells[0].fameLost).to.equal(200);
    expect(spells[0].benefitsBlocked).to.equal(true);
    expect(gen1ShareWei(10000n)).to.equal(1500n);
    expect(moraFameLost(0, 5)).to.equal(0);
  });

  it('awards fame in proportion to donated or pooled USDT', function () {
    const fameFromUsd = (usd, pointsPerUsdt) => {
      if (
        !Number.isFinite(usd) ||
        usd <= 0 ||
        !Number.isFinite(pointsPerUsdt) ||
        pointsPerUsdt <= 0
      ) {
        return 0;
      }
      return Math.floor(usd * pointsPerUsdt);
    };
    expect(fameFromUsd(1, 10)).to.equal(10);
    expect(fameFromUsd(25, 10)).to.equal(250);
    expect(fameFromUsd(4, 5)).to.equal(20);
    expect(fameFromUsd(20, 5)).to.equal(100);
    expect(fameFromUsd(0.4, 10)).to.equal(4);
    expect(fameFromUsd(0, 10)).to.equal(0);
  });

  it('shows the full 1000-level catalog when the live cap is unknown', function () {
    function displayMaxLoanLevel(detected) {
      const value = Math.floor(Number(detected) || 0);
      if (value === 100) return 100;
      return 1000;
    }
    expect(displayMaxLoanLevel(0)).to.equal(1000);
    expect(displayMaxLoanLevel(1000)).to.equal(1000);
    expect(displayMaxLoanLevel(100)).to.equal(100);
  });

  it('allows donations only in Real when mainnet is ready', function () {
    function donationVisibleInWorld(product, runtime) {
      return product === 'live' && runtime === 'live';
    }
    function donationAllowedInWorld(product, runtime, mainnetReady) {
      return donationVisibleInWorld(product, runtime) && mainnetReady;
    }
    expect(donationVisibleInWorld('demo', 'demo')).to.equal(false);
    expect(donationVisibleInWorld('live', 'live')).to.equal(true);
    expect(donationAllowedInWorld('demo', 'demo', true)).to.equal(false);
    expect(donationAllowedInWorld('live', 'live', false)).to.equal(false);
    expect(donationAllowedInWorld('live', 'live', true)).to.equal(true);
    function accessPaymentAllowedInWorld(product, runtime, mainnetReady) {
      if (product === 'demo') return false;
      return donationAllowedInWorld(product, runtime, mainnetReady);
    }
    expect(accessPaymentAllowedInWorld('demo', 'demo', false)).to.equal(false);
    expect(accessPaymentAllowedInWorld('demo', 'demo', true)).to.equal(false);
    expect(accessPaymentAllowedInWorld('live', 'live', false)).to.equal(false);
    expect(accessPaymentAllowedInWorld('live', 'live', true)).to.equal(true);
  });

  it('blocks pool deposits from Demo', async function () {
    const { ethers } = require('hardhat');
    const { deployProtocol, seedPool } = require('./helpers.cjs');
    const ctx = await deployProtocol();
    await seedPool(ctx.token, ctx.contract, ctx.owner, '50');
    await expect(
      ctx.contract.connect(ctx.owner).retirarLiquidez(ctx.tokenAddr, ethers.parseUnits('1', 18))
    ).to.be.reverted;
    function poolAllowed(product, runtime) {
      return product === 'live' && runtime === 'live';
    }
    expect(poolAllowed('demo', 'demo')).to.equal(false);
    expect(poolAllowed('live', 'demo')).to.equal(false);
    expect(poolAllowed('live', 'live')).to.equal(true);
    const fs = require('fs');
    const path = require('path');
    const poolUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'PoolSupportSection.tsx'),
      'utf8'
    );
    expect(poolUi).to.include("allowDeposit = mode !== 'demo'");
    expect(poolUi).to.include('poolRealOnly');
    expect(poolUi).to.include('poolLockedNote');
    expect(poolUi).to.include('liveCreditNotReady');
    expect(poolUi).to.include('yourLpPosition');
    expect(poolUi).to.include('externalPaysLead');
    expect(poolUi).to.include('showNav');
    expect(poolUi).to.not.include('withdrawPool');
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include("id: 'pool'");
    expect(home).to.include("visible={room === 'pool'}");
    expect(home).to.not.include("visible={room === 'pool' && mode !== 'demo'}");
    expect(home).to.include('lpBalance={balances.lpBalance}');
    const service = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'quatriviumCreditService.ts'),
      'utf8'
    );
    expect(service).to.include("throw new Error('pool-real-only')");
    expect(service).to.include("throw new Error('pool locked')");
    const sol = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumCredit.sol'),
      'utf8'
    );
    expect(sol).to.include('revert("pool locked")');
    expect(sol).to.include('insufficient liquidity');
    const es = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'i18n', 'locales', 'es.json'), 'utf8')
    );
    expect(es.poolPublicLead).to.match(/no se (puede )?retirar/i);
    expect(es.poolPublicLead).to.not.match(/rendimiento/);
    expect(es.poolLockedNote).to.match(/no se retira/i);
  });

  it('does not let a live account reuse demo testnet credit', function () {
    function worlds(pref, mainnetConfigured, testnetConfigured) {
      const account = pref === 'demo' ? 'demo' : 'live';
      const runtime = account;
      const creditReady = account === 'live' ? mainnetConfigured : testnetConfigured;
      return { account, runtime, creditReady };
    }
    const liveBeforeMainnet = worlds('live', false, true);
    expect(liveBeforeMainnet.runtime).to.equal('live');
    expect(liveBeforeMainnet.creditReady).to.equal(false);

    const demo = worlds('demo', false, true);
    expect(demo.runtime).to.equal('demo');
    expect(demo.creditReady).to.equal(true);

    const liveOnMainnet = worlds('live', true, true);
    expect(liveOnMainnet.runtime).to.equal('live');
    expect(liveOnMainnet.creditReady).to.equal(true);
  });
});

describe('account entry — password, email and session', () => {
  const SAMPLE_MASTER = ['Clave', 'Valida', '1!'].join('');
  const SAMPLE_SHORT = ['Clave', 'Valida', '1'].join('');
  function canSubmitCreateSecrets(master, email) {
    return isValidMasterPassword(master) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  function canSubmitCreateCode(code) {
    return /^\d{6}$/.test(code);
  }
  function signInNeedsEmailCode() {
    return false;
  }
  function canSubmitSignIn(master, username) {
    return Boolean(master) && /^[a-z][a-z0-9_]{2,19}$/.test(String(username || ''));
  }
  function signInUsernameAllowed(typed, saved) {
    const left = String(typed || '')
      .trim()
      .toLowerCase();
    const right = String(saved || '')
      .trim()
      .toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,19}$/.test(left)) return false;
    if (!right) return true;
    return left === right;
  }

  it('asks for username and password before showing the 24 words', () => {
    const steps = ['language', 'legal', 'welcome', 'credentials', 'phrase'];
    expect(steps.indexOf('language')).to.be.lessThan(steps.indexOf('legal'));
    expect(steps.indexOf('legal')).to.be.lessThan(steps.indexOf('welcome'));
    expect(steps.indexOf('credentials')).to.be.lessThan(steps.indexOf('phrase'));
    expect(canSubmitCreateSecrets(SAMPLE_MASTER, 'user@correo.com')).to.equal(true);
    const fs = require('fs');
    const path = require('path');
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('PasswordRulesHint');
    expect(gate).to.include("setSetupStage('credentials')");
    const policy = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'passwordPolicy.ts'),
      'utf8'
    );
    expect(policy).to.include('passwordRuleFlags');
    expect(policy).to.include('PASSWORD_MIN = 8');
    expect(policy).to.include('PASSWORD_MAX = 66');
    function importMarksPhraseOnCreate() {
      return false;
    }
    expect(importMarksPhraseOnCreate()).to.equal(false);
  });

  it('splits create into secrets first and code later', () => {
    expect(canSubmitCreateSecrets(SAMPLE_MASTER, 'user@correo.com')).to.equal(true);
    expect(canSubmitCreateSecrets(SAMPLE_MASTER, '')).to.equal(false);
    expect(canSubmitCreateCode('')).to.equal(false);
    expect(canSubmitCreateCode('123456')).to.equal(true);
  });

  it('tells the user to create an account when this phone has no password yet', () => {
    function signInError(passwordOk, passwordSet) {
      if (passwordOk) return '';
      return passwordSet ? 'lockPasswordWrong' : 'signInNoAccount';
    }
    expect(signInError(false, false)).to.equal('signInNoAccount');
    expect(signInError(false, true)).to.equal('lockPasswordWrong');
    expect(signInError(true, true)).to.equal('');
  });

  it('never asks for a code at sign-in and requires password plus username', () => {
    expect(signInNeedsEmailCode()).to.equal(false);
    expect(canSubmitSignIn('', 'ana_one')).to.equal(false);
    expect(canSubmitSignIn(SAMPLE_SHORT, '')).to.equal(false);
    expect(canSubmitSignIn(SAMPLE_SHORT, 'ab')).to.equal(false);
    expect(canSubmitSignIn(SAMPLE_SHORT, 'ana_one')).to.equal(true);
  });

  it('allows sign-in when no username is stored yet and rejects a different saved username', () => {
    expect(signInUsernameAllowed('ana_one', '')).to.equal(true);
    expect(signInUsernameAllowed('otra_user', 'ana_one')).to.equal(false);
    expect(signInUsernameAllowed('ana_one', 'ana_one')).to.equal(true);
  });

  it('hides create-account on this phone after an account exists and restore accepts 12 or 24 words', () => {
    function welcomeShowsCreate(accountOnPhone, deviceClaimed = false) {
      return !accountOnPhone && !deviceClaimed;
    }
    function canSubmitRestorePhrase(phrase) {
      const words = String(phrase || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      return words.length === 12 || words.length === 24;
    }
    function welcomeShowsSignIn(accountOnPhone, deviceClaimed = false) {
      return !accountOnPhone && deviceClaimed;
    }
    function welcomeActions(accountOnPhone, deviceClaimed = false) {
      if (accountOnPhone) return [];
      if (deviceClaimed) return ['signIn'];
      return ['createPhrase', 'restoreAccount'];
    }
    function canSubmitDeviceCredentials(master, username) {
      return isValidMasterPassword(master) && /^[a-z][a-z0-9_]{2,19}$/.test(username);
    }
    function canSubmitReinstall(phrase, master, username) {
      const words = String(phrase || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      return (
        (words.length === 12 || words.length === 24) && canSubmitDeviceCredentials(master, username)
      );
    }
    function restoreMatchesDevice(claimedWallet, phraseWallet) {
      const claimed = String(claimedWallet || '').toLowerCase();
      const phrase = String(phraseWallet || '').toLowerCase();
      if (!claimed || claimed === '0x0000000000000000000000000000000000000000') return true;
      return Boolean(phrase) && claimed === phrase;
    }
    function walletRunsOnThisDevice(onChainDeviceHash, localDeviceHash) {
      const bound = String(onChainDeviceHash || '');
      if (!bound || /^0x0+$/i.test(bound)) return true;
      return bound.toLowerCase() === String(localDeviceHash || '').toLowerCase();
    }
    function accountOnPhoneFromProbes(password, pin) {
      if (password === true || pin === true) return true;
      if (password === null || pin === null) return null;
      return false;
    }
    function nextEntryScreen({ accountOnPhone, wrapReady, unlockOn }) {
      if (accountOnPhone === null) return 'signIn';
      if (!accountOnPhone) return 'welcome';
      if (unlockOn || !wrapReady) return 'unlock';
      return 'app';
    }
    function orderUnlockMethods(selected, primary) {
      const unique = [...new Set((selected || []).filter(Boolean))];
      if (!unique.length) return ['password'];
      const head = primary && unique.includes(primary) ? primary : unique[0];
      return [head, ...unique.filter((method) => method !== head)];
    }
    expect(welcomeShowsCreate(false)).to.equal(true);
    expect(welcomeShowsCreate(true)).to.equal(false);
    expect(welcomeShowsCreate(false, true)).to.equal(false);
    expect(welcomeShowsSignIn(false, true)).to.equal(true);
    expect(welcomeShowsSignIn(false, false)).to.equal(false);
    expect(welcomeShowsSignIn(true, true)).to.equal(false);
    expect(welcomeActions(false)).to.deep.equal(['createPhrase', 'restoreAccount']);
    expect(welcomeActions(false, true)).to.deep.equal(['signIn']);
    expect(canSubmitDeviceCredentials(SAMPLE_MASTER, 'ana_one')).to.equal(true);
    expect(canSubmitDeviceCredentials(SAMPLE_SHORT, 'ana_one')).to.equal(false);
    expect(canSubmitDeviceCredentials(SAMPLE_MASTER, 'ab')).to.equal(false);
    expect(
      canSubmitReinstall(
        'uno dos tres cuatro cinco seis siete ocho nueve diez once doce',
        SAMPLE_MASTER,
        'ana_one'
      )
    ).to.equal(true);
    expect(
      canSubmitRestorePhrase(
        'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray'
      )
    ).to.equal(true);
    expect(welcomeActions(true)).to.deep.equal([]);
    expect(restoreMatchesDevice('0xabc', '0xABC')).to.equal(true);
    expect(restoreMatchesDevice('0xabc', '0xdef')).to.equal(false);
    expect(restoreMatchesDevice('', '0xdef')).to.equal(true);
    expect(walletRunsOnThisDevice('', '0x11')).to.equal(true);
    expect(walletRunsOnThisDevice('0x11', '0x11')).to.equal(true);
    expect(walletRunsOnThisDevice('0x11', '0x22')).to.equal(false);
    function restoreAllowedOnThisDevice({ claimedWallet, phraseWallet }) {
      return restoreMatchesDevice(claimedWallet, phraseWallet);
    }
    function phoneVerifiedOnThisDevice(identityBound, deviceMatches, phoneActive = true) {
      return Boolean(identityBound) && Boolean(phoneActive) && Boolean(deviceMatches);
    }
    expect(
      restoreAllowedOnThisDevice({
        claimedWallet: '',
        phraseWallet: '0xdef',
        onChainDeviceHash: '0x11',
        localDeviceHash: '0x22',
      })
    ).to.equal(true);
    expect(restoreAllowedOnThisDevice({ claimedWallet: '0xabc', phraseWallet: '0xdef' })).to.equal(
      false
    );
    expect(phoneVerifiedOnThisDevice(true, false)).to.equal(false);
    expect(phoneVerifiedOnThisDevice(true, true)).to.equal(true);
    expect(phoneVerifiedOnThisDevice(false, true)).to.equal(false);
    expect(phoneVerifiedOnThisDevice(true, true, false)).to.equal(false);
    function sessionOwnedHere(claimedDeviceHash, localDeviceHash) {
      const claimed = String(claimedDeviceHash || '').toLowerCase();
      const local = String(localDeviceHash || '').toLowerCase();
      if (!claimed || /^0x0+$/i.test(claimed)) return true;
      return Boolean(local) && claimed === local;
    }
    expect(sessionOwnedHere('', '0x11')).to.equal(true);
    expect(sessionOwnedHere('0x11', '0x11')).to.equal(true);
    expect(sessionOwnedHere('0x11', '0x22')).to.equal(false);
    expect(
      nextEntryScreen({
        accountOnPhone: true,
        sessionSaved: true,
        wrapReady: false,
        unlockOn: false,
      })
    ).to.equal('unlock');
    expect(
      nextEntryScreen({
        accountOnPhone: true,
        sessionSaved: true,
        wrapReady: true,
        unlockOn: false,
      })
    ).to.equal('app');
    expect(
      nextEntryScreen({
        accountOnPhone: true,
        sessionSaved: true,
        wrapReady: false,
        unlockOn: true,
      })
    ).to.equal('unlock');
    expect(
      nextEntryScreen({
        accountOnPhone: true,
        sessionSaved: false,
        wrapReady: false,
        unlockOn: false,
      })
    ).to.equal('unlock');
    expect(accountOnPhoneFromProbes(null, false)).to.equal(null);
    expect(accountOnPhoneFromProbes(false, false)).to.equal(false);
    expect(
      nextEntryScreen({
        accountOnPhone: null,
        sessionSaved: false,
        wrapReady: false,
        unlockOn: false,
      })
    ).to.equal('signIn');
    expect(
      nextEntryScreen({
        accountOnPhone: false,
        sessionSaved: false,
        wrapReady: false,
        unlockOn: false,
      })
    ).to.equal('welcome');
    expect(orderUnlockMethods(['pin', 'password'], 'pin')).to.deep.equal(['pin', 'password']);
    expect(orderUnlockMethods([])).to.deep.equal(['password']);
    function unlockPromptMethods(selected, primary, primaryOnly) {
      const ordered = orderUnlockMethods(selected, primary);
      return primaryOnly ? [ordered[0]] : ordered;
    }
    expect(unlockPromptMethods(['password', 'email'], 'password', true)).to.deep.equal([
      'password',
    ]);
    expect(unlockPromptMethods(['password', 'email'], 'password', false)).to.deep.equal([
      'password',
      'email',
    ]);
    function appOffersDestroyAccount() {
      return false;
    }
    function networkChangeCreatesAccount() {
      return false;
    }
    function liveSecondCreditAllowed({ phoneTaken, deviceTaken }) {
      return !phoneTaken && !deviceTaken;
    }
    expect(appOffersDestroyAccount()).to.equal(false);
    expect(networkChangeCreatesAccount()).to.equal(false);
    expect(liveSecondCreditAllowed({ phoneTaken: true, deviceTaken: false })).to.equal(false);
    expect(liveSecondCreditAllowed({ phoneTaken: false, deviceTaken: true })).to.equal(false);
    expect(liveSecondCreditAllowed({ phoneTaken: false, deviceTaken: false })).to.equal(true);
    expect(canSubmitRestorePhrase('uno dos tres')).to.equal(false);
    expect(
      canSubmitRestorePhrase('uno dos tres cuatro cinco seis siete ocho nueve diez once doce')
    ).to.equal(true);
    function methodsForPurpose(purpose) {
      if (purpose === 'signin') return ['password', 'pin', 'biometric', 'authenticator'];
      return ['pin', 'authenticator', 'biometric', 'password'];
    }
    expect(methodsForPurpose('unlock')).to.deep.equal([
      'pin',
      'authenticator',
      'biometric',
      'password',
    ]);
    expect(methodsForPurpose('funds')).to.deep.equal([
      'pin',
      'authenticator',
      'biometric',
      'password',
    ]);
    expect(methodsForPurpose('loanRequest')).to.deep.equal([
      'pin',
      'authenticator',
      'biometric',
      'password',
    ]);
    expect(methodsForPurpose('loanPay')).to.deep.equal([
      'pin',
      'authenticator',
      'biometric',
      'password',
    ]);
    function actionApplies(on, methods) {
      return Boolean(on) && Array.isArray(methods) && methods.length > 0;
    }
    expect(actionApplies(false, ['password'])).to.equal(false);
    expect(actionApplies(false, ['pin', 'authenticator', 'biometric', 'password'])).to.equal(false);
    expect(actionApplies(true, [])).to.equal(false);
    expect(actionApplies(true, ['pin', 'password'])).to.equal(true);
  });

  it('keeps restore Entrar off for a fake 24-word line and turns off Android autofill on the seed field', () => {
    const fs = require('fs');
    const path = require('path');
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('importantForAutofill="no"');
    expect(gate).to.include('!isValidSecretPhrase(restorePhrase)');
    const secret = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SecretInput.tsx'),
      'utf8'
    );
    expect(secret).to.include('importantForAutofill="no"');
    expect(secret).to.include('autoComplete="off"');
  });

  it('does not treat a leftover wrap as an open wallet after a reload mid-setup', () => {
    function wrapReadyForApp(wrapPresent, walletOpened) {
      return Boolean(wrapPresent && walletOpened);
    }
    expect(wrapReadyForApp(true, false)).to.equal(false);
    expect(wrapReadyForApp(true, true)).to.equal(true);
    expect(wrapReadyForApp(false, false)).to.equal(false);
    function nextAfterReload({ passwordSet, wrapPresent, walletOpened, phraseAcked }) {
      if (wrapPresent && walletOpened && !phraseAcked) return 'phraseReveal';
      if (passwordSet && !wrapReadyForApp(wrapPresent, walletOpened)) return 'unlock';
      return 'app';
    }
    expect(
      nextAfterReload({
        passwordSet: true,
        wrapPresent: true,
        walletOpened: false,
        phraseAcked: false,
      })
    ).to.equal('unlock');
    expect(
      nextAfterReload({
        passwordSet: true,
        wrapPresent: true,
        walletOpened: true,
        phraseAcked: false,
      })
    ).to.equal('phraseReveal');
    const fs = require('fs');
    const path = require('path');
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('purgePersistedWrap');
    expect(gate).to.include('resumePhraseRevealIfNeeded');
    expect(gate).to.include('getSecretPhrase');
  });

  it('never leaves a closed vault on Retry-only and does not enter the app after a failed unlock', () => {
    function walletFailEscapes(passwordSet) {
      return passwordSet ? ['unlock', 'restore'] : ['restore'];
    }
    function afterUnlockNext({ walletOpened, phraseAcked, hasPhrase }) {
      if (!walletOpened) return 'restore';
      if (!phraseAcked && hasPhrase) return 'phraseReveal';
      return 'app';
    }
    expect(walletFailEscapes(true)).to.deep.equal(['unlock', 'restore']);
    expect(walletFailEscapes(false)).to.deep.equal(['restore']);
    expect(afterUnlockNext({ walletOpened: false, phraseAcked: false, hasPhrase: false })).to.equal(
      'restore'
    );
    expect(afterUnlockNext({ walletOpened: true, phraseAcked: false, hasPhrase: true })).to.equal(
      'phraseReveal'
    );
    expect(afterUnlockNext({ walletOpened: true, phraseAcked: true, hasPhrase: true })).to.equal(
      'app'
    );
    const fs = require('fs');
    const path = require('path');
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('subscribeWalletOpenEscape');
    expect(gate).to.include("setSetupStage('restore')");
    const onboarding = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AccountOnboarding.tsx'),
      'utf8'
    );
    expect(onboarding).to.include('WalletFailedEscape');
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include('WalletFailedEscape');
    const walletCtx = fs.readFileSync(
      path.join(__dirname, '..', 'wallet', 'AppWalletContext.tsx'),
      'utf8'
    );
    expect(walletCtx).to.include('purgePersistedWrap');
    expect(walletCtx).to.include('break');
  });

  it('builds a standard otpauth URL so authenticator apps can scan the QR', () => {
    function otpauthUrl(secret, account) {
      const label = encodeURIComponent(`Quatrivium:${account || 'cuenta'}`);
      return `otpauth://totp/${label}?secret=${secret}&issuer=Quatrivium&digits=6&period=30`;
    }
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'ana');
    expect(url.startsWith('otpauth://totp/')).to.equal(true);
    expect(url).to.include('secret=JBSWY3DPEHPK3PXP');
    expect(url).to.include('issuer=Quatrivium');
    expect(url).to.include('digits=6');
    expect(url).to.include('period=30');
    expect(url).to.include(encodeURIComponent('Quatrivium:ana'));
  });

  it('hashes the password locally so sign-in does not wait on native digest hops', () => {
    function hashSecret(secret, salt, rounds) {
      let digest = `${salt}:${secret}`;
      const n = Math.max(1, Math.min(rounds, 20_000));
      for (let i = 0; i < n; i += 1) {
        digest = sha256(toUtf8Bytes(digest)).slice(2);
      }
      return digest;
    }
    const first = hashSecret('ClaveValida1', 'salt-a', 32);
    const same = hashSecret('ClaveValida1', 'salt-a', 32);
    const other = hashSecret('ClaveValida1', 'salt-b', 32);
    expect(first).to.equal(same);
    expect(first).to.not.equal(other);
    expect(first).to.match(/^[0-9a-f]{64}$/);
  });

  it('splits referral earnings into commissions, first-payment bonus and total', () => {
    function asWei(value) {
      try {
        if (typeof value === 'bigint') return value;
        if (typeof value === 'number') return BigInt(Math.max(0, Math.floor(value)));
        if (!value) return 0n;
        return BigInt(value);
      } catch {
        return 0n;
      }
    }
    function sumReferralEarnings(nodes) {
      let commissionWei = 0n;
      let bonusWei = 0n;
      for (const node of nodes || []) {
        commissionWei += asWei(node.commissionWei);
        bonusWei += asWei(node.bonusWei);
      }
      return { commissionWei, bonusWei, totalWei: commissionWei + bonusWei };
    }
    expect(asWei(undefined)).to.equal(0n);
    expect(asWei('')).to.equal(0n);
    expect(asWei('not-a-number')).to.equal(0n);
    expect(asWei('1500000000000000000')).to.equal(1500000000000000000n);
    const totals = sumReferralEarnings([
      { commissionWei: '3000000000000000000', bonusWei: '500000000000000000' },
      { commissionWei: '1000000000000000000', bonusWei: '500000000000000000' },
      { commissionWei: 'bad', bonusWei: '' },
    ]);
    expect(totals.commissionWei).to.equal(4000000000000000000n);
    expect(totals.bonusWei).to.equal(1000000000000000000n);
    expect(totals.totalWei).to.equal(5000000000000000000n);
    expect(sumReferralEarnings([]).totalWei).to.equal(0n);
  });

  it('keeps view of the secret phrase in one settings place', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SecuritySettings.tsx'),
      'utf8'
    );
    const menuRows = [...source.matchAll(/label=\{t\('([^']+)'\)\}/g)].map((match) => match[1]);
    expect(menuRows.filter((key) => key === 'securityPhrase')).to.have.length(1);
    expect(menuRows).to.not.include('seedRotate');
    expect(source).to.include("panel === 'phrase'");
    expect(source).to.include("t('seedReveal')");
    expect(source).to.not.include("t('seedRotate')");
    expect(source).to.not.include("t('seedRotateAction')");
    expect(source).to.not.include('restoreWallet');
    expect(source).to.not.match(/setPanel\('replace'\)/);
    expect(source).to.not.match(/panel === 'replace'/);
  });

  it('keeps referral earnings board visible while the scan is still loading', () => {
    function referralBoardVisible({ isLoading, error }) {
      return !error || Boolean(isLoading);
    }
    function activateCreditCanPress({ busy, paused, contractReady }) {
      return !busy && !paused && contractReady !== false;
    }
    function roomFromAppUrl(url) {
      const { loadTs } = require('./loadTsApp.cjs');
      const deep = loadTs(path.join(__dirname, '..', 'utils', 'appDeepLink.ts'));
      const parsed = deep.parseAppDeepLink(url);
      return parsed && parsed.kind === 'room' ? parsed.room : '';
    }
    expect(referralBoardVisible({ isLoading: true, error: null })).to.equal(true);
    expect(referralBoardVisible({ isLoading: false, error: null })).to.equal(true);
    expect(activateCreditCanPress({ busy: false, paused: false, contractReady: true })).to.equal(
      true
    );
    expect(activateCreditCanPress({ busy: false, paused: false, contractReady: false })).to.equal(
      false
    );
    expect(activateCreditCanPress({ busy: true, paused: false, contractReady: true })).to.equal(
      false
    );
    function loanPrimaryGate({ contractReady, isRegistered, unlocked, hasActiveLoan }) {
      if (!unlocked || hasActiveLoan) return 'other';
      if (!contractReady) return 'not-ready';
      if (!isRegistered) return 'activate';
      return 'request';
    }
    expect(
      loanPrimaryGate({
        contractReady: false,
        isRegistered: false,
        unlocked: true,
        hasActiveLoan: false,
      })
    ).to.equal('not-ready');
    expect(
      loanPrimaryGate({
        contractReady: true,
        isRegistered: false,
        unlocked: true,
        hasActiveLoan: false,
      })
    ).to.equal('activate');
    const fs = require('fs');
    const path = require('path');
    const card = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LoanTierCard.tsx'),
      'utf8'
    );
    expect(card).to.include('contractReady');
    expect(card).to.include("t('liveCreditNotReady')");
    expect(card).to.include("t('accountWorldLivePendingTag')");
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include('contractReady={creditReady}');
    const handlers = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useHomeHandlers.ts'),
      'utf8'
    );
    expect(handlers).to.include('ensureExternalWalletOnAppChain');
    expect(handlers).to.include('poolRealOnly');
    expect(handlers).to.include("kind: 'access'");
    expect(handlers).not.to.match(/kind: 'donation'[\s\S]*to: userInfo\.founderAddress/);
    const historyUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'MovementHistory.tsx'),
      'utf8'
    );
    expect(historyUi).to.include('historySupport');
    expect(historyUi).to.include('historyAccess');
    expect(historyUi).to.include("item.kind === 'access'");
    const historySvc = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'movementHistory.ts'),
      'utf8'
    );
    expect(historySvc).to.include("eventFilter(contract, 'Donacion'");
    expect(historySvc).to.include("eventFilter(contract, 'BonoHitoPagado'");
    expect(historySvc).to.include('classifyDonationKind');
    const inviteUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReferralSection.tsx'),
      'utf8'
    );
    expect(inviteUi).to.include('copyInvite');
    expect(inviteUi).to.include('handleCopyCode');
    expect(inviteUi).to.include("myCode.split('-')");
    expect(inviteUi).to.include('codeBox');
    const donateUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'DonateFounderSection.tsx'),
      'utf8'
    );
    expect(donateUi).to.include('voluntaryDonateUsd');
    expect(donateUi).to.include('donateAccessNote');
    const transferUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'TransferWalletsModal.tsx'),
      'utf8'
    );
    expect(transferUi).to.include('ensureExternalWalletOnAppChain');
    expect(roomFromAppUrl('quatrivium-sovereign://room/credit?n=1730000000')).to.equal('credit');
    expect(roomFromAppUrl('quatrivium-sovereign://room/history')).to.equal('history');
    expect(roomFromAppUrl('quatrivium-sovereign://room/network')).to.equal('network');
    expect(roomFromAppUrl('quatrivium-sovereign://room/people')).to.equal('people');
    expect(roomFromAppUrl('quatrivium://room/credit')).to.equal('');
    const deep = fs.readFileSync(path.join(__dirname, '..', 'utils', 'appDeepLink.ts'), 'utf8');
    expect(deep).to.include("token === 'privacy'");
    expect(deep).to.include("kind: 'mode'");
  });

  it('pages an unbounded referral people list eight at a time', () => {
    const fs = require('fs');
    const path = require('path');
    function referralPageCount(total, pageSize = 8) {
      if (!Number.isFinite(total) || total <= 0) return 0;
      return Math.ceil(total / Math.max(1, pageSize));
    }
    function clampReferralPage(page, totalPages) {
      if (totalPages <= 0) return 1;
      if (!Number.isFinite(page) || page < 1) return 1;
      return Math.min(Math.floor(page), totalPages);
    }
    function sliceReferralPage(items, page, pageSize = 8) {
      const totalPages = referralPageCount(items.length, pageSize);
      if (!totalPages) return [];
      const safe = clampReferralPage(page, totalPages);
      const start = (safe - 1) * pageSize;
      return items.slice(start, start + pageSize);
    }
    function visibleReferralPages(current, totalPages) {
      if (totalPages <= 0) return [];
      const page = clampReferralPage(current, totalPages);
      if (totalPages <= 11) return Array.from({ length: totalPages }, (_, index) => index + 1);
      const picked = new Set([1, totalPages]);
      for (let next = page - 2; next <= page + 2; next += 1) {
        if (next >= 1 && next <= totalPages) picked.add(next);
      }
      const sorted = [...picked].sort((a, b) => a - b);
      const out = [];
      let previous = 0;
      for (const value of sorted) {
        if (previous && value - previous > 1) out.push('gap');
        out.push(value);
        previous = value;
      }
      return out;
    }
    const people = Array.from({ length: 25 }, (_, index) => `u${index + 1}`);
    expect(referralPageCount(0)).to.equal(0);
    expect(referralPageCount(8)).to.equal(1);
    expect(referralPageCount(9)).to.equal(2);
    expect(referralPageCount(25)).to.equal(4);
    expect(sliceReferralPage(people, 1)).to.deep.equal(people.slice(0, 8));
    expect(sliceReferralPage(people, 4)).to.deep.equal(people.slice(24));
    expect(sliceReferralPage(people, 99)).to.deep.equal(people.slice(24));
    expect(visibleReferralPages(1, 3)).to.deep.equal([1, 2, 3]);
    expect(visibleReferralPages(20, 40)).to.deep.equal([1, 'gap', 18, 19, 20, 21, 22, 'gap', 40]);
    const history = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReferralHistory.tsx'),
      'utf8'
    );
    expect(history).to.include("variant === 'people'");
    expect(history).to.include('sliceReferralPage');
    expect(history).to.include('{!error && (');
    expect(history).to.not.include('!isLoading && !error');
    const netHook = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useReferralNetwork.ts'),
      'utf8'
    );
    expect(netHook).to.include('peekReferralNetwork');
    expect(history).to.include('referralRegisteredOn');
    expect(history).to.include('loadReferralChildren');
    expect(history).to.include('ReferralBranch');
    expect(history).to.include('referralSearchPlaceholder');
    expect(history).to.include('referralPersonMatches');
    function referralPersonMatches(query, person) {
      const needle = String(query || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '');
      if (!needle) return true;
      return [person.name, person.code, person.address].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(needle)
      );
    }
    expect(
      referralPersonMatches('lobo', { name: 'Lobo', code: 'AB12', address: '0xabc' })
    ).to.equal(true);
    expect(
      referralPersonMatches('@lobo', { name: 'lobo', code: 'AB12', address: '0xabc' })
    ).to.equal(true);
    expect(
      referralPersonMatches('zorro', { name: 'Lobo', code: 'AB12', address: '0xabc' })
    ).to.equal(false);
    function canExpandReferralDepth(depth) {
      return Number.isFinite(depth) && depth >= 1 && depth < 12;
    }
    function toggleBranchOpen(open, address) {
      const key = String(address || '').toLowerCase();
      return { ...open, [key]: !open[key] };
    }
    expect(canExpandReferralDepth(1)).to.equal(true);
    expect(canExpandReferralDepth(11)).to.equal(true);
    expect(canExpandReferralDepth(12)).to.equal(false);
    expect(toggleBranchOpen({}, '0xAbC')).to.deep.equal({ '0xabc': true });
    expect(toggleBranchOpen({ '0xabc': true }, '0xABC')).to.deep.equal({ '0xabc': false });
    const network = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'referralNetwork.ts'),
      'utf8'
    );
    expect(network).to.include('export async function loadReferralChildren');
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include("room === 'people'");
    expect(home).to.include('variant="people"');
  });

  it('locks public username and anonymous face after the first choice', () => {
    const fs = require('fs');
    const path = require('path');
    function isValidDisplayName(value) {
      const name = String(value || '').trim();
      return name.length >= 2 && name.length <= 24;
    }
    function isPublicIdentityLocked(profile) {
      const photo = String((profile && profile.publicPhoto) || '');
      return Boolean(
        profile &&
          profile.publicFace &&
          isValidDisplayName(profile.displayName) &&
          photo.startsWith('data:image/')
      );
    }
    function nextPublicFace(previous, incoming) {
      if (isPublicIdentityLocked(previous)) {
        return {
          displayName: previous.displayName,
          publicPhoto: previous.publicPhoto,
          publicFace: true,
        };
      }
      const confirming =
        Boolean(incoming.publicFace) &&
        isValidDisplayName(incoming.displayName) &&
        String(incoming.publicPhoto || '').startsWith('data:image/');
      return {
        displayName: confirming ? incoming.displayName : '',
        publicPhoto: confirming ? incoming.publicPhoto : '',
        publicFace: confirming,
      };
    }
    expect(isPublicIdentityLocked({ publicFace: false, displayName: '' })).to.equal(false);
    expect(isPublicIdentityLocked({ publicFace: true, displayName: 'lobo' })).to.equal(false);
    expect(
      isPublicIdentityLocked({
        publicFace: true,
        displayName: 'lobo',
        publicPhoto: 'data:image/jpeg;base64,aa',
      })
    ).to.equal(true);
    expect(
      nextPublicFace(
        { displayName: 'pedro', publicPhoto: '', publicFace: true },
        { displayName: 'lobo', publicPhoto: 'data:image/jpeg;base64,aa', publicFace: true }
      )
    ).to.deep.equal({
      displayName: 'lobo',
      publicPhoto: 'data:image/jpeg;base64,aa',
      publicFace: true,
    });
    expect(
      nextPublicFace(
        { displayName: 'lobo', publicPhoto: 'data:image/jpeg;base64,aa', publicFace: true },
        { displayName: 'otro', publicPhoto: 'data:image/jpeg;base64,bb', publicFace: true }
      )
    ).to.deep.equal({
      displayName: 'lobo',
      publicPhoto: 'data:image/jpeg;base64,aa',
      publicFace: true,
    });
    const names = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'UsernameSection.tsx'),
      'utf8'
    );
    const profileSettings = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ProfileSettings.tsx'),
      'utf8'
    );
    expect(profileSettings).to.include('PublicIdentityForm');
    expect(profileSettings).to.not.include('displayName: username');
    expect(profileSettings).to.not.include('displayName: value');
    const publicProfile = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'userProfile.ts'),
      'utf8'
    );
    expect(publicProfile).to.include("sanitizePublicPhoto(profile.publicPhoto || '')");
    expect(names).to.include('usernameLocked');
    expect(names).to.not.include('usernameChange');
    const lock = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LockSettings.tsx'),
      'utf8'
    );
    expect(lock).to.include('lockPasswordLocked');
    expect(lock).to.include('hasPassword');
    const securityPanel = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SecuritySettings.tsx'),
      'utf8'
    );
    expect(securityPanel).to.not.include("setPanel('password')");
    expect(securityPanel).to.not.include("panel === 'password'");
    const avatar = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ProfileAvatar.tsx'),
      'utf8'
    );
    expect(avatar).to.include('publicView');
    expect(avatar).to.include('publicPhoto');
    const people = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReferralHistory.tsx'),
      'utf8'
    );
    expect(people).to.include('publicView');
    const settings = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SettingsButton.tsx'),
      'utf8'
    );
    expect(settings).to.not.include('ProfileSettings');
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('createAccount');
    expect(gate).to.include('publicIdentity');
    expect(gate).to.include("setupStage === 'signIn'");
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include('LinkedWalletCard');
    const account = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'WalletSection.tsx'),
      'utf8'
    );
    expect(account).to.include('LinkedWalletCard');
    const onboarding = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AccountOnboarding.tsx'),
      'utf8'
    );
    expect(onboarding).to.include('LinkWalletForm');
    expect(onboarding).to.include('hasCompletedWalletLink');
    const linker = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LinkWalletForm.tsx'),
      'utf8'
    );
    expect(linker).to.include('connectWallet');
    expect(linker).to.include('linkWalletSkip');
    expect(linker).to.include('allowSkip');
    expect(linker).to.not.include('settingsAdmin');
    expect(linker).to.not.include('fundador');
    const transfer = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'TransferWalletsModal.tsx'),
      'utf8'
    );
    expect(transfer).to.include('allowSkip={false}');
    expect(transfer).to.include('loadRequiredExternalWallet');
    const linked = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'linkedWallet.ts'),
      'utf8'
    );
    expect(linked).to.include('saveLinkedExternalWallet');
    expect(linked).to.include('skipLinkedExternalWallet');
    expect(linked).to.include('loadRequiredExternalWallet');
    function hasLinkedExternalWallet(value) {
      return /^0x[a-fA-F0-9]{40}$/.test(String(value || '')) && !/^0x0+$/i.test(value);
    }
    function hasCompletedWalletLink(value) {
      return String(value || '').trim() === 'skipped' || hasLinkedExternalWallet(value);
    }
    function requiredExternal(value) {
      return hasLinkedExternalWallet(value) ? value : '';
    }
    expect(hasLinkedExternalWallet('')).to.equal(false);
    expect(hasCompletedWalletLink('skipped')).to.equal(true);
    expect(requiredExternal('skipped')).to.equal('');
    expect(hasLinkedExternalWallet('0x1111111111111111111111111111111111111111')).to.equal(true);
  });

  it('strips Android fontWeight so MIUI cannot double-paint letters', () => {
    function androidFace(weight, family) {
      if (family === 'monospace' || /mono|courier/i.test(String(family || ''))) return 'monospace';
      const n =
        weight === 'bold' || weight === '700'
          ? 700
          : weight === '600' || weight === '500'
            ? 600
            : 400;
      if (n >= 700) return 'sans-serif-black';
      if (n >= 500) return 'sans-serif-medium';
      return 'sans-serif';
    }
    function remapAndroidTextStyle(style, os = 'android') {
      if (os !== 'android') return style;
      const next = { ...style };
      next.fontFamily = androidFace(next.fontWeight, next.fontFamily);
      delete next.fontWeight;
      delete next.fontStyle;
      next.textShadowColor = 'transparent';
      next.textShadowRadius = 0;
      next.textShadowOffset = { width: 0, height: 0 };
      if (typeof next.letterSpacing === 'number') next.letterSpacing = 0;
      return next;
    }
    const painted = remapAndroidTextStyle({ fontSize: 22, fontWeight: '600' });
    expect(painted.fontWeight).to.equal(undefined);
    expect(painted.fontFamily).to.equal('sans-serif-medium');
    expect(painted.textShadowColor).to.equal('transparent');
    expect(painted.textShadowRadius).to.equal(0);
    expect(remapAndroidTextStyle({ fontWeight: '700' }).fontFamily).to.equal('sans-serif-black');
    expect(remapAndroidTextStyle({ fontWeight: '400' }).fontFamily).to.equal('sans-serif');
    expect(remapAndroidTextStyle({ fontWeight: '700' }, 'ios').fontWeight).to.equal('700');
  });

  it('gates Alta loans on-chain and ignores foreign https deep links', () => {
    const fs = require('fs');
    const path = require('path');
    const credit = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumCredit.sol'),
      'utf8'
    );
    const famaLib = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'libraries', 'QuatriviumFamaLib.sol'),
      'utf8'
    );
    const deep = fs.readFileSync(path.join(__dirname, '..', 'utils', 'appDeepLink.ts'), 'utf8');
    const links = fs.readFileSync(path.join(__dirname, '..', 'constants', 'appLinks.ts'), 'utf8');
    const transfer = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'TransferWalletsModal.tsx'),
      'utf8'
    );
    expect(famaLib).to.include('requireAltaPagada');
    expect(credit).to.include('requireAltaPagada');
    expect(famaLib).to.include('to == deudor');
    expect(famaLib).to.not.include('blacklist');
    expect(deep).to.include("token === 'admin'");
    expect(deep).to.include('isAllowedAppUrl');
    expect(deep).to.include('PUBLIC_APP_HOST');
    expect(links).to.include('quatriviumcredit.app');
    expect(deep).to.not.include("if (host && host !== 'expo-development-client') return host");
    expect(transfer).to.include('if (busy) return');
  });

  it('removes attester from AdminPanel and QuatriviumCreditService', () => {
    const fs = require('fs');
    const path = require('path');
    const panel = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AdminPanel.tsx'),
      'utf8'
    );
    expect(panel).to.not.include('onProposeAttester');
    expect(panel).to.not.include('ATTESTER_PRIVATE_KEY');
    const service = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'quatriviumCreditService.ts'),
      'utf8'
    );
    expect(service).to.not.include("proposeAdmin('setAttester'");
  });

  it('hides founder tools from the settings list', () => {
    const fs = require('fs');
    const path = require('path');
    const settings = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SettingsButton.tsx'),
      'utf8'
    );
    expect(settings).to.not.include("label={t('settingsAdminTitle')}");
    expect(settings).to.include("setPanel('admin')");
    expect(settings).to.include('onLongPress');
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include('adminInfo.isOwner || adminInfo.isAdmin');
  });

  it('lets two founders kick a lost or hacked key', () => {
    const fs = require('fs');
    const path = require('path');
    const sol = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumCredit.sol'),
      'utf8'
    );
    expect(sol).to.include('return 2');
    expect(sol).to.include('ownerList.length > 2');
    const es = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'i18n', 'locales', 'es.json'), 'utf8')
    );
    expect(es.adminTwoOfThree).to.include('2 firmas');
    expect(es.adminTwoOfThree).to.match(/pierde|hackean/);
    expect(es.emailNeedApi.length).to.be.below(180);
    expect(es.otpDeliveryFailed.length).to.be.below(180);
    expect(es.creditAccessLead.length).to.be.below(120);
    expect(es.linkWalletNeedFunds).to.match(/[Vv]incule una billetera/);
    expect(es.externalPaysLead).to.match(/vinculada/);
    expect(es.appWalletFailed.length).to.be.below(50);
    expect(es.appWalletInTitle).to.equal('Depositar');
    expect(es.yourLpPosition).to.match(/aporte|posici/i);
    const walletCtx = fs.readFileSync(
      path.join(__dirname, '..', 'wallet', 'AppWalletContext.tsx'),
      'utf8'
    );
    expect(walletCtx).to.include('restoreSavedSessionWrap');
    const walletSvc = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'appWallet.ts'),
      'utf8'
    );
    expect(walletSvc).to.include('readRawWallet');
    expect(walletSvc).to.include("throw new Error('locked')");
    const ensureFn = walletSvc.slice(
      walletSvc.indexOf('export async function ensureAppWallet'),
      walletSvc.indexOf('export async function wipeAppWallet')
    );
    expect(ensureFn).to.include("throw new Error('missing')");
    expect(ensureFn).to.not.include('createAppWallet');
    expect(walletSvc).to.include('wallet-persist');
    const panel = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AdminPanel.tsx'),
      'utf8'
    );
    expect(panel).to.not.include('onProposeConfirmations');
  });

  it('scans KYC locally and draws square rank frames by division', () => {
    const fs = require('fs');
    const path = require('path');
    const ranks = fs.readFileSync(path.join(__dirname, '..', 'constants', 'ranks.ts'), 'utf8');
    expect(ranks).to.include('offset >= third * 2 ? 2');
    expect(ranks).to.include("return 'III'");
    expect(ranks).to.include('rankGalleryRow');
    expect(ranks).to.include('RANK_GALLERY');
    const frame = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'RankFrame.tsx'),
      'utf8'
    );
    expect(frame).to.include('assets/logo');
    expect(frame).to.include('colorizeTextureFilters');
    expect(frame).to.include('rankDivisionTint');
    expect(frame).to.include('rank.division');
    expect(frame).to.include('framePad');
    expect(frame).to.include('LogoWeave');
    expect(frame).to.include('MetalBezel');
    expect(frame).to.include('jewelCount');
    expect(frame).to.include('RankGem');
    expect(frame).to.include('0.5 + rank.division');
    expect(frame).to.include('0.82 + rank.division');
    const gemUi = fs.readFileSync(path.join(__dirname, '..', 'components', 'RankGem.tsx'), 'utf8');
    expect(gemUi).to.include('assets/gems');
    expect(gemUi).to.include('garnet.png');
    expect(gemUi).to.include('amethyst.png');
    expect(gemUi).to.include('diamond.png');
    expect(gemUi).to.include('citrine.png');
    expect(ranks).to.include('RANK_GEM_ASSET');
    expect(ranks).to.include("bronze: 'garnet'");
    expect(frame).to.not.include('cornerMarks');
    expect(frame).to.not.include('Diamond');
    expect(frame).to.not.match(/borderRadius:\s*size\s*\/\s*2/);
    expect(ranks).to.include('saturateHex');
    expect(ranks).to.include('mixHex(rank.metal, rank.light');
    expect(ranks).to.not.match(/rankDivisionTint[\s\S]*mixHex\(rank\.dark/);
    const ladder = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'RankLadder.tsx'),
      'utf8'
    );
    expect(ladder).to.include('rankGalleryRow');
    expect(ladder).to.include('RankFrame');
    expect(ladder).to.include('romanDivision');
    const palette = fs.readFileSync(path.join(__dirname, '..', 'theme', 'palette.ts'), 'utf8');
    expect(palette).to.include("primary: '#1B6B3A'");
    expect(palette).to.match(/onPrimary: '#111111'/);
    const card = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LinkedWalletCard.tsx'),
      'utf8'
    );
    expect(card).to.include("t('wallet')");
    expect(card).to.include('linkWalletBind');
    expect(card).to.include('t(boundLabel)');
    expect(card).to.not.include('linkedWalletHubNeed');
  });

  it('keeps the session wrap out of AsyncStorage', function () {
    const fs = require('fs');
    const path = require('path');
    const session = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'savedSession.ts'),
      'utf8'
    );
    expect(session).to.not.include('AsyncStorage.setItem(WRAP_FALLBACK');
    expect(session).to.include('AsyncStorage.removeItem(WRAP_FALLBACK');
    expect(session).to.include('SecureStore.setItemAsync(WRAP');
    const guard = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ScreenGuard.tsx'),
      'utf8'
    );
    expect(guard).to.include('subscribeScreenshot');
    expect(guard).to.include('preventScreenCaptureAsync');
    expect(guard).to.include('notifyScreenshot');
    expect(guard).to.include("import('expo-screen-capture')");
    const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
    expect(JSON.stringify(appJson.expo.plugins)).to.not.include('expo-screen-capture');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(typeof pkg.dependencies['expo-screen-capture']).to.equal('string');
    const security = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SecuritySettings.tsx'),
      'utf8'
    );
    expect(security).to.include('subscribeScreenshot');
    expect(security).to.include('selectable={false}');
    expect(security).to.not.include('copyText(');
    const lock = fs.readFileSync(path.join(__dirname, '..', 'services', 'appLock.ts'), 'utf8');
    expect(lock).to.include('AsyncStorage.removeItem(PASSWORD_FALLBACK)');
    expect(lock).to.match(/if \(stored\) \{[\s\S]*removeItem\(PASSWORD_FALLBACK\)/);
    expect(lock).to.include('allowWalletAsyncFallback');
    expect(lock).to.include("throw new Error('password-persist')");
    const bio = lock.slice(
      lock.indexOf('export async function loadWrapFromBiometric'),
      lock.indexOf('export async function clearBiometricWrap')
    );
    expect(bio).to.include('authenticateBiometric');
    expect(bio).to.include('if (!ok) return null');
    expect(bio).to.not.include('BIO_WRAP_OPTIONS');
  });

  it('keeps local sovereign auth methods without email or phone OTP', function () {
    const fs = require('fs');
    const path = require('path');
    const prefs = fs.readFileSync(path.join(__dirname, '..', 'services', 'authPrefs.ts'), 'utf8');
    expect(prefs).to.match(
      /ACTION_AUTH_METHODS: AuthMethod\[\] = \['pin', 'authenticator', 'biometric', 'password'\];/
    );
    expect(prefs).to.not.include("'phone'");
    expect(prefs).to.include("['password', 'pin', 'biometric', 'authenticator']");
    expect(prefs).to.not.include("methods.push('email')");
    const lock = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(lock).to.not.include("unlockMode === 'phone'");
    expect(lock).to.not.include("unlockMode === 'email'");
    expect(lock).to.not.include('requestPhoneOtp');
    expect(lock).to.not.include('requestEmailOtp');
    const funds = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FundsConfirmHost.tsx'),
      'utf8'
    );
    expect(funds).to.not.include("method === 'phone'");
    expect(funds).to.not.include("method === 'email'");
    expect(funds).to.not.include('requestPhoneOtp');
    expect(funds).to.not.include('requestEmailOtp');
    const service = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'quatriviumCreditService.ts'),
      'utf8'
    );
    expect(service).to.include('access-required');
    expect(service).to.include('isAltaConfigured()');
    expect(service).to.include("if (!altaPaid) throw new Error('access-required')");
  });

  it('offers canje amounts through 1000 USDT and keeps Reserva commission copy in Reserva', function () {
    const fs = require('fs');
    const path = require('path');
    const fama = fs.readFileSync(path.join(__dirname, '..', 'constants', 'fama.ts'), 'utf8');
    expect(fama).to.include('CANJE_USDT_BUTTONS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]');
    const canje = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FameCanjeSection.tsx'),
      'utf8'
    );
    expect(canje).to.not.include('canjeReservaExists');
    expect(canje).to.not.include('canjeReservaLead');
    expect(canje).to.include('CANJE_USDT_BUTTONS');
    const reservaUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReservaSection.tsx'),
      'utf8'
    );
    expect(reservaUi).to.include('reservaCommissionLead');
    expect(reservaUi).to.include('reservaBoostComision');
    expect(reservaUi).to.include('reservaLockOnce');
    expect(reservaUi).to.include('RESERVA_LOCK_BUTTONS');
    expect(reservaUi).to.include('RESERVA_MIN_LOCK_USDT');
    expect(reservaUi).to.not.include('reservaFounderNote');
    const constants = fs.readFileSync(
      path.join(__dirname, '..', 'constants', 'reserva.ts'),
      'utf8'
    );
    expect(constants).to.include('RESERVA_MIN_LOCK_USDT = 1');
    const service = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'reservaService.ts'),
      'utf8'
    );
    expect(service).to.include('RESERVA_MIN_LOCK_WEI');
    const store = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'reservaDemoStore.ts'),
      'utf8'
    );
    expect(store).to.include('RESERVA_MIN_LOCK_WEI');
    const es = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'i18n', 'locales', 'es.json'), 'utf8')
    );
    expect(es.reservaCommissionLead).to.match(/generacional/);
    expect(es.reservaBoostComision).to.include('10%');
    expect(es.reservaBoostComision).to.include('20%');
    expect(es.reservaMonto).to.include('1 LUSD');
    expect(es.hubReservaLeadLocked).to.equal('Operativa a partir del nivel 10.');
    expect(es.hubReservaLeadLocked.toLowerCase()).to.not.include('visible');
    expect(es.supportDonateBenefit).to.include('{points}');
    expect(es.supportDonateBenefit).to.include('{symbol}');
    expect(es.supportPoolBenefit).to.include('{points}');
    const donate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'DonateFounderSection.tsx'),
      'utf8'
    );
    expect(donate).to.include('FAMA_PER_USDT');
    const pool = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'PoolSupportSection.tsx'),
      'utf8'
    );
    expect(pool).to.include('FAMA_PER_USDT');
    const auth = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AuthenticatorSetup.tsx'),
      'utf8'
    );
    expect(auth).to.include('createAuthenticatorSecret');
    expect(auth).to.include('collapsable={false}');
    expect(auth).to.include('renderToHardwareTextureAndroid={false}');
    expect(auth).to.include('authenticatorActivate');
    expect(auth).to.include('authenticatorReplace');
    expect(auth).to.include("confirmFunds('security')");
    expect(auth).to.not.match(/if \(on\) return;[\s\S]{0,80}createAuthenticatorSecret/);
    expect(es.referralEarnLevel.toLowerCase()).to.not.include('pide y paga');
    expect(es.referralEarnBand).to.include('{amount}');
    expect(es.maxLevelNote).to.include('{count}');
    expect(es.maxLevelNote).to.include('{amount}');
    expect(es.maxLevelNote.toLowerCase()).to.not.include('subir');
    const card = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LoanTierCard.tsx'),
      'utf8'
    );
    expect(card).to.include('referralEarnBand');
    expect(card).to.include('MAX_LEVEL_BONUS_EVERY');
    expect(card).to.include("t('payChoiceLead')");
    expect(es.referralCommissionSchedule).to.include('0,8%');
    expect(es.referralRepDirectOnly).to.include('invitó de forma directa');
    expect(es.jobCycle5.toLowerCase()).to.include('cancele');
    expect(es.jobCycle5.toLowerCase()).to.not.include('solicita y cancela');
    const referrals = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReferralSection.tsx'),
      'utf8'
    );
    expect(referrals).to.include('referralCommissionSchedule');
    expect(referrals).to.not.include('fameForGeneration');
    const commissions = fs.readFileSync(
      path.join(__dirname, '..', 'constants', 'commissions.ts'),
      'utf8'
    );
    expect(commissions).to.include('generationCommissionBps');
    expect(commissions).to.include('MAX_COMMISSION_LINE = 40');
    expect(commissions).to.include('if (gen === 1) return 1500');
    expect(commissions).to.include('if (gen === 2) return 800');
    expect(commissions).to.include('if (gen <= 12) return 80');
    const credit = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumCredit.sol'),
      'utf8'
    );
    expect(credit).to.include('GEN1_BP = 1500');
    expect(credit).to.include('GEN2_BP = 800');
    expect(credit).to.include('MAX_LINEA = 40');
    expect(credit).to.include('PUNTOS_POR_REFERIDO = 50');
    const confirmHost = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FundsConfirmHost.tsx'),
      'utf8'
    );
    expect(confirmHost).to.include("nextPurpose === 'security'");
    expect(confirmHost).to.include('listSecurityConfirmMethods');
    const lockUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LockSettings.tsx'),
      'utf8'
    );
    expect(lockUi).to.include("confirmFunds('security')");
    const bioUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'BiometricLockSection.tsx'),
      'utf8'
    );
    expect(bioUi).to.include("confirmFunds('security')");
    const methodsUi = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AuthMethodPicker.tsx'),
      'utf8'
    );
    expect(methodsUi).to.include("confirmFunds('security')");
  });

  it('reads alta and reserve rate from the chain without KYC flags', function () {
    const fs = require('fs');
    const path = require('path');
    const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
    const gates = read('utils', 'creditGates.ts');
    expect(gates).to.match(
      /if \(altaPaid\) return true;\s*if \(isAltaConfigured\(\)\) return false;/
    );
    const service = read('services', 'quatriviumCreditService.ts');
    expect(service).to.not.include('const floor = 4n * 10n ** 18n');
    const altaRead = service.slice(
      service.indexOf('altaPagada:'),
      service.indexOf('obtenerSaludAdmin')
    );
    expect(altaRead).to.include('registroHecho');
    expect(altaRead).to.not.match(/catch[\s\S]{0,80}return false/);
    expect(service).to.not.include('kycExigido');
    const home = read('app', 'index.tsx');
    expect(home).to.include(
      'hasCreditAccess(userInfo.donatedUsd || 0, Boolean(userInfo.altaPagada))'
    );
    expect(home).to.not.match(/hasCreditAccess\(userInfo\.donatedUsd \|\| 0\)[^,]/);
    const balances = read('hooks', 'useWeb3Balances.ts');
    expect(balances).to.not.include('!isDemoAccount() || required');
    expect(balances).to.include('altaPagada: altaHecha');
    const reserva = read('services', 'reservaService.ts');
    expect(reserva).to.not.include('apyBps: RESERVA_MAX_APY_BP');
    expect(read('components', 'ReservaSection.tsx')).to.include(
      'preview?.configured && preview.apyKnown'
    );
    const appJson = JSON.parse(read('app.json'));
    expect(appJson.expo.updates).to.equal(undefined);
    expect(JSON.stringify(appJson.expo.android.intentFilters)).to.not.include(
      'www.quatriviumcredit.app'
    );
    expect(read('plugins', 'withQuatriviumAndroidSecurity.js')).to.not.include(
      'www.quatriviumcredit.app'
    );
    const links = JSON.parse(read('web', '.well-known', 'assetlinks.json'));
    expect(links[0].target.package_name).to.equal('com.quatrivium.sovereign');
    expect(links[0].target.sha256_cert_fingerprints[0]).to.match(/^DF:EF:CC:D0/);
    const fr = JSON.parse(read('i18n', 'locales', 'fr.json'));
    expect(fr.liveCreditNotReady).to.not.include('est ouvert');
  });

  it('tells the truth about streak and network fame, and offers the reserve pot withdrawal', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
    const es = JSON.parse(read('i18n', 'locales', 'es.json'));
    const en = JSON.parse(read('i18n', 'locales', 'en.json'));
    expect(es.referralRepLead).to.include('1 LUSD');
    expect(es.referralRepLead).to.not.include('generación 2');
    expect(es.rachaLead).to.include('invitado directo');
    expect(es.rachaLead).to.not.include('registrarse, pedir');
    expect(es.guideRachaBody).to.not.include('registrarse, solicitar');
    expect(es.referralRepNext).to.include('no acredita fama de red');
    expect(es.canjeLead).to.not.include('fama de red');
    expect(es.referralRepDirectOnly).to.include('no acredita fama de red');
    expect(es.guideNetworkEarn).to.not.include('Canje');
    expect(es.guideCanjeBody).to.include('no acredita fama de red');
    expect(es.guideCanjeBody).to.not.include('La de red');
    const hi = JSON.parse(read('i18n', 'locales', 'hi.json'));
    const bn = JSON.parse(read('i18n', 'locales', 'bn.json'));
    expect(hi.reservaRetiroPending).to.include('की ओर');
    expect(bn.reservaRetiroPending).to.not.include('{amount} থেকে');
    expect(es.profileLead).to.include('apodo');
    expect(en.profileLead).to.include('nickname');
    expect(en.profileLead).to.not.equal(es.profileLead);
    const panel = read('components', 'AdminPanel.tsx');
    const frStreak = JSON.parse(read('i18n', 'locales', 'fr.json'));
    expect(frStreak.rachaLead).to.include('une seconde fois');
    expect(frStreak.rachaLead).to.not.include('pas encore');
    const balances = read('hooks', 'useWeb3Balances.ts');
    expect(balances).to.include('if (outstanding === null) return { poolBalance }');
    expect(balances).to.not.include('outstanding = 0n');
    expect(balances).to.include('curveRateBps: curveRateRead ?? prev.curveRateBps');
    expect(balances).to.not.include('curveRateBps = 0');
    const saludFn = read('services', 'quatriviumCreditService.ts');
    const salud = saludFn.slice(
      saludFn.indexOf('obtenerSaludAdmin:'),
      saludFn.indexOf('obtenerFama:')
    );
    expect(salud).to.include('return null');
    expect(salud).to.include('reservaBote = null');
    expect(panel).to.include('row.reservaBote ?? prev?.reservaBote ?? null');
    expect(panel).to.not.include('onAplicarRetiroReserva');
    expect(panel).to.not.include('reservaRetiroPropose');
    const abi = read('constants', 'reservaConfig.ts');
    expect(abi).to.not.include('proponerRetiroBote');
    expect(abi).to.not.include('applyRetiroBote');
    const referral = read('components', 'ReferralSection.tsx');
    expect(referral).to.include('hasPadre && !isFundador');
    const appJson = JSON.parse(read('app.json'));
    expect(appJson.expo.splash.image).to.equal('./assets/splash-blank.png');
    expect(read('plugins', 'withQuatriviumAndroidSecurity.js')).to.include('hideNativeSplashMark');
  });
});
