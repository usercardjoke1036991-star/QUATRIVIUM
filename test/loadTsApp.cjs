const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    const fromCompiled =
      parent &&
      parent.filename &&
      (parent.filename.endsWith('.ts') || parent.filename.endsWith('.tsx'));
    if (fromCompiled && typeof request === 'string' && request.startsWith('.')) {
      const base = path.resolve(path.dirname(parent.filename), request);
      if (base.endsWith('.ts') && fs.existsSync(base)) return loadTs(base);
      if (base.endsWith('.tsx') && fs.existsSync(base)) return loadTs(base);
      if (fs.existsSync(`${base}.ts`)) return loadTs(`${base}.ts`);
      if (fs.existsSync(`${base}.tsx`)) return loadTs(`${base}.tsx`);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function loadTs(absPath) {
  installHooks();
  globalThis.__DEV__ = true;
  const filename = path.resolve(absPath);
  const cached = Module._cache[filename];
  if (cached) return cached.exports;
  const source = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  Module._cache[filename] = loaded;
  const body = js.startsWith('"use strict"')
    ? `"use strict";\nvar __DEV__ = globalThis.__DEV__;\n${js.slice('"use strict";'.length)}`
    : `var __DEV__ = globalThis.__DEV__;\n${js}`;
  loaded._compile(body, filename);
  loaded.loaded = true;
  return loaded.exports;
}

module.exports = { loadTs };
