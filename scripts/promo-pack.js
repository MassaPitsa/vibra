/**
 * Prepara las fotos de ambiente del vídeo de promoción (/promo).
 *
 * 1. Descarga fotos verticales de streetwear con licencia libre para uso comercial
 *    (Pexels o Unsplash: no hace falta cuenta para descargar).
 * 2. Déjalas en la carpeta  promo-origen/  con cualquier nombre.
 * 3. Ejecuta:  npm run promo-pack
 *
 * Las recorta a 9:16, las optimiza a WebP y las deja en public/promo/,
 * desde donde el vídeo las usa mientras la web no tenga looks propios.
 * En cuanto haya 4 looks reales publicados, el vídeo usa los looks y deja de usar estas.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'promo-origen');
const out = path.join(ROOT, 'public', 'promo');

fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const files = fs.readdirSync(src).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)).sort();
if (!files.length) {
  console.log(`\n  No hay fotos en ${src}\n
  Descarga 8-10 fotos verticales de street style (gratis, uso comercial permitido):
    · https://www.pexels.com/es-es/buscar/street%20style/
    · https://www.pexels.com/es-es/buscar/streetwear/
    · https://unsplash.com/es/s/fotos/streetwear
  Guárdalas en esa carpeta y vuelve a ejecutar: npm run promo-pack\n`);
  process.exit(0);
}

for (const [i, file] of files.slice(0, 12).entries()) {
  const name = `look-${String(i + 1).padStart(2, '0')}.webp`;
  await sharp(path.join(src, file))
    .rotate()
    .resize(1080, 1920, { fit: 'cover', position: 'attention' })
    .webp({ quality: 80, effort: 5 })
    .toFile(path.join(out, name));
  console.log(`  ✔ ${file} → public/promo/${name}`);
}
console.log(`\n  ${Math.min(files.length, 12)} fotos listas. Abre /promo para ver el vídeo.\n`);
