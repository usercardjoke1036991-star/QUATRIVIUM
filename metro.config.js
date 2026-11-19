const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package exports for modern packages
config.resolver.unstable_enablePackageExports = true;

const zlibStub = path.resolve(__dirname, 'stubs/zlib-stub.js');
const wsStub = path.resolve(__dirname, 'stubs/ws-stub.js');

// Módulos de Node.js / paquetes que no son compatibles con React Native.
// ws@8.x usa zlib, crypto, http, net, tls — todos módulos de Node.js
// que no existen en el entorno móvil. Stub completo del paquete ws.
const NODE_STUBS = {
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

const dropAssets = new Set(['pdf', 'html', 'yaml', 'yml', 'zip', 'db', 'psd']);
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => !dropAssets.has(ext));

const rootPattern = path
  .resolve(__dirname)
  .split(/[/\\]/)
  .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('[\\\\/]');
const docBlock = new RegExp(
  '^' +
    rootPattern +
    '[\\\\/](?:[^\\\\/]+\\.(?:md|pdf|txt|doc|docx)$|(?:contracts|test|forge-test|scripts|store-assets|web|lib|docs|informe[^\\\\/]*|notas[^\\\\/]*)[\\\\/])'
);
config.resolver.blockList = [].concat(config.resolver.blockList || [], docBlock);

module.exports = config;
