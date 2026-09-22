import { db, now } from './db.js';

/**
 * Notificaciones dentro de la web (sin emails). Tipos:
 *  save       → alguien ha guardado tu look
 *  collect    → alguien ha añadido tu look a una colección pública
 *  follow     → alguien te sigue
 *  moderation → hemos retirado o restaurado un look tuyo
 */
const insert = db.prepare('INSERT INTO notifications (user_id, type, actor_id, post_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)');

/** Evita avisar dos veces de lo mismo (p. ej. guardar, quitar y volver a guardar). */
const recent = db.prepare(`SELECT 1 FROM notifications
  WHERE user_id = ? AND type = ? AND IFNULL(actor_id, 0) = ? AND IFNULL(post_id, 0) = ? AND created_at > ?`);

export function notify({ userId, type, actorId = null, postId = null, text = '', dedupeHours = 24 }) {
  if (!userId || userId === actorId) return; // nunca te notificas a ti mismo
  if (dedupeHours && recent.get(userId, type, actorId ?? 0, postId ?? 0, now() - dedupeHours * 3600_000)) return;
  insert.run(userId, type, actorId, postId, text, now());
}

export const unreadCount = (userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

export function listNotifications(userId, limit = 60) {
  return db.prepare(`
    SELECT n.id, n.type, n.text, n.post_id, n.read_at, n.created_at,
           u.username AS actor, u.avatar AS actor_avatar,
           p.title AS post_title, p.status AS post_status,
           (SELECT thumb FROM post_images WHERE post_id = n.post_id ORDER BY position LIMIT 1) AS thumb
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN posts p ON p.id = n.post_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`).all(userId, limit);
}

export const markAllRead = (userId) =>
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), userId);

/** Limpieza: conserva 90 días de historial. */
export const purgeOld = () =>
  db.prepare('DELETE FROM notifications WHERE created_at < ?').run(now() - 90 * 864e5);
