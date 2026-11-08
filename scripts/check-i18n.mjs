import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'locales');
const langs = [
  'es',
  'en',
  'zh',
  'hi',
  'ar',
  'bn',
  'pt',
  'ru',
  'ur',
  'id',
  'fr',
  'ja',
  'de',
  'ko',
  'tr',
  'vi',
  'it',
];
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const keys = Object.keys(en).sort((a, b) => a.localeCompare(b));
const placeholders = /\{[a-zA-Z]+\}/g;
let failed = false;

function isWordChar(ch) {
  return Boolean(ch) && /[0-9A-Za-z_]/.test(ch);
}

function skipSpace(text, index) {
  let j = index;
  while (
    j < text.length &&
    (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')
  ) {
    j += 1;
  }
  return j;
}

/** 1/2/4 USDT o 4-USDT, sin cuantificadores anidados. */
function hasUsdtAmount(text, digits, bounded) {
  const lower = String(text).toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    if (!digits.includes(lower[i])) continue;
    if (bounded && isWordChar(lower[i - 1])) continue;
    let j = skipSpace(lower, i + 1);
    if (lower[j] === '-') j = skipSpace(lower, j + 1);
    if (lower.slice(j, j + 4) !== 'usdt') continue;
    if (bounded && isWordChar(lower[j + 4])) continue;
    return true;
  }
  return false;
}

const OBSOLETE_ACCESS = [
  'alta de 1 usdt',
  'alta de 2 usdt',
  'acceso de 1 usdt',
  'acceso de 2 usdt',
  '1 usdt de acceso',
  '2 usdt de acceso',
  'one-time 1 usdt access',
  'one-time 2 usdt access',
  'a single 1 usdt access',
  'a single 2 usdt access',
];

function hasObsoleteAccess(text) {
  const lower = String(text).toLowerCase();
  return OBSOLETE_ACCESS.some((phrase) => lower.includes(phrase));
}

for (const lang of langs) {
  const file = path.join(dir, `${lang}.json`);
  if (!fs.existsSync(file)) {
    console.error(`MISSING ${lang}.json`);
    failed = true;
    continue;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const got = Object.keys(data).sort((a, b) => a.localeCompare(b));
  if (got.join() !== keys.join()) {
    const missing = keys.filter((k) => !got.includes(k));
    const extra = got.filter((k) => !keys.includes(k));
    console.error(`${lang} key mismatch missing=${missing.length} extra=${extra.length}`);
    if (missing[0]) console.error('  missing sample', missing.slice(0, 8));
    failed = true;
  }
  let empty = 0;
  let copied = 0;
  for (const key of keys) {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim()) empty += 1;
    const enVal = en[key];
    const enPh = (enVal.match(placeholders) || []).sort().join();
    const ph = String(value || '').match(placeholders) || [];
    if (ph.sort().join() !== enPh) {
      console.error(`${lang}.${key} placeholder mismatch`);
      failed = true;
    }
    if (lang !== 'en' && value === enVal && enVal.length > 24) copied += 1;
    const englishBits =
      String(value || '').match(
        /\b(the|your|you|with|this|that|only|will|have|password|required|account)\b/gi
      ) || [];
    if (lang !== 'en' && englishBits.length >= 4) {
      console.error(`${lang}.${key} still reads as English`);
      failed = true;
    }
    if (/EXPO_PUBLIC_|CONFIRM_MAINNET|PRIVATE_KEY|TEXTBELT/.test(String(value || ''))) {
      console.error(`${lang}.${key} leaks internal token`);
      failed = true;
    }
  }
  if (empty) {
    console.error(`${lang} empty=${empty}`);
    failed = true;
  }
  if (copied) {
    console.error(`${lang} leftover English sentences=${copied}`);
    failed = true;
  }
  if (/fundador|founder|Gründer|fondateur|основател/i.test(String(data.reservaFounderNote || ''))) {
    console.error(`${lang} reservaFounderNote still names the founder`);
    failed = true;
  }
  if (data.appWalletDestroyType && !String(data.appWalletDestroyType).includes('DESTRUIR')) {
    console.error(`${lang} missing DESTRUIR`);
    failed = true;
  }
  const accessKeys = [
    'creditAccessLead',
    'creditAccessGateLead',
    'identityNeedAccess',
    'creditAccessAlreadyInWallet',
    'guideIdentityBody',
    'guideIdentityEarn',
    'securityLeadDemo',
  ];
  for (const key of accessKeys) {
    const text = String(data[key] || '');
    if (hasUsdtAmount(text, '12', true) || !hasUsdtAmount(text, '4', false)) {
      console.error(`${lang}.${key} access fee is not 4 USDT`);
      failed = true;
    }
  }
  for (const key of keys) {
    const text = String(data[key] || '');
    if (hasObsoleteAccess(text)) {
      console.error(`${lang}.${key} obsolete access amount`);
      failed = true;
    }
  }
  console.log(`${lang} keys=${got.length} copiedLongEn=${copied}`);
}

if (failed) process.exit(1);
console.log('ok');
