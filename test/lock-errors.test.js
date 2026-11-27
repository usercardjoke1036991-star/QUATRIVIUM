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
      'Almacenamiento no disponible. Intente de nuevo.'
    );
    expect(errors.passwordFailText(new Error('password-persist'), t), 'persist').to.equal(
      'No se pudo guardar la cuenta en este teléfono. Intente de nuevo.'
    );
    expect(errors.passwordFailText(new Error('password-locked'), t), 'bloqueo').to.equal(
      'La contraseña de este teléfono ya no se cambia.'
    );
    expect(errors.passwordFailText(new Error('weak-password'), t), 'debil').to.equal(
      '8 a 66 caracteres, con mayúscula, número y símbolo.'
    );
  });

  it('does not treat a locked password as a store failure', function () {
    expect(errors.lockStoreFailureText('password-locked', t), 'cerrada').to.equal(null);
  });

  it('says a locked password expired when restoring', function () {
    expect(errors.restoreFailText('password-locked', t), 'restaurar').to.equal(
      'La solicitud local caducó. Inténtelo de nuevo.'
    );
    expect(errors.restoreFailText('keychain-timeout', t), 'keychain').to.equal(
      'El llavero no responde. Intente de nuevo.'
    );
    expect(errors.restoreFailText('store-unknown', t), 'store').to.equal(
      'Almacenamiento no disponible. Intente de nuevo.'
    );
    expect(errors.restoreFailText('password-persist', t), 'persist').to.equal(
      'No se pudo guardar la cuenta en este teléfono. Intente de nuevo.'
    );
    expect(errors.restoreFailText('wallet-other-app', t), 'otra').to.equal(
      'Esa frase pertenece a otra cuenta de este dispositivo.'
    );
    expect(errors.restoreFailText('phrase', t), 'frase').to.equal(
      'Frase no válida. Use 24 palabras, o 12 si la cuenta es antigua.'
    );
    expect(errors.restoreFailText('wallet-persist', t), 'guardar').to.equal(
      'No se pudo guardar la cuenta en este teléfono. Intente de nuevo.'
    );
    expect(errors.restoreFailText('device-bound', t), 'equipo').to.equal(
      'Este dispositivo ya tiene una cuenta activa.'
    );
    expect(errors.restoreFailText('otro', t), 'otro').to.equal('No se pudo abrir la billetera.');
  });
});
