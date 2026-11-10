/**
 * Falla si el repo vuelve a nombrar un servicio que la app ya no usa.
 * La lista vive aquí y este archivo no se escanea a sí mismo.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const needles = [
  'onrender.com',
  'render.yaml',
  'render-notify',
  'fly.io',
  'fly.toml',
  'hetzner',
  'telegram',
  'binance',
  'resend.com',
  'resend_api',
  'namecheap',
  'textbelt',
  'twilio',
  'whatsapp',
  'sumsub',
  'play.google',
  'play store',
  'google play',
  'expo-updates',
];

const skipDir = new Set([
  'node_modules',
  '.git',
  'artifacts',
  'cache',
  'coverage',
  'dist',
  'forge-out',
  'forge-cache',
  'android',
  'ios',
  '.expo',
  'lib',
]);

const selfName = 'check-external-services.mjs';
const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDir.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.name === 'package-lock.json' || entry.name === selfName) continue;
    const rel = path.relative(root, full);
    if (needles.some((needle) => entry.name.toLowerCase().includes(needle))) {
      hits.push(`${rel}: nombre de archivo`);
    }
    if (/\.(png|jpg|jpeg|webp|gif)$/i.test(entry.name)) continue;
    let text = '';
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const hay = line.toLowerCase();
      for (const needle of needles) {
        if (hay.includes(needle)) {
          hits.push(`${rel}:${index + 1}: ${needle}`);
          break;
        }
      }
    });
  }
}

walk(root);
if (hits.length) {
  console.error(`Servicios externos prohibidos: ${hits.length}`);
  for (const hit of hits) console.error(hit);
  process.exit(1);
}
console.log('ok sin servicios externos prohibidos');
