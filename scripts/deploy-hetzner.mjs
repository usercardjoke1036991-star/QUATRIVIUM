/**
 * Publica el worker en un VPS Hetzner (Docker + Caddy HTTPS).
 * No imprime secretos.
 *
 *   $env:HETZNER_HOST="x.x.x.x"
 *   $env:NOTIFY_DOMAIN="notify.quatriviumcredit.app"
 *   $env:CADDY_EMAIL="soporte@quatriviumcredit.app"
 *   npm run notify:hetzner
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const root = resolve(process.cwd());
const remoteDir = '/opt/quatrivium-notify';
const host = String(process.env.HETZNER_HOST || '').trim();
const user = String(process.env.HETZNER_USER || 'root').trim();
const domain = String(process.env.NOTIFY_DOMAIN || 'notify.quatriviumcredit.app').trim();
const email = String(
  process.env.CADDY_EMAIL || process.env.EMAIL_FROM || 'soporte@quatriviumcredit.app'
).trim();
const sshTarget = `${user}@${host}`;
const sshOpts = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];

function loadEnv(filePath) {
  const map = {};
  if (!existsSync(filePath)) return map;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[line.slice(0, i).trim()] = value;
  }
  return map;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio:
      opts.input != null
        ? ['pipe', opts.silent ? 'pipe' : 'inherit', opts.silent ? 'pipe' : 'inherit']
        : opts.silent
          ? 'pipe'
          : 'inherit',
    input: opts.input,
  });
  if (result.status !== 0 && !opts.allowFail) {
    process.exit(result.status || 1);
  }
  return result;
}

if (!host) {
  console.error('Falta HETZNER_HOST (IP del servidor).');
  console.error('Ejemplo: $env:HETZNER_HOST="1.2.3.4"; npm run notify:hetzner');
  process.exit(1);
}

if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error('NOTIFY_DOMAIN no parece un dominio.');
  process.exit(1);
}

const workerFile = resolve(root, '.env.worker');
if (!existsSync(workerFile)) {
  console.error(
    'Falta .env.worker. Copie .env.worker.example y ponga TEXTBELT_API_KEY, Resend y NOTIFY_DATA_KEY.'
  );
  process.exit(1);
}

const env = { ...loadEnv(resolve(root, '.env')), ...loadEnv(workerFile) };
if (!env.NOTIFY_DATA_KEY || String(env.NOTIFY_DATA_KEY).length < 16) {
  console.error('Falta NOTIFY_DATA_KEY de al menos 16 caracteres en .env.worker');
  process.exit(1);
}

const probe = run('ssh', [...sshOpts, sshTarget, 'uname -s'], { silent: true, allowFail: true });
if (probe.status !== 0) {
  console.error('No hay SSH al servidor. En Hetzner use una clave SSH, no solo contraseña.');
  console.error(`Pruebe: ssh ${sshTarget}`);
  process.exit(1);
}

run('ssh', [...sshOpts, sshTarget, 'bash -s'], {
  input: readFileSync(resolve(root, 'scripts/hetzner-bootstrap.sh')),
});

const staging = join(tmpdir(), `quatrivium-hetzner-${randomBytes(6).toString('hex')}`);
mkdirSync(join(staging, 'scripts'), { recursive: true });
writeFileSync(join(staging, 'Dockerfile.notify'), readFileSync(resolve(root, 'Dockerfile.notify')));
writeFileSync(
  join(staging, '.dockerignore'),
  readFileSync(resolve(root, 'Dockerfile.notify.dockerignore'))
);
writeFileSync(
  join(staging, 'docker-compose.yml'),
  readFileSync(resolve(root, 'deploy/hetzner/docker-compose.yml'))
);
writeFileSync(join(staging, 'Caddyfile'), readFileSync(resolve(root, 'deploy/hetzner/Caddyfile')));
writeFileSync(
  join(staging, 'scripts/notify-worker.mjs'),
  readFileSync(resolve(root, 'scripts/notify-worker.mjs'))
);
writeFileSync(
  join(staging, 'scripts/bscNetworks.cjs'),
  readFileSync(resolve(root, 'scripts/bscNetworks.cjs'))
);
writeFileSync(
  join(staging, 'scripts/textbeltSms.cjs'),
  readFileSync(resolve(root, 'scripts/textbeltSms.cjs'))
);
writeFileSync(join(staging, '.env'), readFileSync(workerFile));
writeFileSync(join(staging, '.env.compose'), `NOTIFY_DOMAIN=${domain}\nCADDY_EMAIL=${email}\n`);

try {
  run('scp', [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-r',
    join(staging, 'Dockerfile.notify'),
    join(staging, '.dockerignore'),
    join(staging, 'docker-compose.yml'),
    join(staging, 'Caddyfile'),
    join(staging, '.env'),
    join(staging, '.env.compose'),
    join(staging, 'scripts'),
    `${sshTarget}:${remoteDir}/`,
  ]);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

run('ssh', [
  ...sshOpts,
  sshTarget,
  `cd ${remoteDir} && docker compose --env-file .env.compose up -d --build && docker compose ps`,
]);

console.log(`Worker en https://${domain}/health`);
console.log('Ponga esa URL en EXPO_PUBLIC_NOTIFY_API (.env, .env.worker y eas.json production).');
