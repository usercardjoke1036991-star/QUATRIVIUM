/** Username público de Telegram. Nunca un token (123456:AAH…). */

function looksLikeTelegramToken(value) {
  const raw = String(value || '').trim();
  if (/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(raw)) return true;
  const compact = raw.replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
  return /^\d{6,}AA[A-Za-z0-9_]{8,}$/.test(compact);
}

function sanitizeTelegramBot(value) {
  if (looksLikeTelegramToken(value)) return '';
  const username = String(value || '')
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 32);
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) return '';
  return username;
}

module.exports = { looksLikeTelegramToken, sanitizeTelegramBot };
