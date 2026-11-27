// zlib es un módulo de Node.js — no existe en React Native.
// ws@8.x lo importa en permessage-deflate.js (compresión WebSocket).
// La app no abre WebSocket ni usa la compresión deflate,
// así que este stub es seguro.
module.exports = {
  createDeflateRaw: () => null,
  createInflateRaw: () => null,
  Z_DEFAULT_COMPRESSION: -1,
  Z_DEFAULT_WINDOWBITS: 15,
};
