import { db } from './db.js';

export const PAGE_SIZE = 24;

const IMAGES_SQL = `(SELECT json_group_array(json_object('file', file, 'thumb', thumb, 'w', width, 'h', height, 'color', color))
   FROM (SELECT * FROM post_images WHERE post_id = p.id ORDER BY position)) AS images`;

const BASE_SELECT = (userId) => `
  SELECT p.id, p.user_id, p.title, p.description, p.city, p.tags, p.pieces, p.status, p.removal_reason,
         p.save_count, p.view_count, p.created_at,
         u.username, u.display_name, u.avatar, u.og,
         ${IMAGES_SQL},
         ${userId ? 'EXISTS(SELECT 1 FROM saves s WHERE s.user_id = ' + Number(userId) + ' AND s.post_id = p.id)' : '0'} AS saved
  FROM posts p JOIN users u ON u.id = p.user_id`;

export function hydrate(row) {
  if (!row) return null;
  const images = JSON.parse(row.images || '[]');
  let pieces = [];
  try { pieces = JSON.parse(row.pieces || '[]'); } catch { /* datos antiguos */ }
  return {
    ...row,
    images,
    cover: images[0] || null,
    pieces,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    saved: Boolean(row.saved),
  };
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export const SORTS = {
  recientes: 'p.created_at DESC',
  top: 'p.save_count DESC, p.created_at DESC',
  tendencia: '(SELECT COUNT(*) FROM saves s2 WHERE s2.post_id = p.id AND s2.created_at > :week) DESC, p.created_at DESC',
};

export function feed({ userId = null, tag = '', q = '', sort = 'recientes', page = 1, city = '', following = false } = {}) {
  const where = ["p.status = 'published'", "u.status = 'active'"];
  if (following && userId) where.push('p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ' + Number(userId) + ')');
  const params = {};
  if (tag) { where.push("(',' || p.tags || ',') LIKE :tag ESCAPE '\\'"); params.tag = `%,${likeEscape(tag)},%`; }
  if (city) { where.push('p.city = :city COLLATE NOCASE'); params.city = city; }
  if (q) {
    where.push("(p.title LIKE :q ESCAPE '\\' OR p.description LIKE :q ESCAPE '\\' OR p.tags LIKE :q ESCAPE '\\' OR p.city LIKE :q ESCAPE '\\' OR u.username LIKE :q ESCAPE '\\' OR p.pieces LIKE :q ESCAPE '\\')");
    params.q = `%${likeEscape(q)}%`;
  }
  const order = SORTS[sort] || SORTS.recientes;
  if (sort === 'tendencia') params.week = Date.now() - 7 * 86400000;
  params.limit = PAGE_SIZE + 1;
  params.offset = (page - 1) * PAGE_SIZE;

  const rows = db.prepare(`${BASE_SELECT(userId)} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`).all(params);
  const hasMore = rows.length > PAGE_SIZE;
  return { items: rows.slice(0, PAGE_SIZE).map(hydrate), hasMore };
}

export function getLook(id, userId = null) {
  return hydrate(db.prepare(`${BASE_SELECT(userId)} WHERE p.id = ?`).get(id));
}

export function userLooks(ownerId, viewerId, { includeHidden = false } = {}) {
  const status = includeHidden ? "p.status IN ('published','removed','review')" : "p.status = 'published'";
  return db.prepare(`${BASE_SELECT(viewerId)} WHERE p.user_id = ? AND ${status} ORDER BY p.created_at DESC LIMIT 200`).all(ownerId).map(hydrate);
}

export function savedLooks(userId, collectionId = null) {
  if (collectionId) {
    return db.prepare(`${BASE_SELECT(userId)} JOIN collection_items ci ON ci.post_id = p.id
      WHERE ci.collection_id = ? AND p.status = 'published' ORDER BY ci.added_at DESC`).all(collectionId).map(hydrate);
  }
  return db.prepare(`${BASE_SELECT(userId)} JOIN saves sv ON sv.post_id = p.id
    WHERE sv.user_id = ? AND p.status = 'published' ORDER BY sv.created_at DESC`).all(userId).map(hydrate);
}

export function collectionsOf(userId, { onlyPublic = false } = {}) {
  return db.prepare(`
    SELECT c.id, c.name, c.is_public, c.updated_at,
      (SELECT COUNT(*) FROM collection_items ci JOIN posts p ON p.id = ci.post_id WHERE ci.collection_id = c.id AND p.status = 'published') AS count,
      (SELECT json_group_array(thumb) FROM (
         SELECT (SELECT thumb FROM post_images pi WHERE pi.post_id = ci.post_id ORDER BY position LIMIT 1) AS thumb
         FROM collection_items ci JOIN posts p ON p.id = ci.post_id
         WHERE ci.collection_id = c.id AND p.status = 'published' ORDER BY ci.added_at DESC LIMIT 4)) AS covers
    FROM collections c WHERE c.user_id = ? ${onlyPublic ? 'AND c.is_public = 1' : ''}
    ORDER BY c.updated_at DESC`).all(userId)
    .map((c) => ({ ...c, covers: JSON.parse(c.covers || '[]').filter(Boolean), is_public: Boolean(c.is_public) }));
}

export function topTags(limit = 14) {
  const rows = db.prepare("SELECT tags FROM posts WHERE status = 'published' AND tags != '' ORDER BY created_at DESC LIMIT 500").all();
  const count = new Map();
  for (const r of rows) for (const t of r.tags.split(',')) if (t) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

export function topCities(limit = 12) {
  return db.prepare("SELECT city, COUNT(*) AS n FROM posts WHERE status = 'published' AND city != '' GROUP BY city COLLATE NOCASE ORDER BY n DESC LIMIT ?").all(limit).map((r) => r.city);
}

export function siteStats() {
  return db.prepare(`SELECT
    (SELECT COUNT(*) FROM posts WHERE status = 'published') AS looks,
    (SELECT COUNT(*) FROM users WHERE status = 'active') AS users,
    (SELECT COUNT(*) FROM saves) AS saves`).get();
}
