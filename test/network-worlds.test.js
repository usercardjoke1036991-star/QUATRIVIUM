const { expect } = require('chai');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');

const ENV_KEYS = [
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_CHAIN_ID',
  'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET',
  'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET',
  'EXPO_PUBLIC_LUSD_ADDRESS',
  'EXPO_PUBLIC_USDT_ADDRESS',
  'EXPO_PUBLIC_ARBITRUM_MAINNET_RPC_PRIMARY',
  'EXPO_PUBLIC_ARBITRUM_TESTNET_RPC_PRIMARY',
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

describe('Demo y Real no se mezclan', function () {
  const app = withoutContractEnv(() => {
    const rpc = loadAppModule('constants/rpcConfig.ts');
    const contracts = loadAppModule('constants/contractConfig.ts');
    const addresses = loadAppModule('constants/deployedAddresses.ts');
    const arbitrum = loadAppModule('constants/arbitrum.ts');
    return { rpc, contracts, addresses, arbitrum };
  });

  after(function () {
    app.rpc.setRuntimeMode('live');
    app.rpc.setProductMode('live');
  });

  it('en Real usa Arbitrum One (chain 42161) y LUSD oficial, nunca el de prueba', function () {
    const { rpc, contracts, addresses, arbitrum } = app;
    rpc.setProductMode('live');
    rpc.setRuntimeMode('live');
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(42161);
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(addresses.DEPLOYED_MAINNET.chainId);
    expect(String(rpc.RPC_URLS.primary || '')).to.not.match(/sepolia/i);
    expect(contracts.getUsdtAddress().toLowerCase()).to.equal(
      arbitrum.ARBITRUM_MAINNET.lusd.toLowerCase()
    );
  });

  it('en Demo usa Arbitrum Sepolia (chain 421614) y el crédito de prueba, nunca el de mainnet', function () {
    const { rpc, addresses } = app;
    rpc.setProductMode('demo');
    rpc.setRuntimeMode('demo');
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(421614);
    expect(rpc.NETWORK_CONFIG.chainId).to.equal(addresses.DEPLOYED_TESTNET.chainId);
    expect(String(rpc.RPC_URLS.primary || '')).to.match(/sepolia/i);
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

  it('configura ETH nativo y umbral mínimo L2 (0.0001 ETH) en Arbitrum', function () {
    const { arbitrum } = app;
    expect(arbitrum.NATIVE_SYMBOL).to.equal('ETH');
    expect(arbitrum.MIN_GAS_WEI).to.equal(100_000_000_000_000n);
  });
});

describe('avisos y fallos de red', function () {
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
