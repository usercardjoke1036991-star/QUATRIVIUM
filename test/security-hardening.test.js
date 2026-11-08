const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('defensive security hardening', function () {
  const root = path.join(__dirname, '..');

  it('never stores or returns a wallet wrap from the notify worker', function () {
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const recovery = fs.readFileSync(path.join(root, 'services', 'passwordRecovery.ts'), 'utf8');
    expect(worker).to.include('sanitizeLoadedStore');
    expect(worker).to.include('next.recoveryWraps = {}');
    expect(worker).to.not.include('json(res, 200, { wrap })');
    expect(worker).to.not.match(/recoveryWraps\[emailHash\] = \{ wallet: authn\.wallet, wrap \}/);
    expect(recovery).to.not.include('wrap,');
    expect(recovery).to.include("throw new Error('device')");
    expect(recovery).to.include('loadLocalRecoveryWrap');
    expect(recovery).to.include('RECOVER_ATTEMPTS = 3');
    expect(recovery).to.include('RECOVER_WAIT_MS = 60_000');
    expect(recovery).to.include("throw new Error('day')");
    expect(recovery).to.include("throw new Error('cooldown')");
    expect(worker).to.include('RECOVER_DAY_ATTEMPTS = 3');
    expect(worker).to.include('RECOVER_SEND_WAIT_MS = 60 * 1000');
    expect(worker).to.include("error: 'day'");
    expect(worker).to.include("error: 'cooldown'");
    expect(worker).to.not.include('pwrecover-addr:');
    expect(recovery).to.include('persistLocalRecoveryWrap');
    expect(recovery).to.include('if (body.wrap)');
  });

  it('requires a signed wallet for testnet auto-fund and drops the owner key on a public bind', function () {
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const auth = fs.readFileSync(path.join(root, 'services', 'walletAuth.ts'), 'utf8');
    const home = fs.readFileSync(path.join(root, 'hooks', 'useHomeHandlers.ts'), 'utf8');
    const charge = fs.readFileSync(path.join(root, 'services', 'founderUsdtCharge.ts'), 'utf8');
    expect(worker).to.include("purpose !== 'autofund'");
    expect(worker).to.include("String(body.purpose) !== 'autofund'");
    expect(worker).to.include(
      "ATTESTER_EXPLICIT || (!isMainnet && !publicAttesterHost ? DEPLOY_KEY : '')"
    );
    expect(auth).to.include("| 'autofund'");
    expect(home).to.include("signedAuthBody(signer, address, 'autofund')");
    expect(charge).to.include("signedAuthBody(signer, address, 'autofund')");
  });

  it('approves remaining loan debt instead of MaxUint256 and clears phone claims on release', function () {
    const service = fs.readFileSync(
      path.join(root, 'services', 'quatriviumCreditService.ts'),
      'utf8'
    );
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const reserva = fs.readFileSync(path.join(root, 'contracts', 'QuatriviumReserva.sol'), 'utf8');
    expect(service).to.not.include('MaxUint256');
    expect(service).to.include('obtenerDeuda(userAddress)');
    expect(service).to.include('remaining.toString()');
    expect(worker).to.include('delete store.phoneClaims[oldPhoneHash]');
    expect(reserva).to.include('if (msg.sender != credit) revert NoAutorizado()');
    expect(reserva).to.include('CAMBIO_ESPERA = 72 hours');
    expect(reserva).to.include('function acceptOwner()');
    expect(reserva).to.include('function applyCredit()');
  });

  it('binds EIP-712 purpose to each notify route before consuming replay', function () {
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const wallet = fs.readFileSync(path.join(root, 'services', 'appWallet.ts'), 'utf8');
    const funds = fs.readFileSync(path.join(root, 'components', 'FundsConfirmHost.tsx'), 'utf8');
    const reserva = fs.readFileSync(path.join(root, 'contracts', 'QuatriviumReserva.sol'), 'utf8');
    expect(worker).to.include("requireAuth(body, ['perfil'])");
    expect(worker).to.include("requireAuth(body, ['otp'])");
    expect(worker).to.include("requireAuth(body, ['autofund'])");
    expect(worker).to.include('void persist()');
    expect(worker).to.include('writeAtomic');
    expect(worker).to.include('allowDemoIdentity');
    expect(worker).to.include(
      "process.env.NOTIFY_TRUST_PROXY === '1' || Boolean(process.env.RENDER)"
    );
    expect(worker).to.include('autofund-day');
    expect(worker).to.include("error: 'cooldown'");
    expect(worker).to.include("rejectBody(new Error('json'))");
    expect(wallet).to.include('SecureStore.getItemAsync(WALLET_KEY)');
    expect(wallet).to.include('AsyncStorage.removeItem(WALLET_FALLBACK)');
    expect(funds).to.include('checkPin');
    expect(funds).to.include('checkPassword');
    expect(funds).to.not.include('matchPin');
    expect(funds).to.not.include('matchPassword');
    expect(reserva).to.include('function applyFundador()');
    expect(reserva).to.include('pendienteFundador');
  });

  it('clears Snyk mediums that are not real passwords or open redirects', function () {
    const policy = fs.readFileSync(path.join(root, 'utils', 'passwordPolicy.ts'), 'utf8');
    const landing = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const aprender = fs.readFileSync(path.join(root, 'aprender_error.py'), 'utf8');
    const safeIo = fs.readFileSync(path.join(root, 'qa_safe_io.py'), 'utf8');
    expect(policy).to.include('GENERATED_SECRET_CHARS');
    expect(policy).to.not.include('PASSWORD_ALPHABET');
    expect(landing).to.include('encodeURIComponent(code)');
    expect(landing).to.not.include('+ location.search');
    expect(worker).to.include('javascript:S5332');
    expect(aprender).to.include('len(patron) > 120');
    expect(safeIo).to.include('def under_root');
    const plugin = fs.readFileSync(
      path.join(root, 'plugins', 'withQuatriviumAndroidSecurity.js'),
      'utf8'
    );
    expect(plugin).to.include("indexOf('<data'");
    expect(plugin).to.not.include('android:scheme="exp+[^"]*"');
  });

  it('leaves Sumsub ready behind Render env and does not put secrets in the admin panel', function () {
    const worker = fs.readFileSync(path.join(root, 'scripts', 'notify-worker.mjs'), 'utf8');
    const panel = fs.readFileSync(path.join(root, 'components', 'AdminPanel.tsx'), 'utf8');
    const kyc = fs.readFileSync(path.join(root, 'components', 'KycSection.tsx'), 'utf8');
    expect(worker).to.include('kycProvider: hasKycProvider');
    expect(worker).to.include("path === '/kyc/provider-token'");
    expect(worker).to.not.include('attesterKms: false');
    expect(panel).to.not.include('SUMSUB_');
    expect(kyc).to.include('openKycProvider');
  });
});
