const { expect } = require('chai');
const fs = require('fs');
const https = require('https');
const Module = require('module');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');

const ENV_KEYS = [
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_CHAIN_ID',
  'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET',
  'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET',
  'EXPO_PUBLIC_USDT_ADDRESS',
  'EXPO_PUBLIC_BSC_MAINNET_RPC_PRIMARY',
  'EXPO_PUBLIC_BSC_TESTNET_RPC_PRIMARY',
  'EXPO_PUBLIC_BSC_RPC_URL_PRIMARY',
  'EXPO_PUBLIC_BSC_RPC_URL_FALLBACK_1',
  'EXPO_PUBLIC_BSC_RPC_URL_FALLBACK_2',
];

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
}

function loadAppModule(rel) {
  const filename = path.join(root, rel);
  const orig = Module._resolveFilename;
  Module._extensions['.ts'] = compileTs;
  Module._extensions['.tsx'] = compileTs;
  Module._resolveFilename = function resolveTs(request, parent, isMain, options) {
    if (request.endsWith('.ts') || request.endsWith('.tsx')) {
      const abs = path.isAbsolute(request)
        ? request
        : path.resolve(path.dirname(parent.filename), request);
      if (fs.existsSync(abs)) return abs;
    }
    if (parent && parent.filename && request.startsWith('.')) {
      const base = path.resolve(path.dirname(parent.filename), request);
      if (fs.existsSync(`${base}.ts`)) return `${base}.ts`;
      if (fs.existsSync(`${base}.tsx`)) return `${base}.tsx`;
    }
    return orig.call(this, request, parent, isMain, options);
  };
  delete require.cache[filename];
  try {
    return require(filename);
  } finally {
    Module._resolveFilename = orig;
  }
}

function withoutContractEnv(load) {
  const backup = {};
  for (const key of ENV_KEYS) {
    backup[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return load();
  } finally {
    for (const key of ENV_KEYS) {
      if (backup[key] === undefined) delete process.env[key];
      else process.env[key] = backup[key];
    }
  }
}

function faucetOpensAreDemoOnly(source, label) {
  const needle = 'Linking.openURL(BSC_TESTNET_FAUCET)';
  let from = 0;
  let found = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    found += 1;
    const window = source.slice(Math.max(0, at - 700), at);
    expect(window, `${label} abre el grifo de prueba sin guarda Demo`).to.match(
      /demoGas|isDemoAccount\(\)|isDemoMode\(\)/
    );
    from = at + needle.length;
  }
  expect(found, `${label} ya no abre el grifo`).to.be.greaterThan(0);
}

function getHttps(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 4000 }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

describe('Demo y Real no se mezclan', function () {
  const app = withoutContractEnv(() => {
    const rpc = loadAppModule('constants/rpcConfig.ts');
    const contracts = loadAppModule('constants/contractConfig.ts');
    const addresses = loadAppModule('constants/deployedAddresses.ts');
    const bsc = loadAppModule('constants/bsc.ts');
    return { rpc, contracts, addresses, bsc };
  });

  after(function () {
    app.rpc.setRuntimeMode('live');
    app.rpc.setProductMode('live');
  });

  it('en Real usa chain 56 y el crédito mainnet, nunca el de prueba', function () {
    const { rpc, contracts, addresses, bsc } = app;
    rpc.setProductMode('live');
    rpc.setRuntimeMode('live');
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(56);
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(addresses.DEPLOYED_MAINNET.chainId);
    expect(rpc.getContractAddress().toLowerCase()).to.equal(
      addresses.DEPLOYED_MAINNET.contract.toLowerCase()
    );
    expect(rpc.getContractAddress().toLowerCase()).to.not.equal(
      addresses.DEPLOYED_TESTNET.contract.toLowerCase()
    );
    expect(rpc.isContractConfigured()).to.equal(true);
    expect(String(rpc.RPC_URLS.primary || '')).to.not.match(/testnet|prebsc/i);
    expect(contracts.getUsdtAddress().toLowerCase()).to.equal(bsc.BSC_MAINNET.usdt.toLowerCase());
    expect(contracts.getUsdtAddress().toLowerCase()).to.not.equal(
      addresses.DEPLOYED_TESTNET.usdt.toLowerCase()
    );
  });

  it('en Demo usa chain 97 y el crédito de prueba, nunca el de mainnet', function () {
    const { rpc, contracts, addresses, bsc } = app;
    rpc.setProductMode('demo');
    rpc.setRuntimeMode('demo');
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(97);
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(addresses.DEPLOYED_TESTNET.chainId);
    expect(rpc.getContractAddress().toLowerCase()).to.equal(
      addresses.DEPLOYED_TESTNET.contract.toLowerCase()
    );
    expect(rpc.getContractAddress().toLowerCase()).to.not.equal(
      addresses.DEPLOYED_MAINNET.contract.toLowerCase()
    );
    expect(rpc.isContractConfigured()).to.equal(true);
    expect(String(rpc.RPC_URLS.primary || '')).to.match(/testnet|prebsc/i);
    expect(contracts.getUsdtAddress().toLowerCase()).to.not.equal(
      bsc.BSC_MAINNET.usdt.toLowerCase()
    );
  });

  it('un mundo cruzado no queda listo para operar', function () {
    const { rpc } = app;
    rpc.setProductMode('live');
    rpc.setRuntimeMode('demo');
    expect(rpc.isCreditReady()).to.equal(false);
    rpc.setProductMode('demo');
    rpc.setRuntimeMode('live');
    expect(rpc.isCreditReady()).to.equal(false);
  });

  it('el grifo de BNB de prueba solo se abre en Demo', function () {
    const home = fs.readFileSync(path.join(root, 'hooks', 'useHomeHandlers.ts'), 'utf8');
    const charge = fs.readFileSync(path.join(root, 'services', 'founderUsdtCharge.ts'), 'utf8');
    faucetOpensAreDemoOnly(home, 'useHomeHandlers');
    faucetOpensAreDemoOnly(charge, 'founderUsdtCharge');
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    expect(worker).to.include("json(res, 403, { error: 'mainnet: use faucet' })");
  });
});

describe('avisos y fallos de red', function () {
  it('el worker público es HTTPS; el GET a /health no tumba CI', async function () {
    this.timeout(8000);
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    const notify = String(eas.build.production.env.EXPO_PUBLIC_NOTIFY_API || '');
    expect(notify.startsWith('https://')).to.equal(true);
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    expect(worker).to.include("path === '/health'");
    const health = `${notify.replace(/\/$/, '')}/health`;
    try {
      const status = await getHttps(health);
      if (status !== 200) {
        console.log(`notify health skip: HTTP ${status}`);
      }
    } catch (error) {
      console.log(`notify health skip: ${error instanceof Error ? error.message : 'red'}`);
    }
  });

  it('los 17 idiomas tienen el fallo de RPC y de billetera', function () {
    const langs = [
      'ar',
      'bn',
      'de',
      'en',
      'es',
      'fr',
      'hi',
      'id',
      'it',
      'ja',
      'ko',
      'pt',
      'ru',
      'tr',
      'ur',
      'vi',
      'zh',
    ];
    const keys = [
      'errRpcMismatch',
      'errRpcNoContract',
      'errWrongNetwork',
      'linkWalletNetworkDemo',
      'errNeedGas',
    ];
    for (const lang of langs) {
      const data = JSON.parse(
        fs.readFileSync(path.join(root, 'i18n', 'locales', `${lang}.json`), 'utf8')
      );
      for (const key of keys) {
        expect(String(data[key] || '').trim(), `${lang}.${key}`).to.not.equal('');
      }
    }
    const errors = fs.readFileSync(path.join(root, 'utils', 'txErrors.ts'), 'utf8');
    expect(errors).to.include('export function networkFailureError');
    expect(errors).to.include("['RPC chain mismatch', 'errRpcMismatch']");
    expect(errors).to.include("['wrong-network-demo', 'linkWalletNetworkDemo']");
    expect(errors).to.include("['wrong-network', 'errWrongNetwork']");
    const wallet = fs.readFileSync(path.join(root, 'utils', 'walletChain.ts'), 'utf8');
    const home = fs.readFileSync(path.join(root, 'hooks', 'useHomeHandlers.ts'), 'utf8');
    expect(wallet).to.include('networkFailureError');
    expect(home).to.include('networkFailureError(');
  });
});
