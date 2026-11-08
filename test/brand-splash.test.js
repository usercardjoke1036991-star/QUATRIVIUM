const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

describe('brand splash and institutional copy', function () {
  it('shows a branded entrance instead of a blank first frame', function () {
    const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
    expect(app).to.include('BrandSplash');
    expect(app).to.include('BRAND_HOLD_MS');
    expect(app).to.include('<BrandSplash />');
    expect(app).to.include('<BrandSplash tagline={');
    expect(app).to.not.include('wordmark={false}');
    expect(app).to.not.match(/if \(!fontsLoaded && !fontWaitOver\) \{\s*return null;/);
    const splash = fs.readFileSync(path.join(root, 'components', 'BrandSplash.tsx'), 'utf8');
    expect(splash).to.include('wordmark = true');
    expect(splash).to.include('QUATRIVIUM');
    expect(splash).to.include('FINANCE');
    expect(splash).to.include('#07150F');
    expect(splash).to.include('letterSpacing: 5');
    expect(splash).to.not.match(/fontWeight/);
    expect(splash).to.not.match(/textTransform/);
  });

  it('keeps user-facing Spanish in usted and without padrino', function () {
    const es = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'locales', 'es.json'), 'utf8'));
    expect(es.splashTagline).to.match(/Arbitrum One/);
    expect(es.sectionPoolLead).to.match(/su saldo/);
    expect(es.sectionPoolLead).to.not.match(/\btu saldo\b/i);
    expect(es.poolPublicLead).to.match(/no se (puede )?retirar/i);
    expect(es.bonusPending).to.not.match(/padrino/i);
    expect(es.referralHint).to.not.match(/padrino/i);
    expect(es.guideNetworkBody).to.not.match(/padrino/i);
    expect(es.linkWalletSignNeed).to.equal(
      'Confirme en su billetera para completar la vinculación. Conectarla no basta.'
    );
  });
});
