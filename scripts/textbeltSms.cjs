'use strict';

function isTextbeltConfigured(key) {
  const value = String(key || '').trim();
  return value.length >= 8 && value.toLowerCase() !== 'textbelt';
}

async function sendTextbeltSms(phone, text, options = {}) {
  const key = String(options.key || '').trim();
  const sender = String(options.sender || 'Quatrivium').trim() || 'Quatrivium';
  const fetchFn = options.fetchImpl || globalThis.fetch;
  if (!isTextbeltConfigured(key) || !phone || !text) return { ok: false, error: 'config' };
  const to = String(phone).replace(/\s/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(to)) return { ok: false, error: 'phone' };
  try {
    const response = await fetchFn('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        phone: to,
        message: String(text),
        key,
        sender,
      }),
      signal: options.signal || AbortSignal.timeout(15000),
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok || !body.success) {
      return { ok: false, error: String(body.error || response.status).slice(0, 180) };
    }
    return { ok: true, quotaRemaining: body.quotaRemaining };
  } catch (error) {
    return { ok: false, error: error?.cause?.code || error?.name || 'network' };
  }
}

module.exports = { isTextbeltConfigured, sendTextbeltSms };
