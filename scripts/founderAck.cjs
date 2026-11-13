const FOUNDER_WALLET_WARNING =
  'La dirección de fundador debe ser una billetera de varias firmas o una billetera física con respaldo. Si se pierde esa llave, nadie publica hashes del APK ni cobra la parte del fundador.';

function founderWalletAck(env = process.env) {
  const accepted = env.CONFIRM_FOUNDER_WALLET === 'yes';
  return { ok: accepted, warning: FOUNDER_WALLET_WARNING };
}

module.exports = { FOUNDER_WALLET_WARNING, founderWalletAck };
