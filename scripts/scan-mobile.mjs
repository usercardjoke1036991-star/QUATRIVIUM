/**
 * Sube un APK a MobSF (POST multipart/form-data /api/v1/upload), lanza /api/v1/scan
 * y guarda el JSON de /api/v1/report_json en mobsf-report.json.
 * Uso:
 *   npm run security:mobsf -- ./android/app/build/outputs/apk/release/app-release.apk
 *   node scripts/scan-mobile.mjs ./android/app/build/outputs/apk/debug/app-debug.apk
 *
 * Clave: MOBSF_API_KEY (entorno o .env). Servidor: MOBSF_URL (por defecto http://localhost:8000).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnEnv, binDocker, stripTrailSlash } from './spawnEnv.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
loadDotEnv(resolve(root, '.env'));

const extra = process.argv.slice(2);
const wantPurge = extra.includes('--purge');
const apiKey = String(process.env.MOBSF_API_KEY || '').trim();
const baseUrl = stripTrailSlash(process.env.MOBSF_URL || 'http://localhost:8000');
const reportPath = resolve(root, 'mobsf-report.json');
const apkPath = wantPurge ? '' : resolveApkPath(extra);
const auth = { Authorization: apiKey };

if (!apiKey) {
  console.error(`Falta MOBSF_API_KEY.
Póngala en el entorno o en .env (está en Ajustes de MobSF → API Key).`);
  process.exit(1);
}

if (wantPurge) {
  try {
    const removed = await purgeScans();
    console.log(
      `MobSF: borrados ${removed} análisis. El disco del contenedor queda libre para el siguiente APK.`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`No se pudo vaciar MobSF: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!apkPath || !existsSync(apkPath)) {
  console.error(`No se encontró el APK.
Uso: node scripts/scan-mobile.mjs <ruta.apk>
Ejemplo: node scripts/scan-mobile.mjs ./android/app/build/outputs/apk/release/app-release.apk`);
  process.exit(1);
}

try {
  console.log(`MobSF ${baseUrl}`);
  console.log(`APK    ${apkPath}`);

  const uploaded = await uploadApk(apkPath);
  const hash = String(uploaded.hash || '').trim();
  const fileName = String(uploaded.file_name || basename(apkPath));
  const scanType = String(uploaded.scan_type || guessScanType(fileName));
  if (!hash) {
    throw new Error(`MobSF no devolvió hash al subir. Respuesta: ${brief(uploaded)}`);
  }
  console.log(`Hash   ${hash.replace(/[\r\n]/g, '')}`);

  const scanned = await postForm(`${baseUrl}/api/v1/scan`, {
    hash,
    file_name: fileName,
    scan_type: scanType,
    re_scan: '0',
  });
  if (scanned && scanned.error) {
    throw new Error(String(scanned.error));
  }
  console.log('Scan   listo');

  const report = await postForm(`${baseUrl}/api/v1/report_json`, { hash });
  if (!report || typeof report !== 'object' || report.error) {
    throw new Error(report?.error ? String(report.error) : 'MobSF no devolvió JSON del informe');
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Informe ${reportPath}`);
} catch (err) {
  const message = (err instanceof Error ? err.message : String(err)).replace(/[\r\n]/g, ' ');
  console.error(`MobSF falló: ${message}
¿Está corriendo http://localhost:8000? ¿La API Key es la de esa instancia?`);
  process.exit(1);
}

function underProject(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw || raw.includes('\0')) return '';
  const full = resolve(root, raw);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return '';
  if (!isMobilePackage(full)) return '';
  return full;
}

function isMobilePackage(filePath) {
  const lower = basename(filePath).toLowerCase();
  return lower.endsWith('.apk') || lower.endsWith('.aab') || lower.endsWith('.ipa');
}

function resolveApkPath(args) {
  const fromCli = args.find((arg) => arg && !arg.startsWith('-'));
  const candidates = [
    fromCli,
    process.env.MOBSF_APK,
    'android/app/build/outputs/apk/release/app-release.apk',
    'android/app/build/outputs/apk/debug/app-debug.apk',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const full = underProject(candidate);
    if (full && isMobilePackage(full) && existsSync(full)) return full;
  }
  return '';
}

function guessScanType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.aab')) return 'aab';
  if (lower.endsWith('.ipa')) return 'ipa';
  if (lower.endsWith('.zip') || lower.endsWith('.apk')) return 'apk';
  return 'apk';
}

async function uploadApk(filePath) {
  const safe = underProject(filePath);
  if (!safe || !isMobilePackage(safe) || !existsSync(safe)) {
    throw new Error('apk invalido');
  }
  // deepcode ignore PT: local MobSF CLI; only operator-chosen .apk/.aab/.ipa
  const bytes = new Uint8Array(readFileSync(safe));
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes], { type: 'application/vnd.android.package-archive' }),
    basename(filePath)
  );
  const res = await fetch(`${baseUrl}/api/v1/upload`, {
    method: 'POST',
    headers: auth,
    body: form,
  });
  return readJson(res, 'upload');
}

async function purgeScans() {
  let removed = 0;
  try {
    const listed = await fetchJson(
      `${baseUrl}/api/v1/scans?page=1&page_size=100`,
      { method: 'GET', headers: auth },
      'scans'
    );
    const rows = Array.isArray(listed?.content)
      ? listed.content
      : Array.isArray(listed)
        ? listed
        : [];
    for (const row of rows) {
      const hash = String(row.MD5 || row.hash || row.FILE_HASH || '').trim();
      if (!hash) continue;
      await postForm(`${baseUrl}/api/v1/delete_scan`, { hash });
      removed += 1;
    }
  } catch {
    removed = 0;
  }
  const names = ['agitated_mcnulty'];
  const dockerPs = spawnSync(
    binDocker(),
    [
      'ps',
      '--filter',
      'ancestor=opensecurity/mobile-security-framework-mobsf',
      '--format',
      '{{.Names}}',
    ],
    { encoding: 'utf8', windowsHide: true, env: spawnEnv() }
  );
  for (const name of String(dockerPs.stdout || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    if (!names.includes(name)) names.push(name);
  }
  for (const name of names) {
    spawnSync(
      binDocker(),
      [
        'exec',
        name,
        'sh',
        '-c',
        'rm -rf /home/mobsf/.MobSF/uploads/* /home/mobsf/.MobSF/downloads/*',
      ],
      { encoding: 'utf8', windowsHide: true, env: spawnEnv() }
    );
  }
  return removed;
}

async function fetchJson(url, init, label) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
  return readJson(res, label);
}

async function postForm(url, fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    body.set(key, String(value));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return readJson(res, url.replace(baseUrl, ''));
}

async function readJson(res, label) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data?.error || data?.message || text.slice(0, 300) || res.statusText;
    throw new Error(`${label} HTTP ${res.status}: ${detail}`);
  }
  if (data === null) {
    throw new Error(`${label} no devolvió JSON`);
  }
  return data;
}

function brief(value) {
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return String(value);
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
