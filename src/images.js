import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { config } from './config.js';

sharp.cache(false);
sharp.concurrency(2);

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export function uploader(maxFiles) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxImageBytes, files: maxFiles, fields: 40, fieldSize: 20_000, parts: maxFiles + 40 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) {
        return cb(Object.assign(new Error('Formato no admitido. Usa JPG, PNG, WEBP o AVIF.'), { status: 400, expose: true }));
      }
      cb(null, true);
    },
  });
}

const name = (suffix) => `${crypto.randomBytes(16).toString('hex')}${suffix}.webp`;

/**
 * Decodifica y RE-CODIFICA la imagen desde cero. Esto:
 *  - valida que el archivo sea realmente una imagen (no basta el mimetype del navegador),
 *  - elimina TODOS los metadatos (EXIF, GPS, modelo de cámara…) para proteger la privacidad,
 *  - neutraliza archivos políglota / payloads incrustados,
 *  - genera versiones optimizadas en WebP.
 */
export async function processOutfitImage(buffer) {
  const input = sharp(buffer, { limitInputPixels: 60_000_000, failOn: 'error' });
  const meta = await input.metadata().catch(() => null);
  if (!meta || !meta.width || !meta.height) throw badImage('Una de las imágenes está dañada o no es válida.');
  if (Math.min(meta.width, meta.height) < 300) throw badImage('Las fotos deben medir al menos 300 px por lado.');

  const base = sharp(buffer, { limitInputPixels: 60_000_000 }).rotate(); // aplica la orientación EXIF antes de descartarla

  const fullName = name('');
  const thumbName = name('-t');
  const full = await base.clone()
    .resize({ width: 1600, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base.clone()
    .resize({ width: 720, height: 1080, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 76, effort: 4 })
    .toBuffer();
  const { dominant } = await base.clone().resize(64).stats();

  await fs.writeFile(path.join(config.uploadsDir, fullName), full.data, { flag: 'wx' });
  await fs.writeFile(path.join(config.uploadsDir, thumbName), thumb, { flag: 'wx' });

  const hex = '#' + [dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { file: fullName, thumb: thumbName, width: full.info.width, height: full.info.height, color: hex };
}

export async function processAvatar(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 60_000_000, failOn: 'error' }).metadata().catch(() => null);
  if (!meta || !meta.width) throw badImage('La imagen no es válida.');
  const file = name('-a');
  const data = await sharp(buffer, { limitInputPixels: 60_000_000 }).rotate()
    .resize(400, 400, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer();
  await fs.writeFile(path.join(config.uploadsDir, file), data, { flag: 'wx' });
  return file;
}

export async function removeFiles(...files) {
  await Promise.all(files.filter(Boolean).map((f) => {
    const safe = path.basename(f); // nunca borrar fuera de la carpeta de subidas
    return fs.unlink(path.join(config.uploadsDir, safe)).catch(() => {});
  }));
}

function badImage(msg) {
  return Object.assign(new Error(msg), { status: 400, expose: true });
}
