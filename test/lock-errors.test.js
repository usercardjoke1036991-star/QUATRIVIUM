const path = require('path');
const { expect } = require('chai');
const { loadTs } = require('./loadTsApp.cjs');

const es = require('../i18n/locales/es.json');
const errors = loadTs(path.join(__dirname, '..', 'utils', 'lockErrors.ts'));

function t(key) {
  return es[key];
}

describe('lock error text', function () {
  it('names a slow keychain, an unknown store and a failed save, and keeps a weak password weak', function () {
    expect(errors.passwordFailText(new Error('keychain-timeout'), t), 'keychain').to.equal(
      'El llavero no responde. Intente de nuevo.'
    );
    expect(errors.passwordFailText(new Error('store-unknown'), t), 'store').to.equal(
      'Almacenamiento no disponible. Intenta de nuevo.'
    );
    expect(errors.passwordFailText(new Error('password-persist'), t), 'persist').to.equal(
      'No se pudo guardar la cuenta en este teléfono. Intente de nuevo.'
    );
    expect(errors.passwordFailText(new Error('weak-password'), t), 'debil').to.equal(
      '8 a 66 caracteres, con mayúscula, número y símbolo.'
    );
  });
});
