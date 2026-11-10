const path = require('path');
const { expect } = require('chai');
const { getAddress } = require('ethers');
const { loadTs } = require('./loadTsApp.cjs');

const invite = loadTs(path.join(__dirname, '..', 'utils', 'inviteCode.ts'));
const deep = loadTs(path.join(__dirname, '..', 'utils', 'appDeepLink.ts'));

describe('invitation scheme', function () {
  const wallet = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
  const code = invite.addressToInviteCode(wallet);
  const compact = code.replace(/-/g, '');

  it('accepts the sovereign scheme and the same invite format', function () {
    const link = invite.buildInviteLink(code, 'Ana');
    expect(link).to.equal(`quatrivium-sovereign://invite?c=${compact}&n=Ana`);
    expect(invite.parseInviteInput(link)).to.equal(getAddress(wallet));
    expect(invite.parseInviteInput(`quatrivium-sovereign://invite?c=${compact}`)).to.equal(
      getAddress(wallet)
    );
    expect(invite.parseInviteInput(`https://quatriviumcredit.app/invite?c=${compact}`)).to.equal(
      getAddress(wallet)
    );
    expect(deep.isAllowedAppUrl(`quatrivium-sovereign://room/credit?n=1`)).to.equal(true);
    expect(deep.parseAppDeepLink('quatrivium-sovereign://room/credit?n=1')).to.deep.equal({
      kind: 'room',
      room: 'credit',
    });
    expect(deep.parseAppDeepLink('quatrivium-sovereign://room/history')).to.deep.equal({
      kind: 'room',
      room: 'history',
    });
  });

  it('rejects the other app scheme and any other scheme', function () {
    const foreign = `quatrivium://invite?c=${compact}`;
    expect(invite.isInviteLink(foreign)).to.equal(false);
    expect(invite.parseInviteInput(foreign)).to.equal(null);
    expect(invite.extractInviteFromUrl(foreign)).to.equal(null);
    expect(deep.isAllowedAppUrl(foreign)).to.equal(false);
    expect(deep.parseAppDeepLink('quatrivium://room/credit')).to.equal(null);
    expect(deep.isAllowedAppUrl(`myapp://invite?c=${compact}`)).to.equal(false);
    expect(invite.parseInviteInput(`exp://invite?c=${compact}`)).to.equal(null);
    expect(deep.isAllowedAppUrl('https://evil.example/invite?c=' + compact)).to.equal(false);
    expect(invite.parseInviteInput('https://evil.example/invite?c=' + compact)).to.equal(null);
  });

  it('rejects invalid addresses and malformed links', function () {
    expect(invite.parseInviteInput('0x1234')).to.equal(null);
    expect(invite.parseInviteInput('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).to.equal(null);
    expect(invite.parseInviteInput('not-an-address')).to.equal(null);
    expect(invite.parseInviteInput('quatrivium-sovereign://invite')).to.equal(null);
    expect(invite.parseInviteInput('quatrivium-sovereign://invite?c=')).to.equal(null);
    expect(invite.parseInviteInput('quatrivium-sovereign://invite?c=ZZZZ')).to.equal(null);
    expect(invite.parseInviteInput(`quatrivium-sovereign://invite?c=0x1234`)).to.equal(null);
    expect(invite.parseInviteInput('quatrivium-sovereign://wallet?c=' + compact)).to.equal(null);
    expect(invite.parseInviteInput('quatrivium-sovereign:/invite?c=' + compact)).to.equal(null);
    expect(invite.buildInviteLink('short')).to.equal('');
    expect(deep.parseAppDeepLink('quatrivium-sovereign://')).to.equal(null);
    expect(deep.parseAppDeepLink('not a url')).to.equal(null);
  });
});
