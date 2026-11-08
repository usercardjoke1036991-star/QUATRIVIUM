import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FORCE, PACK, langs, dir, root, writeLang } from './patch-i18n-leftovers.mjs';
import { PACK_EAST } from './patch-i18n-leftovers-east.mjs';
import { PACK_ASIA } from './patch-i18n-leftovers-asia.mjs';
import { PACK_RTL } from './patch-i18n-leftovers-rtl.mjs';

const ALL = { ...PACK, ...PACK_EAST, ...PACK_ASIA, ...PACK_RTL };
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(dir, 'es.json'), 'utf8'));
const keyOrder = Object.keys(es);
const gapPath = path.join(root, 'i18n', 'gap-translations.json');
const gap = fs.existsSync(gapPath) ? JSON.parse(fs.readFileSync(gapPath, 'utf8')) : {};

let changed = 0;
for (const lang of langs) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8'));
  const pack = ALL[lang] || {};
  gap[lang] = gap[lang] || {};
  for (const [key, value] of Object.entries(pack)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (!(key in es)) continue;
    const current = data[key];
    const force = FORCE.includes(key);
    if (force || current === en[key]) {
      if (current !== value) {
        data[key] = value;
        changed += 1;
      }
      gap[lang][key] = value;
    }
  }
  writeLang(lang, data, keyOrder);
}

fs.writeFileSync(gapPath, `${JSON.stringify(gap, null, 2)}\n`);
console.log(`i18n leftovers applied changes=${changed}`);
