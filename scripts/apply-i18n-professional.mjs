import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'i18n', 'locales');
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

const ES_PATCH = {
  bnbBalance: 'Saldo BNB',
  subtitle: 'Crédito sin garantía. El cumplimiento puntual amplía su línea.',
  tokenUniverseDemo:
    'En Demo solo opera USDT de práctica. USDC y FDUSD se habilitan en Cuenta Real.',
  tokenUniverseLive:
    'El crédito se expresa en dólares. Puede operar USDT, USDC o FDUSD cuando estén disponibles.',
  howItWorksBody:
    'Solicite crédito, cancele en el plazo pactado y participe en los resultados de su red.',
  jobCycle5: 'Perciba comisiones cuando su red cancele crédito, según la cercanía en su línea.',
  bonusPending: '1 USDT del fondo se acredita a quien lo invitó al pagar el primer Nivel 1.',
  referralHint: 'Quien lo invitó queda fijado al abrir la cuenta y no puede modificarse.',
  sectionPoolLead: 'El fondo común no es su saldo. Lo que aporta no se puede retirar.',
  poolPublicLead: 'Lo que aporta al fondo no se puede retirar. Financia créditos y suma fama.',
  lockSettingsLead:
    'La contraseña cifra la billetera. Un PIN opcional de 6 dígitos abre la app a diario. Tras 5 intentos fallidos hay una espera. Si olvida la contraseña, restablézcala con el correo de la cuenta.',
  lockSetupLead:
    'Cree un PIN opcional de 6 dígitos para el desbloqueo diario. La contraseña es lo que cifra la billetera.',
  referralEarnLevel1:
    'Primer Nivel 1 pagado: {bonus} del fondo a quien lo invitó de forma directa. Pagos siguientes de Nivel 1: {amount} (15% del interés).',
  referralRepLead:
    'Cuando alguien de su línea logra que otra persona se registre, pida y pague, usted recibe fama de red desde la generación 2, con la misma escala que el dinero. Quien lo invitó de forma directa cobra 1 USDT y no fama de red.',
  referralUplineLocked: 'Invitación fijada: {code}',
  referralCommissionSchedule:
    'Del interés, al cancelar: generación 1 el 15%; 2 el 8%; 3 el 6%; 4 el 4%; 5 el 2%; 6 a 12 el 0,8%; 13 a 40 el 0,4%. El fondo retiene al menos el 40%. El primer Nivel 1 pagado acredita 1 USDT del fondo a quien lo invitó de forma directa y no reparte el 15% de esa generación.',
  referralRepDirectOnly:
    'El 1 USDT de captación es solo de quien lo invitó de forma directa. La fama de red se cobra en Canje, aparte de la fama por donar o aportar.',
  referralEarnLevel1First:
    'El primer Nivel 1 de un referido directo acredita {bonus} del fondo a quien lo invitó.',
  guideNetworkBody:
    'Su código y su enlace fijan a quien invite. Quien lo invitó no se cambia. Las comisiones se liquidan cuando alguien de su línea cancela, no cuando pide. Hay hasta 40 generaciones. El primer Nivel 1 de un directo le acredita 1 USDT y no reparte el 15% de esa generación.',
  guidePoolBody:
    'Es el banco de los préstamos. Lo que aporta no se puede retirar. Financia créditos, canjes, bonos y el extra de Reserva.',
  linkWalletSignNeed: 'Firme en la billetera para guardar la dirección. Conectarla no basta.',
  splashTagline: 'Crédito privado sobre BNB Smart Chain',
};

const EN_PATCH = {
  subtitle: 'Unsecured credit. On-time repayment extends your line.',
  bonusPending:
    '1 USDT from the fund is credited to the person who invited you when the first Level 1 is repaid.',
  referralHint:
    'The person who invited you is fixed when the account is opened and cannot be changed.',
  sectionPoolLead: 'The common fund is not your balance. What you contribute cannot be withdrawn.',
  poolPublicLead:
    'What you contribute to the fund cannot be withdrawn. It finances credit and adds fame.',
  lockSettingsLead:
    'The password encrypts the wallet. An optional 6-digit PIN opens the app day to day. After 5 failed tries there is a wait. If you forget the password, restore it with the account email.',
  referralEarnLevel1:
    'First repaid Level 1: {bonus} from the fund to the person who invited you directly. Later Level 1 repayments: {amount} (15% of interest).',
  referralCommissionSchedule:
    'Of the interest, on repayment: generation 1 receives 15%; 2 receives 8%; 3 receives 6%; 4 receives 4%; 5 receives 2%; 6 to 12 receive 0.8%; 13 to 40 receive 0.4%. The fund keeps at least 40%. The first repaid Level 1 credits 1 USDT from the fund to the person who invited you directly and does not pay that generation 15%.',
  referralRepDirectOnly:
    'The 1 USDT capture bonus is for the person who invited you directly. Network fame is redeemed in Exchange, apart from fame earned by donating or contributing.',
  referralEarnLevel1First:
    'The first Level 1 by a direct referral credits {bonus} from the fund to the person who invited you.',
  guideNetworkBody:
    'Your code and link lock in whoever you invite. The person who invited you cannot be changed. Commissions settle when someone on your line repays, not when they borrow. There are up to 40 generations. The first Level 1 of a direct referral credits you 1 USDT and does not pay the 15% of that generation.',
  guidePoolBody:
    'This is the loan bank. What you contribute cannot be withdrawn. It funds loans, exchanges, bonuses and the Reserve extra.',
  linkWalletSignNeed: 'Sign in the linked wallet to save the address. Connecting it is not enough.',
  splashTagline: 'Private credit on BNB Smart Chain',
};

const SPLASH = {
  es: 'Crédito privado sobre BNB Smart Chain',
  en: 'Private credit on BNB Smart Chain',
  de: 'Privater Kredit auf der BNB Smart Chain',
  fr: 'Crédit privé sur BNB Smart Chain',
  it: 'Credito privato su BNB Smart Chain',
  pt: 'Crédito privado na BNB Smart Chain',
  ru: 'Частный кредит в сети BNB Smart Chain',
  tr: 'BNB Smart Chain üzerinde özel kredi',
  vi: 'Tín dụng riêng trên BNB Smart Chain',
  id: 'Kredit privat di BNB Smart Chain',
  zh: '基于 BNB Smart Chain 的私人信贷',
  ja: 'BNB Smart Chain上のプライベートクレジット',
  ko: 'BNB Smart Chain 기반 프라이빗 크레딧',
  hi: 'BNB Smart Chain पर निजी ऋण',
  ar: 'ائتمان خاص على شبكة BNB Smart Chain',
  bn: 'BNB Smart Chain-এ ব্যক্তিগত ঋণ',
  ur: 'BNB Smart Chain پر نجی کریڈٹ',
};

function read(lang) {
  return JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8'));
}

function write(lang, data, keyOrder) {
  const out = {};
  for (const key of keyOrder) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  for (const key of Object.keys(data)) {
    if (!(key in out)) out[key] = data[key];
  }
  fs.writeFileSync(path.join(dir, `${lang}.json`), `${JSON.stringify(out, null, 2)}\n`);
}

const es = { ...read('es'), ...ES_PATCH };
const keyOrder = Object.keys(es);
write('es', es, keyOrder);

const en = { ...read('en'), ...EN_PATCH };
write('en', en, keyOrder);

const gapPath = path.join(root, 'i18n', 'gap-translations.json');
const gap = fs.existsSync(gapPath) ? JSON.parse(fs.readFileSync(gapPath, 'utf8')) : {};

for (const lang of langs) {
  if (lang === 'es' || lang === 'en') continue;
  const data = read(lang);
  data.splashTagline = SPLASH[lang];
  const pack = gap[lang] || {};
  for (const [key, value] of Object.entries(pack)) {
    if (typeof value === 'string' && value.trim()) data[key] = value;
  }
  write(lang, data, keyOrder);
}

console.log('i18n professional patch written');
