const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package exports for modern packages
config.resolver.unstable_enablePackageExports = true;

const zkNodeStub = path.resolve(__dirname, 'stubs/zk-node-stub.js');
const zlibStub = path.resolve(__dirname, 'stubs/zlib-stub.js');
const wsStub = path.resolve(__dirname, 'stubs/ws-stub.js');

// Módulos de Node.js / paquetes que no son compatibles con React Native.
// ws@8.x usa zlib, crypto, http, net, tls — todos módulos de Node.js
// que no existen en el entorno móvil. Stub completo del paquete ws.
const NODE_STUBS = {
  snarkjs: zkNodeStub,
  circomlibjs: zkNodeStub,
  zlib: zlibStub,
  ws: wsStub,
};

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (NODE_STUBS[moduleName]) {
    return { type: 'sourceFile', filePath: NODE_STUBS[moduleName] };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Add support for ZK circuit files (.wasm and .zkey)
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm', 'zkey'];

// Add support for source files if needed for ZK libraries
config.resolver.sourceExts = [...config.resolver.sourceExts, 'wasm'];

module.exports = config;
