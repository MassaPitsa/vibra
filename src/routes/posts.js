import crypto from 'node:crypto';
import { Router } from 'express';
import { db, now, tx } from '../db.js';
import { config } from '../config.js';
import { requireAuth, csrfMultipart, limiters } from '../security.js';
import { uploader, processOutfitImage, removeFiles } from '../images.js';
import { feed, getLook, topTags, topCities, siteStats, SORTS, userLooks } from '../queries.js';
import { mediaAbsolute } from '../storage.js';
import { clean, parseTags, parsePieces, intParam, httpError, lookNumber, EMAIL_RE } from '../util.js';

const r = Router();

function feedParams(q) {
  return {
    tag: clean(q.tag, 24).toLowerCase(),
    q: clean(q.q, 60),
    city: clean(q.ciudad, 40),
    sort: SORTS[q.orden] ? q.orden : 'recientes',
    page: Math.min(intParam(q.page) || 1, 500),
  };
}

/* ───────────── Portada + feed ───────────── */
r.get('/', (req, res) => {
  const p = feedParams(req.query);
  const { items, hasMore } = feed({ ...p, userId: req.user?.id });
  const filtered = Boolean(p.tag || p.q || p.city || p.sort !== 'recientes');
  res.render('home', {
    items, hasMore, params: p, filtered,
    tags: topTags(), cities: topCities(), stats: siteStats(),
    meta: {
      title: p.tag ? `#${p.tag} · Outfits streetwear` : p.q ? `“${p.q}” · Buscar outfits` : null,
      description: 'VIBRA es la comunidad donde el streetwear desfila: sube tus outfits, descubre looks reales de la calle y guárdalos en tus colecciones. La calle también tiene su pasarela.',
      noindex: p.page > 1 || Boolean(p.q),
    },
  });
});

r.get('/api/feed', limiters.api, (req, res, next) => {
  const p = feedParams(req.query);
  const { items, hasMore } = feed({ ...p, userId: req.user?.id });
  const view = req.query.view === 'runway' ? 'partials/runway-items' : 'partials/cards';
  res.render(view, { items, adEvery: 12, startIndex: (p.page - 1) * 24 }, (err, html) => {
    if (err) return next(err);
    res.set('Cache-Control', 'no-store').json({ html, hasMore, nextPage: p.page + 1 });
  });
});

/* ───────────── Modo pasarela (scroll vertical inmersivo) ───────────── */
r.get('/pasarela', (req, res) => {
  const p = feedParams(req.query);
  const { items, hasMore } = feed({ ...p, userId: req.user?.id });
  res.render('runway', {
    items, hasMore, params: p,
    meta: { title: 'Modo pasarela', description: 'Desfila por los mejores outfits streetwear de la comunidad, look a look, a pantalla completa.' },
  });
});

/* ───────────── Detalle de un look ───────────── */
const seen = new Map(); // limitador de vistas en memoria (1 por IP/look/hora)
setInterval(() => seen.clear(), 60 * 60 * 1000).unref();

r.get('/look/:id', (req, res, next) => {
  const id = intParam(req.params.id);
  const look = id && getLook(id, req.user?.id);
  const isOwner = look && req.user?.id === look.user_id;
  if (!look || (look.status !== 'published' && !isOwner && req.user?.role !== 'admin')) return next(httpError(404, 'No encontrado'));

  const key = crypto.createHash('sha1').update(req.ip + ':' + id).digest('base64');
  if (!isOwner && !seen.has(key) && seen.size < 200_000 && !/bot|crawl|spider|slurp|preview/i.test(req.get('user-agent') || '')) {
    seen.set(key, 1);
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(id);
    look.view_count++;
  }

  const more = userLooks(look.user_id, req.user?.id).filter((l) => l.id !== look.id).slice(0, 4);
  const related = look.tags.length
    ? feed({ userId: req.user?.id, tag: look.tags[0] }).items.filter((l) => l.id !== look.id && l.user_id !== look.user_id).slice(0, 8)
    : feed({ userId: req.user?.id, sort: 'tendencia' }).items.filter((l) => l.id !== look.id).slice(0, 8);

  const title = `${look.title} — Look Nº ${lookNumber(look.id)} por @${look.username}`;
  res.render('look', {
    look, more, related, isOwner,
    meta: {
      title,
      description: (look.description || `Outfit streetwear de @${look.username}${look.city ? ' en ' + look.city : ''}.`).slice(0, 160),
      image: look.cover ? mediaAbsolute(look.cover.file) : null,
      type: 'article',
      noindex: look.status !== 'published',
    },
  });
});

/* ───────────── Subir look ───────────── */
r.get('/subir', requireAuth, (req, res) => {
  res.render('upload', { meta: { title: 'Subir look', noindex: true }, form: { pieces: [] }, error: null, edit: null });
});

const upload = uploader(config.limits.maxImages);
r.post('/subir', requireAuth, limiters.upload, upload.array('photos', config.limits.maxImages), csrfMultipart, async (req, res, next) => {
  const form = readForm(req.body);
  const fail = (error) => res.status(400).render('upload', { meta: { title: 'Subir look', noindex: true }, form, error, edit: null });
  const saved = [];
  try {
    const files = req.files || [];
    const problem = validateForm(form) ||
      (!files.length ? 'Sube al menos una foto de tu outfit.' : null) ||
      (req.body.rights !== 'on' ? 'Confirma que tienes los derechos de las fotos y el permiso de quien aparece en ellas.' : null);
    if (problem) return fail(problem);

    const today = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND created_at > ?').get(req.user.id, now() - 86400000).n;
    if (today >= config.limits.postsPerDay) return fail('Has alcanzado el límite de looks por hoy. Vuelve mañana.');

    for (const f of files) saved.push(await processOutfitImage(f.buffer));

    const id = tx(() => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO posts (user_id, title, description, city, tags, pieces, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, form.title, form.description, form.city, form.tags.join(','), JSON.stringify(form.pieces), now());
      const ins = db.prepare('INSERT INTO post_images (post_id, file, thumb, width, height, color, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
      saved.forEach((img, i) => ins.run(lastInsertRowid, img.file, img.thumb, img.width, img.height, img.color, i));
      return Number(lastInsertRowid);
    });
    req.session.flash = { type: 'ok', msg: `Look Nº ${lookNumber(id)} en pasarela. Que empiece el desfile.` };
    res.redirect(`/look/${id}`);
  } catch (e) {
    await removeFiles(...saved.flatMap((s) => [s.file, s.thumb]));
    if (e.expose) return fail(e.message);
    next(e);
  }
});

function readForm(body) {
  return {
    title: clean(body.title, 80),
    description: clean(body.description, 1500, { multiline: true }),
    city: clean(body.city, 40),
    tags: parseTags(body.tags),
    pieces: parsePieces(body),
  };
}
function validateForm(f) {
  if (f.title.length < 3) return 'El título necesita al menos 3 caracteres.';
  return null;
}

/* ───────────── Editar look (texto, no fotos) ───────────── */
function ownLook(req) {
  const id = intParam(req.params.id);
  const look = id && getLook(id, req.user.id);
  if (!look || look.status === 'deleted') throw httpError(404, 'No encontrado');
  if (look.user_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, 'No puedes modificar este look.');
  return look;
}

r.get('/look/:id/editar', requireAuth, (req, res) => {
  const look = ownLook(req);
  res.render('upload', { meta: { title: 'Editar look', noindex: true }, form: { ...look, tags: look.tags }, error: null, edit: look });
});

r.post('/look/:id/editar', requireAuth, (req, res) => {
  const look = ownLook(req);
  const form = readForm(req.body);
  const problem = validateForm(form);
  if (problem) return res.status(400).render('upload', { meta: { title: 'Editar look', noindex: true }, form, error: problem, edit: look });
  db.prepare('UPDATE posts SET title = ?, description = ?, city = ?, tags = ?, pieces = ? WHERE id = ?')
    .run(form.title, form.description, form.city, form.tags.join(','), JSON.stringify(form.pieces), look.id);
  req.session.flash = { type: 'ok', msg: 'Cambios guardados.' };
  res.redirect(`/look/${look.id}`);
});

r.post('/look/:id/eliminar', requireAuth, async (req, res, next) => {
  try {
    const look = ownLook(req);
    const files = db.prepare('SELECT file, thumb FROM post_images WHERE post_id = ?').all(look.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(look.id); // cascada: imágenes, guardados, colecciones, denuncias
    await removeFiles(...files.flatMap((f) => [f.file, f.thumb]));
    req.session.flash = { type: 'ok', msg: 'Look eliminado.' };
    res.redirect(`/u/${req.user.username}`);
  } catch (e) { next(e); }
});

/* ───────────── Denunciar contenido (Reglamento de Servicios Digitales, art. 16) ───────────── */
export const REPORT_REASONS = {
  sexual: 'Desnudez o contenido sexual',
  menores: 'Pone en riesgo a menores',
  odio: 'Odio, acoso o discriminación',
  violencia: 'Violencia o actividades peligrosas',
  derechos: 'Infringe mis derechos (autor, imagen o marca)',
  privacidad: 'Publica mis datos o mi imagen sin permiso',
  spam: 'Spam, estafa o publicidad engañosa',
  ilegal: 'Otro contenido ilegal',
  otro: 'Otro motivo',
};

r.get('/denunciar/:id', (req, res, next) => {
  const look = getLook(intParam(req.params.id) || 0);
  if (!look || look.status !== 'published') return next(httpError(404, 'No encontrado'));
  res.render('report', { look, reasons: REPORT_REASONS, error: null, done: false, meta: { title: 'Denunciar contenido', noindex: true } });
});

r.post('/denunciar/:id', limiters.report, (req, res, next) => {
  const look = getLook(intParam(req.params.id) || 0);
  if (!look || look.status !== 'published') return next(httpError(404, 'No encontrado'));
  const reason = REPORT_REASONS[req.body.reason] ? req.body.reason : null;
  const details = clean(req.body.details, 2000, { multiline: true });
  const contact = clean(req.body.contact, 254).toLowerCase();
  const render = (error, done = false) => res.status(error ? 400 : 200).render('report', { look, reasons: REPORT_REASONS, error, done, meta: { title: 'Denunciar contenido', noindex: true } });
  if (!reason) return render('Elige un motivo.');
  if (contact && !EMAIL_RE.test(contact)) return render('El email de contacto no es válido.');
  if (['derechos', 'ilegal'].includes(reason) && details.length < 20) return render('Explica con detalle por qué el contenido es ilícito o vulnera tus derechos (mín. 20 caracteres).');
  if (req.body.good_faith !== 'on') return render('Debes confirmar que la información es correcta y la envías de buena fe.');
  db.prepare('INSERT INTO reports (post_id, reporter_id, reason, details, contact, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(look.id, req.user?.id ?? null, reason, details, contact || (req.user?.email ?? ''), now());
  render(null, true);
});

export default r;
