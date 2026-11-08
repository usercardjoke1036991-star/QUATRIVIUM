/**
 * Arranca Slither aunque npm sea el de Windows y el binario viva en WSL/pipx.
 * En Windows llama a scripts/run-slither-wsl.sh con bash -lic (como la terminal Ubuntu).
 * Uso: npm run security:slither
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnEnv, spawnPath, binWsl } from './spawnEnv.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const extra = process.argv.slice(2);
// Hardhat 2 explícito: con foundry.toml presente crytic-compile elegiría Foundry y buscaría `forge`.
const slitherArgs = [
  '.',
  '--config-file',
  'slither.config.json',
  '--compile-force-framework',
  'hardhat',
  '--hardhat-ignore-compile',
  ...extra,
];
const wslScript = resolve(root, 'scripts', 'run-slither-wsl.sh');
const hardhatCli = resolve(root, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js');

function envWithPipx() {
  const env = spawnEnv();
  const pipxBin = resolve(homedir(), '.local', 'bin');
  const localBin = resolve(root, 'node_modules', '.bin');
  env.PATH = `${pipxBin}${delimiter}${localBin}${delimiter}${spawnPath()}`;
  env.HARDHAT_CONFIG = resolve(root, 'hardhat.config.cjs');
  return env;
}

function windowsToWsl(winPath) {
  const normalized = resolve(winPath).replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return null;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function probe(command, args, env = envWithPipx()) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
    env,
    windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') return false;
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (/no se reconoce|not recognized|not found|No module named|cannot find/i.test(out)) {
    return false;
  }
  if (result.status === 127) return false;
  return result.status === 0 || /slither/i.test(out);
}

function run(command, args, env = envWithPipx()) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env,
    windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') return null;
  return result.status ?? 1;
}

function bashQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Artefactos frescos con el Hardhat 2 de Magno, no el del directorio padre. */
function compileWithHardhat() {
  if (!existsSync(hardhatCli)) {
    console.error('Falta Magno/node_modules/hardhat. Ejecuta npm install en Magno.');
    return false;
  }
  const status = run(process.execPath, [
    hardhatCli,
    '--config',
    'hardhat.config.cjs',
    'compile',
    '--force',
  ]);
  return status === 0;
}

const localTries = [
  ['slither', ['--version']],
  ['python3', ['-m', 'slither', '--version']],
  ['python', ['-m', 'slither', '--version']],
];

for (const [command, versionArgs] of localTries) {
  if (!probe(command, versionArgs)) continue;
  if (!compileWithHardhat()) process.exit(1);
  const args = command === 'slither' ? slitherArgs : ['-m', 'slither', ...slitherArgs];
  const status = run(command, args);
  if (status === null) continue;
  process.exit(status);
}

if (process.platform === 'win32') {
  const script = windowsToWsl(wslScript);
  if (script && probe('wsl', ['-e', 'bash', '-lc', 'true'], process.env)) {
    const extraArgs = extra.map(bashQuote).join(' ');
    const inner = `bash ${bashQuote(script)} ${extraArgs}`.trim();
    const status = spawnSync(binWsl(), ['-e', 'bash', '-lic', inner], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: spawnEnv(),
    });
    if (!status.error || status.error.code !== 'ENOENT') {
      process.exit(status.status ?? 1);
    }
  }
}

console.error(`Slither no está en el PATH de este npm (${process.platform}).
En la terminal de Ubuntu/WSL:

  export PATH="$HOME/.local/bin:$PATH"
  slither . --config-file slither.config.json

Si pipx no está instalado:

  pipx install slither-analyzer
  pipx ensurepath`);
process.exit(1);
