const { expect } = require('chai');

describe('admin TOTP', function () {
  it('acepta el codigo de 6 digitos y rechaza otro', async function () {
    const { generateAdminTotpSecret, totpAt, verifyAdminTotp, adminTotpUrl } = await import(
      '../scripts/adminTotp.mjs'
    );
    const secret = generateAdminTotpSecret();
    const now = 1_704_000_000_000;
    const code = totpAt(secret, now);
    expect(code).to.match(/^\d{6}$/);
    expect(verifyAdminTotp(secret, code, now)).to.equal(true);
    expect(verifyAdminTotp(`${secret}====`, code, now)).to.equal(true);
    expect(verifyAdminTotp(secret, '000000', now)).to.equal(false);
    expect(adminTotpUrl(secret, '0xabc')).to.include('otpauth://totp/');
  });
});
