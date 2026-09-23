// Genera los rótulos verticales (1080x1920) para el vídeo de TikTok.
// Uso: node scripts/tiktok-cards.js   → quedan en promo/tiktok/
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../promo/tiktok');
fs.mkdirSync(out, { recursive: true });

const W = 1080, H = 1920;
const ROJO = '#ff2d2d', HUESO = '#efebe3';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Bloque de texto con degradado oscuro detrás para que se lea sobre cualquier grabación. */
function card({ file, kicker, lines, cta, solid = false, baseline = 1180 }) {
  const lineH = 118;
  const top = baseline - 90;
  const bottom = baseline + lines.length * lineH + (cta ? 110 : 40);

  // Cada línea es un único <text> con tspans: así el navegador encadena las palabras
  // y no hay que calcular anchos a mano.
  const tspans = lines.map((l, i) => {
    const parts = typeof l === 'string' ? [{ t: l }] : l;
    const inner = parts.map((p, k) => `<tspan${k ? ' dx="18"' : ''} font-family="${p.serif ? 'Georgia, serif' : 'Impact, Haettenschweiler, sans-serif'}" font-style="${p.serif ? 'italic' : 'normal'}" font-size="${p.serif ? 108 : 100}" fill="${p.accent ? ROJO : HUESO}">${esc(p.t)}</tspan>`).join('');
    return `<text x="70" y="${baseline + i * lineH}" letter-spacing="-1">${inner}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="0.25" stop-color="#000" stop-opacity="0.72"/>
        <stop offset="0.85" stop-color="#000" stop-opacity="0.72"/>
        <stop offset="1" stop-color="#000" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${solid ? `<rect width="${W}" height="${H}" fill="#0a0a0a"/>` : `<rect x="0" y="${top - 70}" width="${W}" height="${bottom - top + 110}" fill="url(#fade)"/>`}
    ${kicker ? `<rect x="70" y="${top - 46}" width="${kicker.length * 15 + 34}" height="46" fill="${ROJO}"/>
      <text x="87" y="${top - 13}" font-family="Consolas, monospace" font-weight="700" font-size="24" letter-spacing="3" fill="#0a0a0a">${esc(kicker)}</text>` : ''}
    ${tspans}
    ${cta ? `<text x="70" y="${baseline + lines.length * lineH + 60}" font-family="Consolas, monospace" font-weight="700" font-size="30" letter-spacing="4" fill="${HUESO}">${esc(cta)}</text>` : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toFile(path.join(out, file));
}

await card({
  file: '01-gancho.png', kicker: 'SEGUNDO 0',
  lines: [[{ t: 'TE CURRAS EL FIT' }], [{ t: 'Y LO VEN' }, { t: 'CUATRO', accent: true }], [{ t: 'PERSONAS' }]],
  baseline: 1120,
});
await card({ file: '02-vibra.png', kicker: 'SEGUNDO 2', lines: [[{ t: 'ESTO ES' }, { t: 'VIBRA', accent: true }]], cta: 'LA CALLE TAMBIEN TIENE SU PASARELA', baseline: 1250 });
await card({ file: '03-pasarela.png', kicker: 'SEGUNDO 6', lines: [[{ t: 'MODO' }], [{ t: 'PASARELA', accent: true }]], cta: 'TU OUTFIT A PANTALLA COMPLETA', baseline: 1180 });
await card({ file: '04-colecciones.png', kicker: 'SEGUNDO 11', lines: [[{ t: 'GUARDA Y' }], [{ t: 'COLECCIONA', accent: true }]], cta: 'COMO TIKTOK PERO SOLO DE ROPA', baseline: 1180 });
await card({ file: '05-og.png', kicker: 'SEGUNDO 15', lines: [[{ t: 'LOS 2500' }], [{ t: 'PRIMEROS SON' }], [{ t: 'OG', accent: true }, { t: ' PARA SIEMPRE' }]], baseline: 1060 });

// Cierre con fondo sólido
const cierre = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  <rect y="0" width="${W}" height="70" fill="${ROJO}"/>
  <text x="40" y="47" font-family="Consolas, monospace" font-weight="700" font-size="26" letter-spacing="4" fill="#0a0a0a">LA CALLE TAMBIEN TIENE SU PASARELA</text>
  <text x="50%" y="880" text-anchor="middle" font-family="Impact, sans-serif" font-size="240" fill="${HUESO}" letter-spacing="-4">VIBRA</text>
  <text x="50%" y="985" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="72" fill="${ROJO}">tambien</text>
  <text x="50%" y="1180" text-anchor="middle" font-family="Consolas, monospace" font-weight="700" font-size="34" letter-spacing="3" fill="${HUESO}">vibra-76kg.onrender.com</text>
  <text x="50%" y="1250" text-anchor="middle" font-family="Consolas, monospace" font-size="26" letter-spacing="3" fill="#8d897f">ENLACE EN LA BIO</text>
  <circle cx="540" cy="1520" r="120" fill="${ROJO}"/>
  <text x="540" y="1545" text-anchor="middle" font-family="Impact, sans-serif" font-size="62" fill="#0a0a0a">OG</text>
  <text x="540" y="1710" text-anchor="middle" font-family="Consolas, monospace" font-weight="700" font-size="28" letter-spacing="3" fill="${HUESO}">QUEDAN PLAZAS. CORRE.</text>
</svg>`;
await sharp(Buffer.from(cierre)).png().toFile(path.join(out, '06-cierre.png'));

console.log('Rótulos generados en', out);
