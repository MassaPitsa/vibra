import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';

const r = Router();
const site = config.siteUrl;

r.get('/healthz', (req, res) => {
  db.prepare('SELECT 1').get();
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

r.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /ajustes
Disallow: /guardados
Disallow: /subir
Disallow: /entrar
Disallow: /registro
Disallow: /olvide
Disallow: /restablecer/
Disallow: /denunciar/
Disallow: /*?*q=

User-agent: Mediapartners-Google
Allow: /

Sitemap: ${site}/sitemap.xml
`);
});

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

r.get('/sitemap.xml', (req, res) => {
  const looks = db.prepare(`SELECT p.id, p.title, p.created_at, (SELECT file FROM post_images WHERE post_id = p.id ORDER BY position LIMIT 1) AS img
    FROM posts p JOIN users u ON u.id = p.user_id WHERE p.status = 'published' AND u.status = 'active' ORDER BY p.id DESC LIMIT 40000`).all();
  const users = db.prepare(`SELECT u.username, MAX(p.created_at) AS last FROM users u JOIN posts p ON p.user_id = u.id
    WHERE u.status = 'active' AND p.status = 'published' GROUP BY u.id LIMIT 9000`).all();
  const statics = ['/', '/pasarela', '/sobre', '/contacto', '/legal/aviso-legal', '/legal/privacidad', '/legal/cookies', '/legal/terminos', '/legal/normas', '/legal/accesibilidad'];
  const iso = (t) => new Date(t).toISOString();
  const body = [
    ...statics.map((p) => `<url><loc>${site}${p}</loc></url>`),
    ...users.map((u) => `<url><loc>${site}/u/${xmlEscape(u.username)}</loc><lastmod>${iso(u.last)}</lastmod></url>`),
    ...looks.map((l) => `<url><loc>${site}/look/${l.id}</loc><lastmod>${iso(l.created_at)}</lastmod>${l.img ? `<image:image><image:loc>${site}/media/${l.img}</image:loc><image:title>${xmlEscape(l.title)}</image:title></image:image>` : ''}</url>`),
  ].join('\n');
  res.type('application/xml').set('Cache-Control', 'public, max-age=1800').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>`);
});

// ads.txt — requisito de Google AdSense para autorizar al vendedor.
r.get('/ads.txt', (req, res) => {
  const pub = config.adsense.client.replace(/^ca-/, '');
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400')
    .send(pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : '# Configura ADSENSE_CLIENT en .env\n');
});

r.get('/.well-known/security.txt', (req, res) => {
  const expires = new Date(Date.now() + 180 * 864e5).toISOString();
  res.type('text/plain').send(
`Contact: mailto:${config.legal.contactEmail || 'security@example.com'}
Expires: ${expires}
Preferred-Languages: es, en
Canonical: ${site}/.well-known/security.txt
Policy: ${site}/legal/terminos
`);
});

r.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').set('Cache-Control', 'public, max-age=86400').send(JSON.stringify({
    name: `${config.siteName} — La calle también tiene su pasarela`,
    short_name: config.siteName,
    description: 'Comunidad de outfits streetwear. Sube, descubre y colecciona looks.',
    lang: 'es',
    start_url: '/?utm_source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/static/img/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/static/img/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/static/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
});

r.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/favicon.svg'));

export default r;
