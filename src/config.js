import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carga .env si existe (Node >= 21 lo trae de serie, sin dependencias).
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

// En desarrollo se genera un secreto persistente para no cerrar sesiones en cada reinicio.
function sessionSecret() {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (isProd) {
    throw new Error('SESSION_SECRET es obligatorio en producción (mínimo 32 caracteres). Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  const f = path.join(DATA_DIR, '.dev-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'));
  return fs.readFileSync(f, 'utf8').trim();
}

export const config = {
  isProd,
  port: Number(env.PORT) || 3000,
  siteUrl: (env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  siteName: env.SITE_NAME || 'VIBRA',
  trustProxy: env.TRUST_PROXY ?? (isProd ? '1' : 'false'),
  dataDir: DATA_DIR,
  uploadsDir: path.join(DATA_DIR, 'uploads'),
  dbFile: path.join(DATA_DIR, 'vibra.db'),
  sessionSecret: sessionSecret(),
  adminEmail: (env.ADMIN_EMAIL || '').toLowerCase().trim(),

  // Datos del titular — obligatorios por la LSSI-CE (art. 10) y el RGPD (art. 13).
  legal: {
    ownerName: env.LEGAL_OWNER_NAME || '',
    ownerId: env.LEGAL_OWNER_ID || '',
    ownerAddress: env.LEGAL_OWNER_ADDRESS || '',
    contactEmail: env.LEGAL_CONTACT_EMAIL || '',
    registry: env.LEGAL_REGISTRY || '',
    lastUpdate: env.LEGAL_LAST_UPDATE || '22 de septiembre de 2026',
  },

  // Google AdSense. Vacío = sin publicidad (la web funciona igual).
  adsense: {
    client: env.ADSENSE_CLIENT || '', // ca-pub-XXXXXXXXXXXXXXXX
    slotFeed: env.ADSENSE_SLOT_FEED || '',
    slotLook: env.ADSENSE_SLOT_LOOK || '',
    // 'own'    -> banner de cookies propio + Google Consent Mode v2
    // 'google' -> CMP certificado de Google (Privacidad y mensajes de AdSense). Recomendado en UE/EEE.
    cmp: env.CMP_MODE === 'google' ? 'google' : 'own',
  },

  // Almacenamiento de fotos compatible con S3 (Cloudflare R2, Backblaze B2, Wasabi…).
  // Si S3_BUCKET está vacío, las fotos se guardan en el disco local (DATA_DIR/uploads).
  s3: {
    endpoint: (env.S3_ENDPOINT || '').replace(/\/$/, ''),
    bucket: env.S3_BUCKET || '',
    region: env.S3_REGION || 'auto',
    accessKey: env.S3_ACCESS_KEY_ID || '',
    secretKey: env.S3_SECRET_ACCESS_KEY || '',
    // URL pública del bucket (opcional). Si no es una URL válida (vacío, «-», «no»…),
    // las fotos se sirven a través de /media desde el propio servidor.
    publicBase: /^https?:\/\//i.test((env.S3_PUBLIC_BASE_URL || '').trim())
      ? env.S3_PUBLIC_BASE_URL.trim().replace(/\/$/, '')
      : '',
  },

  // Copia automática de la base de datos al bucket (para servidores sin disco persistente).
  // 0 = desactivado. Sólo se aplica si hay bucket S3 configurado.
  dbSync: { minutes: Number(env.DB_SYNC_MINUTES ?? 5) },

  // Acceso con Google (opcional). Vacío = sólo email y contraseña.
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
  // Código de verificación de Google Search Console (etiqueta meta).
  googleSiteVerification: env.GOOGLE_SITE_VERIFICATION || '',

  // Cloudflare Turnstile (anti-bots, opcional y respetuoso con la privacidad).
  turnstile: {
    siteKey: env.TURNSTILE_SITE_KEY || '',
    secret: env.TURNSTILE_SECRET_KEY || '',
  },

  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  },

  limits: {
    maxImages: 6,
    maxImageBytes: 10 * 1024 * 1024,
    postsPerDay: 20,
  },
};

export function missingLegalFields() {
  const l = config.legal;
  return Object.entries({
    LEGAL_OWNER_NAME: l.ownerName,
    LEGAL_OWNER_ID: l.ownerId,
    LEGAL_OWNER_ADDRESS: l.ownerAddress,
    LEGAL_CONTACT_EMAIL: l.contactEmail,
  }).filter(([, v]) => !v).map(([k]) => k);
}
