const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('Hetzner notify worker pack', function () {
  const root = path.join(__dirname, '..');

  it('does not publish the worker port and terminates TLS at Caddy', function () {
    const compose = fs.readFileSync(
      path.join(root, 'deploy', 'hetzner', 'docker-compose.yml'),
      'utf8'
    );
    const caddy = fs.readFileSync(path.join(root, 'deploy', 'hetzner', 'Caddyfile'), 'utf8');
    const deploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-hetzner.mjs'), 'utf8');
    expect(compose).to.include('NOTIFY_TRUST_PROXY');
    expect(compose).to.include('user: "0:0"');
    expect(compose).to.include('expose:');
    expect(compose).to.not.match(/8787:8787/);
    expect(compose).to.match(/["']80:80["']/);
    expect(compose).to.match(/["']443:443["']/);
    expect(caddy).to.include('reverse_proxy notify:8787');
    expect(deploy).to.include('HETZNER_HOST');
    expect(deploy).to.include('textbeltSms.cjs');
    expect(deploy).to.not.include('console.log(env');
  });

  it('keeps worker secrets out of git', function () {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(ignore).to.include('.env.worker');
    expect(ignore).to.include('deploy/hetzner/.env');
  });
});
