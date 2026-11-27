// Arranque: lo que antes cargaba el paquete de compatibilidad de la billetera externa y la app sí usa.
// URL completa (WHATWG), TextEncoder/TextDecoder, getRandomValues, Buffer, atob y btoa.
// Mismos paquetes y mismo orden que antes, sin red ni servicios externos.
import 'fast-text-encoding';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
if (typeof global.btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof global.atob === 'undefined') {
  global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}
