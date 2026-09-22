import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Almacenamiento de las fotos. Dos modos:
 *  - local: carpeta DATA_DIR/uploads (desarrollo o servidor con disco propio).
 *  - s3:    cualquier almacenamiento compatible con S3 (Cloudflare R2, Backblaze B2,
 *           Wasabi, MinIO…), para poder alojar la web en servidores sin disco persistente.
 * Firma las peticiones con AWS Signature V4 sin librerías externas.
 */
export const isRemote = () => Boolean(config.s3.bucket);

/* ───────────── URLs públicas ───────────── */
export function media(name) {
  if (!name) return '';
  if (config.s3.publicBase) return `${config.s3.publicBase}/${encodeURIComponent(name)}`;
  return `/media/${encodeURIComponent(name)}`;
}
export function mediaAbsolute(name) {
  const url = media(name);
  return url.startsWith('http') ? url : config.siteUrl + url;
}

/* ───────────── Operaciones ───────────── */
export async function save(name, buffer, contentType = 'image/webp', { overwrite = false } = {}) {
  const key = safeKey(name);
  if (!isRemote()) {
    await fs.writeFile(path.join(config.uploadsDir, path.basename(key)), buffer, { flag: overwrite ? 'w' : 'wx' });
    return;
  }
  const res = await s3('PUT', key, buffer, contentType);
  if (!res.ok) throw new Error(`Almacenamiento S3: PUT ${name} → ${res.status} ${await res.text().catch(() => '')}`);
}

/** Normaliza una clave: admite prefijos («db/vibra.db») pero nunca «../». */
const safeKey = (name) => String(name).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join('/');

export async function remove(...names) {
  const files = names.filter(Boolean).map(safeKey);
  await Promise.all(files.map(async (name) => {
    try {
      if (!isRemote()) await fs.unlink(path.join(config.uploadsDir, path.basename(name)));
      else await s3('DELETE', name);
    } catch { /* si ya no existe, no pasa nada */ }
  }));
}

/** Descarga un objeto (se usa para servir /media cuando el bucket no es público). */
export function fetchObject(name) {
  return s3('GET', safeKey(name));
}

/* ───────────── Firma AWS SigV4 ───────────── */
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256hex = (data) => crypto.createHash('sha256').update(data ?? '').digest('hex');

async function s3(method, key, body, contentType) {
  const { endpoint, bucket } = config.s3;
  const base = new URL(endpoint);
  const canonicalUri = `${base.pathname.replace(/\/$/, '')}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = new URL(canonicalUri, base);
  const headers = signV4({ method, canonicalUri, host: url.host, body, contentType, ...config.s3 });
  return fetch(url, { method, headers, body, signal: AbortSignal.timeout(20_000) });
}

/** Firma SigV4. Exportada para poder verificarla contra la implementación oficial de AWS. */
export function signV4({ method, canonicalUri, host, body, contentType, region, accessKey, secretKey, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;

  const sorted = Object.keys(headers).sort();
  const canonicalRequest = [
    method, canonicalUri, '',
    sorted.map((k) => `${k}:${String(headers[k]).trim()}\n`).join(''),
    sorted.join(';'), payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signing = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${secretKey}`, dateStamp), region));
  const signature = crypto.createHmac('sha256', signing).update(stringToSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${sorted.join(';')}, Signature=${signature}`;
  return headers;
}

/** Comprobación al arrancar: avisa pronto si las credenciales están mal. */
export async function checkStorage() {
  if (!isRemote()) return true;
  const probe = `.vibra-check-${crypto.randomBytes(6).toString('hex')}`;
  try {
    await save(probe, Buffer.from('ok'), 'text/plain');
    await remove(probe);
    return true;
  } catch (e) {
    console.error('\n  ⚠  No se pudo escribir en el bucket S3:', e.message, '\n');
    return false;
  }
}
