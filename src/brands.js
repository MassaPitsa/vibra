import { db } from './db.js';

/** Convierte «Carhartt WIP» en «carhartt-wip» para las URLs de marca. */
export function brandSlug(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

const del = db.prepare('DELETE FROM post_brands WHERE post_id = ?');
const ins = db.prepare('INSERT OR IGNORE INTO post_brands (post_id, slug, name) VALUES (?, ?, ?)');

/** Reescribe las marcas de un look a partir de sus créditos. */
export function indexBrands(postId, pieces) {
  del.run(postId);
  const seen = new Set();
  for (const p of pieces || []) {
    const name = (p.brand || '').trim();
    const slug = brandSlug(name);
    if (!slug || slug.length < 2 || seen.has(slug)) continue;
    seen.add(slug);
    ins.run(postId, slug, name.slice(0, 40));
  }
}

/** Nombre más usado para una marca (los usuarios la escriben de formas distintas). */
export function brandName(slug) {
  const row = db.prepare(`SELECT name, COUNT(*) AS n FROM post_brands pb JOIN posts p ON p.id = pb.post_id
    WHERE pb.slug = ? AND p.status = 'published' GROUP BY name ORDER BY n DESC LIMIT 1`).get(slug);
  return row?.name || null;
}

export function topBrands(limit = 60) {
  return db.prepare(`SELECT pb.slug, MIN(pb.name) AS name, COUNT(*) AS n
    FROM post_brands pb JOIN posts p ON p.id = pb.post_id
    WHERE p.status = 'published'
    GROUP BY pb.slug ORDER BY n DESC, name LIMIT ?`).all(limit);
}

/** Rellena la tabla de marcas la primera vez (looks publicados antes de esta función). */
export function backfillBrands() {
  const pending = db.prepare(`SELECT id, pieces FROM posts
    WHERE pieces != '[]' AND id NOT IN (SELECT post_id FROM post_brands)`).all();
  for (const p of pending) {
    try { indexBrands(p.id, JSON.parse(p.pieces)); } catch { /* datos antiguos */ }
  }
  return pending.length;
}
