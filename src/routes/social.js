import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, limiters } from '../security.js';
import { feed, hydrate } from '../queries.js';
import { listNotifications, markAllRead, notify } from '../notifications.js';
import { brandName, topBrands } from '../brands.js';
import { clean, intParam, httpError, USERNAME_RE } from '../util.js';

const r = Router();

/* ═══════════════ Seguidores ═══════════════ */
r.post('/api/usuarios/:username/seguir', requireAuth, limiters.api, (req, res) => {
  const username = String(req.params.username).toLowerCase();
  if (!USERNAME_RE.test(username)) throw httpError(404, 'Usuario no encontrado.');
  const target = db.prepare("SELECT id, username FROM users WHERE username = ? AND status = 'active'").get(username);
  if (!target) throw httpError(404, 'Usuario no encontrado.');
  if (target.id === req.user.id) throw httpError(400, 'No puedes seguirte a ti mismo.');

  const already = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, target.id);
  const want = typeof req.body.following === 'boolean' ? req.body.following : !already;

  if (want && !already) {
    db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(req.user.id, target.id, now());
    notify({ userId: target.id, type: 'follow', actorId: req.user.id, dedupeHours: 24 });
  } else if (!want && already) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target.id);
  }
  const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?').get(target.id).n;
  res.json({ following: want, followers });
});

r.get('/u/:username/seguidores', (req, res, next) => renderFollowList(req, res, next, 'seguidores'));
r.get('/u/:username/siguiendo', (req, res, next) => renderFollowList(req, res, next, 'siguiendo'));

function renderFollowList(req, res, next, mode) {
  const username = String(req.params.username).toLowerCase();
  const profile = db.prepare("SELECT id, username, display_name FROM users WHERE username = ? AND status = 'active'").get(username);
  if (!profile) return next(httpError(404, 'No encontrado'));
  const sql = mode === 'seguidores'
    ? `SELECT u.username, u.display_name, u.avatar, u.bio FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND u.status = 'active' ORDER BY f.created_at DESC LIMIT 200`
    : `SELECT u.username, u.display_name, u.avatar, u.bio FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? AND u.status = 'active' ORDER BY f.created_at DESC LIMIT 200`;
  const people = db.prepare(sql).all(profile.id);
  const mine = new Set(req.user ? db.prepare('SELECT u.username FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ?').all(req.user.id).map((x) => x.username) : []);
  const withFlag = people.map((p) => ({ ...p, isMe: req.user?.username === p.username }));
  res.render('follow-list', {
    profile, people: withFlag, mode, mine,
    meta: { title: `${mode === 'seguidores' ? 'Seguidores de' : 'Perfiles que sigue'} @${profile.username}`, noindex: true },
  });
}

/* ═══════════════ Notificaciones ═══════════════ */
r.get('/notificaciones', requireAuth, (req, res) => {
  const items = listNotifications(req.user.id);
  markAllRead(req.user.id);
  res.render('notifications', { items, meta: { title: 'Notificaciones', noindex: true } });
});

/* ═══════════════ Páginas de marca ═══════════════ */
r.get('/marcas', (req, res) => {
  res.render('brands', {
    brands: topBrands(120),
    meta: {
      title: 'Marcas en la calle',
      description: 'Todas las marcas que viste la comunidad de VIBRA, ordenadas por presencia real en la calle.',
    },
  });
});

r.get('/marca/:slug', (req, res, next) => {
  const slug = clean(req.params.slug, 60).toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return next(httpError(404, 'No encontrado'));
  const name = brandName(slug);
  if (!name) return next(httpError(404, 'Marca no encontrada'));

  const page = Math.min(intParam(req.query.page) || 1, 200);
  const rows = db.prepare(`
    SELECT p.id FROM post_brands pb JOIN posts p ON p.id = pb.post_id JOIN users u ON u.id = p.user_id
    WHERE pb.slug = ? AND p.status = 'published' AND u.status = 'active'
    ORDER BY p.created_at DESC LIMIT 25 OFFSET ?`).all(slug, (page - 1) * 24);
  const ids = rows.slice(0, 24).map((x) => x.id);
  const items = ids.length ? loadLooks(ids, req.user?.id) : [];
  const stats = db.prepare(`SELECT COUNT(*) AS looks, COUNT(DISTINCT p.user_id) AS people
    FROM post_brands pb JOIN posts p ON p.id = pb.post_id WHERE pb.slug = ? AND p.status = 'published'`).get(slug);

  res.render('brand', {
    brand: { slug, name }, items, stats, page, hasMore: rows.length > 24,
    related: topBrands(24).filter((b) => b.slug !== slug).slice(0, 12),
    meta: {
      title: `${name} en la calle`,
      description: `${stats.looks} outfits con ${name} subidos por la comunidad de VIBRA. Mira cómo se lleva ${name} de verdad en la calle.`,
    },
  });
});

/** Carga varios looks conservando el orden recibido. */
function loadLooks(ids, viewerId) {
  const list = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar,
      (SELECT json_group_array(json_object('file', file, 'thumb', thumb, 'w', width, 'h', height, 'color', color))
       FROM (SELECT * FROM post_images WHERE post_id = p.id ORDER BY position)) AS images,
      ${viewerId ? `EXISTS(SELECT 1 FROM saves s WHERE s.user_id = ${Number(viewerId)} AND s.post_id = p.id)` : '0'} AS saved
    FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id IN (${list})`).all(...ids).map(hydrate);
  const byId = new Map(rows.map((x) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/* ═══════════════ Feed de perfiles seguidos ═══════════════ */
export function followingFeed(req, res) {
  const page = Math.min(intParam(req.query.page) || 1, 200);
  const { items, hasMore } = feed({ userId: req.user.id, following: true, page });
  const count = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(req.user.id).n;
  res.render('following', {
    items, hasMore, page, count,
    suggestions: count ? [] : db.prepare(`SELECT u.username, u.display_name, u.avatar,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.status = 'published') AS looks
      FROM users u WHERE u.status = 'active' AND u.id != ?
      ORDER BY looks DESC LIMIT 8`).all(req.user.id),
    meta: { title: 'Siguiendo', noindex: true },
  });
}

r.get('/siguiendo', requireAuth, followingFeed);

/* ═══════════════ Vídeo de promoción que se reproduce solo ═══════════════
   Página en formato vertical pensada para grabar la pantalla y publicarla
   en TikTok o Reels sin editar nada. No se enlaza ni se indexa. */
r.get('/promo', (req, res) => {
  const looks = db.prepare(`
    SELECT pi.file, pi.thumb FROM post_images pi JOIN posts p ON p.id = pi.post_id JOIN users u ON u.id = p.user_id
    WHERE p.status = 'published' AND u.status = 'active' AND pi.position = 0
    ORDER BY p.save_count DESC, p.created_at DESC LIMIT 12`).all();
  res.render('promo', { looks, meta: { title: 'Vídeo de promoción', noindex: true } });
});

export default r;
