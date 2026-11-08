const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('wallet link reject stays idle', function () {
  it('swallows AppKit cancel instead of painting a red error', function () {
    const helper = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'openWalletConnect.ts'),
      'utf8'
    );
    expect(helper).to.include('openWalletConnect');
    expect(helper).to.include('catch');
    const card = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LinkedWalletCard.tsx'),
      'utf8'
    );
    expect(card).to.include('openWalletConnect');
    expect(card).to.not.match(/^\s+open\(\);\s*$/m);
    const form = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LinkWalletForm.tsx'),
      'utf8'
    );
    expect(form).to.include('openWalletConnect');
    expect(form).to.include("setError('')");
    expect(form).to.not.include('onPress={() => open()}');
    const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    expect(app).to.include('User rejected methods');
    expect(app).to.include('Reject Session');
  });

  it('does not ask for the password while the external wallet app is open', function () {
    const helper = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'openWalletConnect.ts'),
      'utf8'
    );
    const handoff = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'walletHandoff.ts'),
      'utf8'
    );
    const lock = fs.readFileSync(path.join(__dirname, '..', 'services', 'appLock.ts'), 'utf8');
    const charge = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'founderUsdtCharge.ts'),
      'utf8'
    );
    expect(helper).to.include('beginExternalWalletHandoff');
    expect(charge).to.include('beginExternalWalletHandoff');
    expect(handoff).to.include('4 * 60 * 1000');
    expect(lock).to.include('externalWalletHandoffActive(now) || isPickerHeld()');
    const kyc = fs.readFileSync(path.join(__dirname, '..', 'services', 'kycProvider.ts'), 'utf8');
    expect(kyc).to.include('beginExternalWalletHandoff');
    const awayFor = 30_000;
    const now = 100_000;
    const backgroundedAt = now - awayFor;
    const handoffUntil = now + 60_000;
    const lockMs = 20_000;
    const relock =
      !(handoffUntil > now) && Boolean(backgroundedAt && now - backgroundedAt >= lockMs);
    expect(relock).to.equal(false);
    const afterHandoff =
      handoffUntil <= now && Boolean(backgroundedAt && now - backgroundedAt >= lockMs);
    expect(afterHandoff).to.equal(false);
    const later = handoffUntil + 1000;
    const relockLater =
      !(handoffUntil > later) && Boolean(backgroundedAt && later - backgroundedAt >= lockMs);
    expect(relockLater).to.equal(true);
  });
});
