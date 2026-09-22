import sharp from 'sharp';
import { config } from './config.js';

/**
 * Moderación automática de imágenes (desnudos y contenido sexual), incompatible
 * con las normas de la comunidad y con Google AdSense.
 *
 * Dos capas:
 *  1. Análisis local sin dependencias: proporción de píxeles de tono piel y su
 *     concentración en el torso. Es una estimación, no un detector perfecto.
 *  2. Servicio externo opcional (Sightengine) si se configuran las credenciales:
 *     mucho más fiable, y su resultado manda sobre la heurística.
 *
 * IMPORTANTE: nunca se borra nada automáticamente. Las fotos dudosas quedan
 * ocultas a la espera de revisión humana, y las sospechosas se marcan en /admin.
 */
export const THRESHOLDS = { hide: 0.72, flag: 0.45 };

/** Regla clásica de Kovac para detectar tono de piel en RGB. */
const isSkin = (r, g, b) =>
  r > 95 && g > 40 && b > 20 && r > g && r > b &&
  Math.max(r, g, b) - Math.min(r, g, b) > 15 && Math.abs(r - g) > 15;

async function localScore(buffer) {
  const size = 128;
  const { data, info } = await sharp(buffer)
    .resize(size, size, { fit: 'inside' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  let skin = 0, total = 0, centerSkin = 0, centerTotal = 0;
  const { width, height, channels } = info;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const s = isSkin(data[i], data[i + 1], data[i + 2]);
      total++; if (s) skin++;
      // Zona central (torso): donde se concentra la piel en una foto de desnudo
      if (x > width * 0.25 && x < width * 0.75 && y > height * 0.2 && y < height * 0.8) {
        centerTotal++; if (s) centerSkin++;
      }
    }
  }
  const ratio = skin / Math.max(1, total);
  const center = centerSkin / Math.max(1, centerTotal);
  // Un retrato normal ronda 0,05-0,20 de piel; un desnudo supera 0,40 y se concentra en el centro.
  const score = Math.min(1, Math.max(0, (ratio - 0.18) / 0.32) * 0.6 + Math.max(0, (center - 0.25) / 0.45) * 0.4);
  return { score: Number(score.toFixed(3)), ratio: Number(ratio.toFixed(3)), center: Number(center.toFixed(3)) };
}

/** Sightengine: modelo de nudity real. Opcional, se activa con las credenciales. */
async function remoteScore(buffer) {
  const { user, secret } = config.moderation;
  const body = new FormData();
  body.set('media', new Blob([buffer], { type: 'image/webp' }), 'look.webp');
  body.set('models', 'nudity-2.1');
  body.set('api_user', user);
  body.set('api_secret', secret);
  const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body, signal: AbortSignal.timeout(15_000) });
  const data = await res.json();
  if (data.status !== 'success' || !data.nudity) throw new Error(data.error?.message || 'respuesta inesperada');
  const n = data.nudity;
  const explicit = Number(n.sexual_activity || 0) + Number(n.sexual_display || 0) + Number(n.erotica || 0);
  const suggestive = Number(n.very_suggestive || 0) * 0.6 + Number(n.suggestive || 0) * 0.3;
  return { score: Number(Math.min(1, explicit + suggestive).toFixed(3)), provider: 'sightengine' };
}

/** Analiza una imagen ya procesada y devuelve {score, reason}. */
export async function moderateImage(buffer) {
  let result = { score: 0, reason: '' };
  try {
    const local = await localScore(buffer);
    result = { score: local.score, reason: `piel ${Math.round(local.ratio * 100)}% · centro ${Math.round(local.center * 100)}%` };
  } catch { /* si falla el análisis, no bloqueamos la publicación */ }

  if (config.moderation.user && config.moderation.secret) {
    try {
      const remote = await remoteScore(buffer);
      result = { score: remote.score, reason: `Sightengine: ${Math.round(remote.score * 100)}% contenido sexual` };
    } catch (e) {
      console.error('[moderación] servicio externo no disponible:', e.message);
    }
  }
  return result;
}

/** Puntuación de un look completo: manda la foto más comprometida. */
export async function moderateLook(buffers) {
  let worst = { score: 0, reason: '' };
  for (const b of buffers) {
    const r = await moderateImage(b);
    if (r.score > worst.score) worst = r;
  }
  return {
    ...worst,
    hide: worst.score >= THRESHOLDS.hide,
    flag: worst.score >= THRESHOLDS.flag,
  };
}
