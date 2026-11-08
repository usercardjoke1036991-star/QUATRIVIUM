import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

/** PATH fijo para spawn (S4036). No hereda el PATH del usuario. */
export function spawnPath() {
  if (process.platform === 'win32') {
    return [
      'C:\\Windows\\System32',
      'C:\\Windows',
      'C:\\Program Files\\Docker\\Docker\\resources\\bin',
      'C:\\Program Files\\Git\\cmd',
    ].join(delimiter);
  }
  return ['/usr/bin', '/bin', '/usr/local/bin'].join(delimiter);
}

export function spawnEnv(extra = {}) {
  const PATH = spawnPath();
  const env = { ...extra };
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'PATH' || key === 'Path' || key === 'path') continue;
    if (!(key in env)) env[key] = value;
  }
  env.PATH = PATH;
  env.Path = PATH;
  return env;
}

function firstExisting(cands, fallback) {
  return cands.find((item) => existsSync(item)) || fallback;
}

export function binDocker() {
  if (process.platform === 'win32') {
    const win = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
    return firstExisting([win], win);
  }
  return firstExisting(['/usr/bin/docker', '/usr/local/bin/docker'], '/usr/bin/docker');
}

export function binWsl() {
  return process.platform === 'win32' ? 'C:\\Windows\\System32\\wsl.exe' : '/usr/bin/wsl';
}

export function stripTrailSlash(value) {
  let out = String(value);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function binNpx() {
  const dir = resolve(process.execPath, '..');
  if (process.platform === 'win32') {
    return firstExisting(
      [resolve(dir, 'npx.cmd'), resolve(dir, 'npx.exe')],
      resolve(dir, 'npx.cmd')
    );
  }
  return firstExisting([resolve(dir, 'npx')], resolve(dir, 'npx'));
}
