const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('Render notify worker', function () {
  const root = path.join(__dirname, '..');

  it('pins Docker, health, disk and does not ship owner keys', function () {
    const yaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
    const docker = fs.readFileSync(path.join(root, 'Dockerfile.notify'), 'utf8');
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
    expect(yaml).to.include('dockerfilePath: ./Dockerfile.notify');
    expect(yaml).to.include('healthCheckPath: /health');
    expect(yaml).to.include('mountPath: /data');
    expect(yaml).to.include('plan: starter');
    expect(yaml).to.include('generateValue: true');
    expect(yaml).to.include('autoDeployTrigger: commit');
    expect(yaml).to.match(/TEXTBELT_API_KEY[\s\S]*sync: false/);
    expect(yaml).to.match(/RESEND_API_KEY[\s\S]*sync: false/);
    expect(yaml).to.match(/ATTESTER_PRIVATE_KEY[\s\S]*sync: false/);
    expect(yaml).to.match(/EMAIL_FROM[\s\S]*sync: false/);
    expect(yaml).to.not.include('soporte@quatriviumcredit.app');
    expect(yaml).to.match(/TWILIO_ACCOUNT_SID[\s\S]*sync: false/);
    expect(yaml).to.match(/SUMSUB_APP_TOKEN[\s\S]*sync: false/);
    expect(yaml).to.match(/SUMSUB_SECRET[\s\S]*sync: false/);
    expect(yaml).to.match(/SUMSUB_LEVEL_NAME[\s\S]*sync: false/);
    expect(yaml).to.include('NOTIFY_DEMO_IDENTITY');
    expect(yaml).to.not.match(/key: PRIVATE_KEY\b/);
    expect(docker).to.include('NOTIFY_BIND=0.0.0.0');
    expect(docker).to.include('NOTIFY_TRUST_PROXY=1');
    expect(docker).to.include('NOTIFY_DATA_FILE=/data/.notify-data.json');
    expect(docker).to.include('mkdir -p /data');
    expect(docker).to.include('notify-entrypoint.sh');
    expect(docker).to.include('su-exec');
    expect(docker).to.include('chown -R node:node /app /data');
    expect(docker).to.include('overrides.ws=8.21.0');
    expect(docker).to.include('/usr/local/lib/node_modules/npm');
    const entry = fs.readFileSync(path.join(root, 'scripts', 'notify-entrypoint.sh'), 'utf8');
    expect(entry).to.include('su-exec node');
    expect(entry).to.include('id -u');
    expect(worker).to.include('resolveDataFile');
    expect(worker).to.include('probeWritableDir');
    expect(dockerignore).to.include('!scripts/');
    expect(dockerignore).to.include('textbeltSms.cjs');
    expect(dockerignore).to.include('telegramBotName.cjs');
    expect(docker).to.include('telegramBotName.cjs');
    expect(worker).to.include("path === '/health'");
    expect(worker).to.include("path === '/'");
    expect(worker).to.include("service: 'quatrivium-notify'");
    expect(worker).to.include('/identity/status');
    expect(worker).to.include('/identity/resume');
    expect(worker).to.include('/identity/release');
    expect(worker).to.include('mkdirSync(dirname(file)');
    expect(worker).to.include('writeAtomic');
    expect(worker).to.include('const isHealth');
    expect(worker).to.include('process.env.PORT || process.env.NOTIFY_PORT || 8787');
    expect(worker).to.not.include('displayName: username');
    expect(worker).to.include('sessionUser');
    expect(worker).to.include(
      "ATTESTER_EXPLICIT || (!isMainnet && !publicAttesterHost ? DEPLOY_KEY : '')"
    );
    expect(worker).to.include('sanitizeLoadedStore');
    expect(worker).to.include("purpose !== 'autofund'");
    expect(worker).to.not.include('json(res, 200, { wrap })');
    const fly = fs.readFileSync(path.join(root, 'scripts', 'deploy-notify.mjs'), 'utf8');
    expect(fly).to.not.include('ATTESTER_PRIVATE_KEY: env.ATTESTER_PRIVATE_KEY || env.PRIVATE_KEY');
    expect(fly).to.not.match(/^\s*PRIVATE_KEY: env\.PRIVATE_KEY,/m);
    expect(fly).to.include('ATTESTER_PRIVATE_KEY debe ser distinta de PRIVATE_KEY');
  });

  it('listens on PORT, creates data dir and answers /health', async function () {
    this.timeout(20000);
    const { spawn } = require('child_process');
    const http = require('http');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-render-'));
    const dataFile = path.join(dir, 'nested', '.notify-data.json');
    const port = 18787 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'notify-worker.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        NOTIFY_BIND: '127.0.0.1',
        NOTIFY_DATA_KEY: ['render-audit-key-', '32chars!!'].join(''),
        NOTIFY_DATA_FILE: dataFile,
        EXPO_PUBLIC_CHAIN_ID: '97',
        EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET: '0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f',
        NOTIFY_CORS_ORIGIN: '*',
        TEXTBELT_API_KEY: ['paid-textbelt-', 'key-16'].join(''),
        RESEND_API_KEY: ['re_test_', 'render_health_key'].join(''),
        EMAIL_FROM: 'soporte@quatriviumcredit.app',
        TELEGRAM_BOT: 'QuatriviumNotifyBot',
        TELEGRAM_BOT_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const waitStart = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker start timeout')), 12000);
        const onExit = (code) => {
          clearTimeout(timer);
          reject(new Error(`worker exited ${code}`));
        };
        const onData = (buf) => {
          if (String(buf).includes('Avisos Quatrivium')) {
            clearTimeout(timer);
            child.removeListener('exit', onExit);
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.once('exit', onExit);
      });
    try {
      await waitStart();
      const body = await new Promise((resolve, reject) => {
        http
          .get({ hostname: '127.0.0.1', port, path: '/health' }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, data }));
          })
          .on('error', reject);
      });
      expect(body.status).to.equal(200);
      const parsed = JSON.parse(body.data);
      expect(parsed.ok).to.equal(true);
      expect(parsed).to.not.have.property('chainId');
      expect(parsed).to.not.have.property('sms');
      expect(parsed).to.not.have.property('attester');
      expect(parsed).to.not.have.property('TEXTBELT_API_KEY');
      const rootBody = await new Promise((resolve, reject) => {
        http
          .get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, data }));
          })
          .on('error', reject);
      });
      expect(rootBody.status).to.equal(200);
      expect(JSON.parse(rootBody.data).health).to.equal('/health');
      const botBody = await new Promise((resolve, reject) => {
        http
          .get({ hostname: '127.0.0.1', port, path: '/telegram/bot' }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, data }));
          })
          .on('error', reject);
      });
      expect(botBody.status).to.equal(200);
      const botParsed = JSON.parse(botBody.data);
      expect(botParsed.bot).to.equal('QuatriviumNotifyBot');
      expect(botParsed).to.not.have.property('token');
      expect(botBody.data).to.not.include('TELEGRAM_BOT_TOKEN');
      expect(botBody.data).to.not.match(/\d{6,}:AA/);
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('boots on testnet without domain, Resend or attester and still answers /health', async function () {
    this.timeout(20000);
    const { spawn } = require('child_process');
    const http = require('http');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-render-bare-'));
    const dataFile = path.join(dir, '.notify-data.json');
    const port = 19787 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'notify-worker.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        NOTIFY_BIND: '127.0.0.1',
        NOTIFY_DATA_KEY: ['render-bare-key-', '32chars-ok!!'].join(''),
        NOTIFY_DATA_FILE: dataFile,
        EXPO_PUBLIC_CHAIN_ID: '97',
        EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET: '0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f',
        NOTIFY_CORS_ORIGIN: '*',
        TEXTBELT_API_KEY: ['paid-textbelt-', 'key-16'].join(''),
        RESEND_API_KEY: '',
        EMAIL_FROM: '',
        ATTESTER_PRIVATE_KEY: '',
        PRIVATE_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const waitStart = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker start timeout')), 12000);
        const onExit = (code) => {
          clearTimeout(timer);
          reject(new Error(`worker exited ${code}`));
        };
        const onData = (buf) => {
          if (String(buf).includes('Avisos Quatrivium')) {
            clearTimeout(timer);
            child.removeListener('exit', onExit);
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.once('exit', onExit);
      });
    try {
      await waitStart();
      const body = await new Promise((resolve, reject) => {
        http
          .get({ hostname: '127.0.0.1', port, path: '/health' }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, data }));
          })
          .on('error', reject);
      });
      expect(body.status).to.equal(200);
      const parsed = JSON.parse(body.data);
      expect(parsed.ok).to.equal(true);
      expect(parsed).to.not.have.property('chainId');
      expect(parsed).to.not.have.property('sms');
      expect(parsed).to.not.have.property('attester');
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('does not publish a Telegram token on GET /telegram/bot', async function () {
    this.timeout(20000);
    const { spawn } = require('child_process');
    const http = require('http');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-tg-token-'));
    const port = 20787 + Math.floor(Math.random() * 1000);
    const fakeToken = '123456789:AAHfakeTokenForTestsOnly000001';
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'notify-worker.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        NOTIFY_BIND: '127.0.0.1',
        NOTIFY_DATA_KEY: ['render-tg-key-', '32chars-ok!!'].join(''),
        NOTIFY_DATA_FILE: path.join(dir, '.notify-data.json'),
        EXPO_PUBLIC_CHAIN_ID: '97',
        EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET: '0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f',
        NOTIFY_CORS_ORIGIN: '*',
        TEXTBELT_API_KEY: ['paid-textbelt-', 'key-16'].join(''),
        TELEGRAM_BOT: fakeToken,
        EXPO_PUBLIC_TELEGRAM_BOT: fakeToken,
        TELEGRAM_BOT_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const waitStart = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker start timeout')), 12000);
        const onExit = (code) => {
          clearTimeout(timer);
          reject(new Error(`worker exited ${code}`));
        };
        const onData = (buf) => {
          if (String(buf).includes('Avisos Quatrivium')) {
            clearTimeout(timer);
            child.removeListener('exit', onExit);
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.once('exit', onExit);
      });
    try {
      await waitStart();
      const botBody = await new Promise((resolve, reject) => {
        http
          .get({ hostname: '127.0.0.1', port, path: '/telegram/bot' }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, data }));
          })
          .on('error', reject);
      });
      expect(botBody.status).to.equal(200);
      expect(botBody.data).to.not.include(fakeToken);
      expect(botBody.data).to.not.include('AAHfakeTokenForTestsOnly000001');
      expect(JSON.parse(botBody.data).bot).to.equal('');
    } finally {
      child.kill('SIGTERM');
    }
  });
});
