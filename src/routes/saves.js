import { Router } from 'express';
import { db, now, tx, refreshSaveCount } from '../db.js';
import { requireAuth, limiters } from '../security.js';
import { savedLooks, collectionsOf } from '../queries.js';
import { clean, intParam, httpError } from '../util.js';

const r = Router();
const MAX_COLLECTIONS = 100;

const postExists = db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'");
const ownCollection = db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?');

function getOwnCollection(req, id) {
  const c = ownCollection.get(intParam(id) || 0, req.user.id);
  if (!c) throw httpError(404, 'Colección no encontrada.');
  return c;
}

/* ───────────── Guardar / quitar de guardados ───────────── */
r.post('/api/looks/:id/save', requireAuth, limiters.api, (req, res) => {
  const postId = intParam(req.params.id);
  if (!postId || !postExists.get(postId)) throw httpError(404, 'Look no encontrado.');
  const already = db.prepare('SELECT 1 FROM saves WHERE user_id = ? AND post_id = ?').get(req.user.id, postId);
  const want = typeof req.body.saved === 'boolean' ? req.body.saved : !already;

  tx(() => {
    if (want && !already) {
      db.prepare('INSERT INTO saves (user_id, post_id, created_at) VALUES (?, ?, ?)').run(req.user.id, postId, now());
    } else if (!want && already) {
      db.prepare('DELETE FROM saves WHERE user_id = ? AND post_id = ?').run(req.user.id, postId);
      // Igual que en TikTok: quitar de guardados lo saca también de tus colecciones.
      db.prepare('DELETE FROM collection_items WHERE post_id = ? AND collection_id IN (SELECT id FROM collections WHERE user_id = ?)').run(postId, req.user.id);
    }
    refreshSaveCount(postId);
  });
  const { save_count } = db.prepare('SELECT save_count FROM posts WHERE id = ?').get(postId);
  res.json({ saved: want, count: save_count });
});

/* ───────────── Colecciones ───────────── */
r.get('/api/collections', requireAuth, (req, res) => {
  const postId = intParam(req.query.post);
  const cols = collectionsOf(req.user.id);
  const inSet = new Set(postId
    ? db.prepare('SELECT ci.collection_id AS id FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE c.user_id = ? AND ci.post_id = ?').all(req.user.id, postId).map((x) => x.id)
    : []);
  res.json({ collections: cols.map((c) => ({ id: c.id, name: c.name, count: c.count, cover: c.covers[0] || null, is_public: c.is_public, has: inSet.has(c.id) })) });
});

r.post('/api/collections', requireAuth, limiters.api, (req, res) => {
  const name = clean(req.body.name, 40);
  if (name.length < 1) throw httpError(400, 'Ponle nombre a tu colección.');
  const total = db.prepare('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?').get(req.user.id).n;
  if (total >= MAX_COLLECTIONS) throw httpError(400, `Máximo ${MAX_COLLECTIONS} colecciones.`);
  const t = now();
  const { lastInsertRowid } = db.prepare('INSERT INTO collections (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(req.user.id, name, t, t);
  const id = Number(lastInsertRowid);

  // Opcional: crear y añadir un look directamente (flujo "Guardar en nueva colección").
  const postId = intParam(req.body.postId);
  if (postId && postExists.get(postId)) addToCollection(req.user.id, id, postId);
  res.status(201).json({ id, name });
});

r.post('/api/collections/:id', requireAuth, limiters.api, (req, res) => {
  const c = getOwnCollection(req, req.params.id);
  const name = req.body.name !== undefined ? clean(req.body.name, 40) : c.name;
  if (!name) throw httpError(400, 'El nombre no puede estar vacío.');
  const isPublic = typeof req.body.is_public === 'boolean' ? (req.body.is_public ? 1 : 0) : c.is_public;
  db.prepare('UPDATE collections SET name = ?, is_public = ?, updated_at = ? WHERE id = ?').run(name, isPublic, now(), c.id);
  res.json({ id: c.id, name, is_public: Boolean(isPublic) });
});

r.post('/api/collections/:id/delete', requireAuth, limiters.api, (req, res) => {
  const c = getOwnCollection(req, req.params.id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(c.id); // los looks siguen en "Todos"
  res.json({ deleted: true });
});

function addToCollection(userId, collectionId, postId) {
  tx(() => {
    // Añadir a una colección implica tenerlo guardado.
    db.prepare('INSERT OR IGNORE INTO saves (user_id, post_id, created_at) VALUES (?, ?, ?)').run(userId, postId, now());
    db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, post_id, added_at) VALUES (?, ?, ?)').run(collectionId, postId, now());
    db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now(), collectionId);
    refreshSaveCount(postId);
  });
}

/** Añadir/quitar uno o varios looks de una colección. body: { add: [ids], remove: [ids] } */
r.post('/api/collections/:id/items', requireAuth, limiters.api, (req, res) => {
  const c = getOwnCollection(req, req.params.id);
  const ids = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).map(intParam).filter(Boolean).slice(0, 200);
  const add = ids(req.body.add);
  const remove = ids(req.body.remove);
  for (const postId of add) if (postExists.get(postId)) addToCollection(req.user.id, c.id, postId);
  if (remove.length) {
    const del = db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND post_id = ?');
    tx(() => remove.forEach((p) => del.run(c.id, p)));
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?').get(c.id).n;
  res.json({ ok: true, count });
});

/* ───────────── Página de guardados (estilo TikTok) ───────────── */
r.get('/guardados', requireAuth, (req, res) => {
  const collections = collectionsOf(req.user.id);
  const active = req.query.c ? getOwnCollection(req, req.query.c) : null;
  const items = savedLooks(req.user.id, active?.id);
  const all = active ? savedLooks(req.user.id) : items;
  const inActive = new Set(items.map((i) => i.id));
  res.render('saved', {
    collections, active, items,
    pickable: active ? all.filter((l) => !inActive.has(l.id)) : [],
    allCovers: all.filter((l) => l.cover).slice(0, 4).map((l) => l.cover.thumb),
    totalSaved: active ? all.length : items.length,
    meta: { title: active ? `${active.name} · Guardados` : 'Tus guardados', noindex: true },
  });
});

/* ───────────── Colección pública compartible ───────────── */
r.get('/c/:id', (req, res, next) => {
  const c = db.prepare(`SELECT c.*, u.username, u.display_name, u.avatar FROM collections c JOIN users u ON u.id = c.user_id
    WHERE c.id = ? AND u.status = 'active'`).get(intParam(req.params.id) || 0);
  if (!c || (!c.is_public && c.user_id !== req.user?.id)) return next(httpError(404, 'No encontrado'));
  const items = savedLooks(req.user?.id, c.id);
  res.render('collection', {
    c, items,
    meta: { title: `${c.name} — colección de @${c.username}`, description: `${items.length} looks streetwear seleccionados por @${c.username} en VIBRA.`, noindex: !c.is_public },
  });
});

export default r;
