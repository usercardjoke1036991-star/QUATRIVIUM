const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { getAddress } = require('ethers');
const { loadTs } = require('./loadTsApp.cjs');

const real = loadTs(path.join(__dirname, '..', 'utils', 'inviteCode.ts'));

describe('invite code and link', function () {
  const wallet = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
  const grouped = real.addressToInviteCode(wallet);
  const compact = grouped.replace(/-/g, '');
  const spaced = grouped.replace(/-/g, ' ');

  it('accepts dashes, spaces and the sovereign invite URL as the same sponsor', function () {
    expect(grouped).to.match(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(real.parseInviteInput(grouped)).to.equal(getAddress(wallet));
    expect(real.parseInviteInput(spaced)).to.equal(getAddress(wallet));
    expect(real.parseInviteInput(`  ${spaced}  `)).to.equal(getAddress(wallet));
    expect(real.parseInviteInput(compact)).to.equal(getAddress(wallet));
    expect(real.parseInviteInput(`quatrivium-sovereign://invite?c=${compact}`)).to.equal(
      getAddress(wallet)
    );
    expect(real.parseInviteInput(`quatrivium://invite?c=${compact}`)).to.equal(null);
    expect(real.parseInviteInput(`https://quatriviumcredit.app/invite?c=${compact}`)).to.equal(
      getAddress(wallet)
    );
  });

  it('text: keeps the public HTTPS invite and a copyable card in the network screen', function () {
    const codec = fs.readFileSync(path.join(__dirname, '..', 'utils', 'inviteCode.ts'), 'utf8');
    const ui = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReferralSection.tsx'),
      'utf8'
    );
    const onboarding = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AccountOnboarding.tsx'),
      'utf8'
    );
    expect(codec).to.include('INVITE_WEB_BASE');
    expect(codec).to.include('/invite?c=');
    expect(codec).to.include('://invite?c=');
    expect(codec).to.include('inviteLinkPreview');
    expect(codec).to.include('parseInviteInput');
    expect(codec).to.include('extractInviteFromUrl');
    expect(codec).to.include('extractInviteFromText');
    expect(ui).to.include('refreshDirectory([padre])');
    expect(ui).to.include('publicView');
    expect(ui).to.include('inviteLinkLabel');
    expect(ui).to.include('copyInviteLink');
    expect(ui).to.include('inviteLinkPreview');
    expect(onboarding).to.include('resolveSponsorInput');
  });
});
