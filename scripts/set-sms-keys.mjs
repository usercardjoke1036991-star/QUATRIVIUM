/**
 * Guarda Textbelt o Twilio en .env.worker y .env sin imprimir secretos.
 * Uso:
 *   node scripts/set-sms-keys.mjs --textbelt CLAVE_DE_PAGO
 *   node scripts/set-sms-keys.mjs --sid ACxxx --token xxxx --from +15551234567
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { isTextbeltConfigured } = createRequire(import.meta.url)('./textbeltSms.cjs');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return '';
  return String(process.argv[index + 1] || '').trim();
}

function upsert(filePath, key, value) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${key}=${value}\n`, 'utf8');
    return;
  }
  const original = readFileSync(filePath, 'utf8');
  const lines = original.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (next.length && next[next.length - 1] === '') next[next.length - 1] = `${key}=${value}`;
    else next.push(`${key}=${value}`);
    if (next[next.length - 1] !== '') next.push('');
  }
  writeFileSync(filePath, next.join('\n'), 'utf8');
}

const textbelt = arg('textbelt') || process.env.TEXTBELT_API_KEY || '';
const sid = arg('sid') || process.env.TWILIO_ACCOUNT_SID || '';
const token = arg('token') || process.env.TWILIO_AUTH_TOKEN || '';
const from = arg('from') || process.env.TWILIO_FROM || '';
const wantTwilio = Boolean(arg('sid') || arg('token') || arg('from'));
const wantTextbelt = Boolean(arg('textbelt') || (!wantTwilio && textbelt));

if (!wantTextbelt && !wantTwilio && !sid) {
  console.error('Pase --textbelt CLAVE (recomendado) o --sid/--token/--from de Twilio.');
  process.exit(1);
}

const root = resolve(process.cwd());
const files = [resolve(root, '.env.worker'), resolve(root, '.env')];

if (wantTextbelt || (textbelt && !wantTwilio)) {
  if (!isTextbeltConfigured(textbelt)) {
    console.error(
      'Use la clave de pago de Textbelt (mín. 8). No sirva la palabra "textbelt" (1 SMS/día).'
    );
    process.exit(1);
  }
  for (const file of files) upsert(file, 'TEXTBELT_API_KEY', textbelt);
  console.log('Textbelt guardado en .env.worker y .env (la clave no se imprime).');
}

if (wantTwilio) {
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
    console.error('Falta --sid ACxxxxxxxx (Account SID de Twilio).');
    process.exit(1);
  }
  if (token.length < 16) {
    console.error('Falta --token (Auth Token de Twilio).');
    process.exit(1);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(from)) {
    console.error('Falta --from en formato internacional, ej. +15551234567');
    process.exit(1);
  }
  for (const file of files) {
    upsert(file, 'TWILIO_ACCOUNT_SID', sid);
    upsert(file, 'TWILIO_AUTH_TOKEN', token);
    upsert(file, 'TWILIO_FROM', from);
  }
  console.log('Twilio guardado en .env.worker y .env (SID y token no se imprimen).');
}

console.log('Siguiente: pegue la misma TEXTBELT_API_KEY en Render y npm run notify.');
