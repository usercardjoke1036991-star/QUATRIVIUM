/**
 * SonarCloud de QUATRIVIUM usa Automatic Analysis (repo GitHub público).
 * Este script no lanza scanner manual contra Cloud. Token: SONAR_TOKEN en .env.
 * Servidor local opcional: SONAR_HOST_URL=http://127.0.0.1:9000
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTrailSlash } from './spawnEnv.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
loadDotEnv(resolve(root, '.env'));

const host = stripTrailSlash(process.env.SONAR_HOST_URL || 'https://sonarcloud.io');
const token = String(process.env.SONAR_TOKEN || '').trim();
const compose = resolve(root, 'docker-compose.sonar.yml');
const PROJECT_KEY = 'usercardjoke1036991-star_QUATRIVIUM';
const CLOUD_REPORT = `https://sonarcloud.io/project/overview?id=${PROJECT_KEY}`;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
  });
}

function docker() {
  const exe =
    process.platform === 'win32'
      ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
      : 'docker';
  return existsSync(exe) ? exe : 'docker';
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function waitHealthy(maxMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${host}/api/system/status`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      if (String(data?.status || '').toUpperCase() === 'UP') return;
    } catch {
      // arrancando
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  }
  throw new Error(`SonarQube no respondió UP en ${host}`);
}

function existingSonarUp() {
  const ps = run(docker(), ['ps', '--format', '{{.Names}}\t{{.Ports}}']);
  return String(ps.stdout || '')
    .split(/\r?\n/)
    .some((line) => line.includes('9000') && /sonar/i.test(line));
}

function ensureCompose() {
  if (existingSonarUp()) return;
  const up = run(docker(), ['compose', '-f', compose, 'up', '-d']);
  if (up.status !== 0) {
    throw new Error(up.stderr || up.stdout || 'docker compose up falló');
  }
}

function isLocalHost() {
  return host.includes('127.0.0.1') || host.includes('localhost');
}

function scan() {
  if (!token) {
    console.error('Falta SONAR_TOKEN en .env. No se imprime el valor.');
    process.exit(1);
  }
  const scannerHost = isLocalHost()
    ? host.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal')
    : host;
  const args = [
    'run',
    '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '-e',
    `SONAR_HOST_URL=${scannerHost}`,
    '-e',
    `SONAR_TOKEN=${token}`,
    '-v',
    `${root}:/usr/src`,
    'sonarsource/sonar-scanner-cli',
    '-Dsonar.projectBaseDir=/usr/src',
    `-Dsonar.host.url=${scannerHost}`,
  ];
  const scanned = run(docker(), args, { stdio: 'inherit' });
  if (scanned.status !== 0) {
    process.exit(scanned.status || 1);
  }
}

try {
  console.log(`SonarQube ${host}`);
  if (!isLocalHost()) {
    console.log('QUATRIVIUM está anclado a GitHub con Automatic Analysis (repo público).');
    console.log('No se lanza scanner manual: chocaría con el análisis automático.');
    console.log(`Informe ${CLOUD_REPORT}`);
    process.exit(0);
  }
  if (!token) {
    console.error('Falta SONAR_TOKEN en .env. No se imprime el valor.');
    process.exit(1);
  }
  try {
    await waitHealthy(15000);
  } catch {
    ensureCompose();
    await waitHealthy();
  }
  scan();
  console.log(`Informe ${host}/dashboard?id=${PROJECT_KEY}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`SonarQube falló: ${message}`);
  process.exit(1);
}
