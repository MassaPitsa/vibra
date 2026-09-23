// Genera favicon, iconos PWA e imagen Open Graph. Uso: node scripts/build-assets.js
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/img');
fs.mkdirSync(out, { recursive: true });

// "V" geométrica (sin depender de fuentes del sistema)
const V = (s = 1, x = 0, y = 0, color = '#0a0a0a') =>
  `<path transform="translate(${x} ${y}) scale(${s})" fill="${color}" d="M14 14h22l20 62 20-62h22L68 106H44Z"/>`;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 120"><rect width="112" height="120" rx="18" fill="#ff2d2d"/>${V(1, 0, 0)}</svg>`;
fs.writeFileSync(path.join(out, 'favicon.svg'), favicon);

for (const size of [192, 512]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#ff2d2d"/>${V(2.9, 94, 82)}</svg>`;
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(out, `icon-${size}.png`));
}

const esc = (s) => s.replace(/&/g, '&amp;');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g" cx="80%" cy="20%" r="70%"><stop offset="0" stop-color="#ff2d2d" stop-opacity=".22"/><stop offset="1" stop-color="#0a0a0a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0a0a0a"/>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect y="0" width="1200" height="44" fill="#ff2d2d"/>
  <text x="40" y="29" font-family="Consolas, 'Courier New', monospace" font-weight="700" font-size="17" letter-spacing="3" fill="#0a0a0a">${esc('LA CALLE TAMBIÉN TIENE SU PASARELA  ✦  STREET SEASON FW26  ✦  SUBE TU LOOK  ✦  GUARDA · COLECCIONA · DESFILA')}</text>
  <text x="60" y="330" font-family="Impact, 'Arial Narrow Bold', sans-serif" font-size="250" fill="#efebe3" letter-spacing="-2">VIBRA</text>
  <text x="66" y="420" font-family="Impact, 'Arial Narrow Bold', sans-serif" font-size="58" fill="#efebe3">LA CALLE <tspan font-family="Georgia, serif" font-style="italic" fill="#ff2d2d" font-size="64">también</tspan> TIENE SU PASARELA</text>
  <text x="66" y="560" font-family="Consolas, 'Courier New', monospace" font-size="20" letter-spacing="3" fill="#8d897f">COMUNIDAD DE OUTFITS STREETWEAR · SHOW Nº 01</text>
  <circle cx="1080" cy="530" r="72" fill="#ff2d2d"/>
  <text x="1080" y="546" text-anchor="middle" font-family="Impact, sans-serif" font-size="42" fill="#efebe3">FW26</text>
  <path d="M30 70v-16h16M1170 70v-16h-16M30 600v16h16M1170 600v16h-16" stroke="#555" stroke-width="2" fill="none"/>
</svg>`;
await sharp(Buffer.from(og)).png().toFile(path.join(out, 'og.png'));
console.log('Assets generados en', out);

/* ───────── Fondos abstractos de respaldo para el vídeo /promo ───────── */
const promoDir = path.join(out, '..', 'promo-bg');
fs.mkdirSync(promoDir, { recursive: true });
const tonos = [['#1c1c22', '#3a2b2b'], ['#101418', '#2a2f38'], ['#201417', '#3d1f22'], ['#14181a', '#28343a'], ['#1a1614', '#3a3028'], ['#0f1216', '#22262e']];
for (const [i, [a, b]] of tonos.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="1080" height="1920" fill="url(#g)"/>
    <rect width="1080" height="1920" filter="url(#n)" opacity="0.22"/>
    <rect x="${80 + i * 40}" y="${300 + i * 90}" width="${520 - i * 20}" height="${900}" fill="#ff2d2d" opacity="0.05"/>
    <circle cx="${300 + i * 90}" cy="${700 + i * 120}" r="${260 + i * 18}" fill="#efebe3" opacity="0.035"/>
    <rect y="${1500 + i * 30}" width="1080" height="2" fill="#efebe3" opacity="0.08"/>
  </svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 74 }).toFile(path.join(promoDir, `bg-${i + 1}.webp`));
}
console.log('Fondos de /promo generados en', promoDir);
