const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { isTextbeltConfigured, sendTextbeltSms } = require('../scripts/textbeltSms.cjs');

describe('Textbelt OTP SMS', function () {
  const root = path.join(__dirname, '..');

  it('rejects the free one-sms-per-day key', function () {
    expect(isTextbeltConfigured('')).to.equal(false);
    expect(isTextbeltConfigured('textbelt')).to.equal(false);
    expect(isTextbeltConfigured('short')).to.equal(false);
    expect(isTextbeltConfigured('paid-textbelt-key-16')).to.equal(true);
  });

  it('posts the OTP body to textbelt.com without exposing the key in the URL', async function () {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ success: true, quotaRemaining: 40, textId: 't1' }),
      };
    };
    const result = await sendTextbeltSms('+584121234567', 'codigo 123456', {
      key: 'paid-textbelt-key-16',
      sender: 'Quatrivium',
      fetchImpl,
    });
    expect(result.ok).to.equal(true);
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal('https://textbelt.com/text');
    expect(String(calls[0].init.body)).to.include('phone=%2B584121234567');
    expect(String(calls[0].init.body)).to.include('codigo+123456');
    expect(String(calls[0].url)).to.not.include('paid-textbelt');
  });

  it('fails closed when Textbelt returns success=false', async function () {
    const result = await sendTextbeltSms('+15551234567', 'hola', {
      key: 'paid-textbelt-key-16',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ success: false, error: 'Out of quota' }),
      }),
    });
    expect(result.ok).to.equal(false);
    expect(result.error).to.include('quota');
  });

  it('wires Textbelt first in the worker, Render and production check', function () {
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const yaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
    const check = fs.readFileSync(path.join(root, 'scripts', 'check-production.mjs'), 'utf8');
    const docker = fs.readFileSync(path.join(root, 'Dockerfile.notify'), 'utf8');
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    const admin = fs.readFileSync(path.join(root, 'components', 'AdminPanel.tsx'), 'utf8');
    const phone = fs.readFileSync(path.join(root, 'services', 'phoneOtp.ts'), 'utf8');
    const email = fs.readFileSync(path.join(root, 'services', 'emailOtp.ts'), 'utf8');
    expect(worker).to.include("via: 'textbelt'");
    expect(worker.indexOf('sendTextbelt')).to.be.below(worker.indexOf('sendSms(phone, text)'));
    expect(yaml).to.match(/TEXTBELT_API_KEY[\s\S]*sync: false/);
    expect(yaml).to.match(/RESEND_API_KEY[\s\S]*sync: false/);
    expect(yaml).to.include('scripts/textbeltSms.cjs');
    expect(check).to.include('isTextbeltConfigured');
    expect(docker).to.include('textbeltSms.cjs');
    expect(eas.build.preview.env.EXPO_PUBLIC_NOTIFY_API).to.equal(
      'https://notify.quatriviumcredit.app'
    );
    expect(eas.build.production.env.EXPO_PUBLIC_NOTIFY_API).to.equal(
      'https://notify.quatriviumcredit.app'
    );
    expect(eas.build.development.env.EXPO_PUBLIC_NOTIFY_API || '').to.equal('');
    expect(admin).to.not.include('TEXTBELT');
    expect(admin).to.not.include('RESEND');
    expect(phone).to.include('/otp/request');
    expect(phone).to.not.include('textbelt');
    expect(email).to.include('/email/request');
    expect(email).to.not.include('resend.com');
  });
});
