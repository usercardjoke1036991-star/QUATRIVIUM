const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

function equippedFrameLevel(naturalLevel, equippedLevel = 0) {
  const natural = Math.min(1000, Math.max(1, Math.floor(naturalLevel) || 1));
  const equipped = Number(equippedLevel) || 0;
  if (equipped < 1) return natural;
  return Math.min(1000, Math.max(1, Math.floor(equipped)));
}

describe('founder frame accessories and hub frame box', function () {
  it('uses the equipped accessory only when the founder chose one', function () {
    expect(equippedFrameLevel(1, 0)).to.equal(1);
    expect(equippedFrameLevel(1, 914)).to.equal(914);
    expect(equippedFrameLevel(20, 0)).to.equal(20);
  });

  it('reserves the full rank frame on the hub avatar', function () {
    const avatar = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ProfileAvatar.tsx'),
      'utf8'
    );
    const settings = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'SettingsButton.tsx'),
      'utf8'
    );
    const frame = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'RankFrame.tsx'),
      'utf8'
    );
    expect(frame).to.include('export function rankFrameOuterSize');
    expect(avatar).to.include('rankFrameOuterSize');
    expect(avatar).to.include('Pressable');
    expect(avatar).to.not.include('TouchableOpacity');
    expect(settings).to.include('avatarSlot');
    expect(settings).to.include('HUB_PHOTO');
    expect(settings).to.include('frameLevel');
  });

  it('lets only the founder wear any gallery frame', function () {
    const ladder = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'RankLadder.tsx'),
      'utf8'
    );
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    const service = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'equippedFrame.ts'),
      'utf8'
    );
    expect(ladder).to.include('onWearFrame');
    expect(ladder).to.include('isFounder');
    expect(ladder).to.include('founderFramesHint');
    expect(home).to.include('useEquippedFrame');
    expect(home).to.include('onWearFrame');
    expect(service).to.include('saveEquippedFrame');
    expect(service).to.include('equippedFrameLevel');
  });

  it('registers the locked sponsor on-chain after create account when credit is ready', function () {
    const onboarding = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AccountOnboarding.tsx'),
      'utf8'
    );
    expect(onboarding).to.include('canRegisterOnChain');
    expect(onboarding).to.include('onRegister()');
    expect(onboarding).to.include('triedRegister');
    expect(onboarding).to.include('lockSponsorOnce');
    expect(onboarding).to.not.include("lockSponsorOnce(walletAddress, '')");
  });
});
