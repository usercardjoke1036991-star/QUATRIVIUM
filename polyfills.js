/**
 * Web3 Polyfills for React Native
 *
 * This file provides essential polyfills for Web3 libraries to work in React Native environment.
 * It must be imported before any other application code in index.js
 */

const { Buffer } = require('buffer');
const { TextEncoder, TextDecoder } = require('text-encoding');
const { Readable } = require('readable-stream');
const EventEmitter = require('events');

// Buffer polyfill - Required for ethers.js and other Web3 libraries
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// TextEncoder/TextDecoder polyfill - Required for Web3 cryptographic operations
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

// Readable stream polyfill - Required by Web3 libraries on React Native
if (typeof global.Readable === 'undefined') {
  global.Readable = Readable;
}

// EventEmitter polyfill - Required for many Web3 libraries
if (typeof global.EventEmitter === 'undefined') {
  global.EventEmitter = EventEmitter;
}

// Process polyfill - Some Web3 libraries expect process object
if (typeof global.process === 'undefined') {
  global.process = {
    env: {},
    version: '',
    platform: 'react-native',
    nextTick: (fn) => setTimeout(fn, 0),
  };
}

// setImmediate polyfill - Required for some async operations
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (fn) => setTimeout(fn, 0);
}

// clearImmediate polyfill
if (typeof global.clearImmediate === 'undefined') {
  global.clearImmediate = (id) => clearTimeout(id);
}

// console polyfill enhancements - Ensure console methods exist
if (typeof console.log === 'undefined') {
  console.log = () => {};
}
if (typeof console.warn === 'undefined') {
  console.warn = () => {};
}
if (typeof console.error === 'undefined') {
  console.error = () => {};
}

// Uint8Array polyfill for older React Native versions
if (typeof Uint8Array === 'undefined') {
  global.Uint8Array = Array;
}

// Performance polyfill - Required for some timing operations
if (typeof global.performance === 'undefined') {
  global.performance = {
    now: () => Date.now(),
  };
}

// Crypto polyfill placeholder - React Native uses expo-crypto for actual crypto operations
// This is a placeholder to prevent crashes when libraries check for global.crypto
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
  // Note: Actual crypto operations should use expo-crypto
  // This is just to prevent crashes from library checks
}

// Web3-specific global objects
if (typeof global.Web3 === 'undefined') {
  global.Web3 = {};
}

// Ensure global scope has necessary properties for Web3 libraries
if (typeof global.self === 'undefined') {
  global.self = global;
}

if (typeof global.window === 'undefined') {
  global.window = global;
}

// Module polyfill for CommonJS/ESM compatibility
if (typeof global.module === 'undefined') {
  global.module = {};
}

if (typeof global.exports === 'undefined') {
  global.exports = {};
}

// Btoa/Atob polyfill - Required for base64 encoding/decoding in Web3
if (typeof global.btoa === 'undefined') {
  global.btoa = (str) => {
    return Buffer.from(str, 'binary').toString('base64');
  };
}

if (typeof global.atob === 'undefined') {
  global.atob = (str) => {
    return Buffer.from(str, 'base64').toString('binary');
  };
}

// AbortController polyfill - Required for fetch operations
if (typeof global.AbortController === 'undefined') {
  global.AbortController = class AbortController {
    constructor() {
      this.signal = { aborted: false };
      this._abort = false;
    }

    abort() {
      this._abort = true;
      this.signal.aborted = true;
    }
  };
}

// AbortSignal polyfill
if (typeof global.AbortSignal === 'undefined') {
  global.AbortSignal = class AbortSignal {
    static timeout(ms) {
      const controller = new global.AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    }
  };
}

// URL polyfill - Required for Web3 provider connections
if (typeof global.URL === 'undefined') {
  global.URL = class URL {
    constructor(url, base) {
      // Basic URL implementation
      this.href = url;
      this.origin = base || '';
    }
  };
}

// URLSearchParams polyfill
if (typeof global.URLSearchParams === 'undefined') {
  global.URLSearchParams = class URLSearchParams {
    constructor(init) {
      this.params = {};
      if (typeof init === 'string') {
        // Parse query string
        init.split('&').forEach((pair) => {
          const [key, value] = pair.split('=');
          if (key) this.params[decodeURIComponent(key)] = decodeURIComponent(value || '');
        });
      } else if (typeof init === 'object') {
        Object.assign(this.params, init);
      }
    }

    append(name, value) {
      this.params[name] = value;
    }

    get(name) {
      return this.params[name];
    }

    toString() {
      return Object.entries(this.params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    }
  };
}

console.log('✅ Web3 polyfills loaded successfully');
