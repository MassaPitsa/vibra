import { Router } from 'express';
import { db, now } from '../db.js';
import { sessionStore } from '../session-store.js';
import { requireAuth, requireAdmin } from '../security.js';
import { REPORT_REASONS } from './posts.js';
import { clean, intParam, httpError } from '../util.js';
import { notify } from '../notifications.js';

const r = Router();
r.use('/admin', requireAuth, requireAdmin);

r.get('/admin', (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, p.title, p.status AS post_status, p.user_id AS author_id, u.username AS author,
      (SELECT thumb FROM post_images WHERE post_id = p.id ORDER BY position LIMIT 1) AS thumb,
      (SELECT COUNT(*) FROM reports r2 WHERE r2.post_id = r.post_id AND r2.status = 'open') AS same
    FROM reports r JOIN posts p ON p.id = r.post_id JOIN users u ON u.id = p.user_id
    WHERE r.status = 'open' ORDER BY same DESC, r.created_at ASC LIMIT 200`).all();
  const stats = db.prepare(`SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM users WHERE created_at > ?) AS users7,
    (SELECT COUNT(*) FROM posts WHERE status = 'published') AS looks,
    (SELECT COUNT(*) FROM posts WHERE created_at > ?) AS looks7,
    (SELECT COUNT(*) FROM saves) AS saves,
    (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open`).get(now() - 7 * 864e5, now() - 7 * 864e5);
  const removed = db.prepare(`SELECT p.id, p.title, p.removal_reason, u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.status = 'removed' ORDER BY p.id DESC LIMIT 30`).all();
  // Cola de moderación automática: primero lo oculto, después lo marcado como dudoso.
  const queue = db.prepare(`
    SELECT p.id, p.title, p.status, p.flag_score, p.flag_reason, p.created_at, u.username, u.id AS author_id,
      (SELECT thumb FROM post_images WHERE post_id = p.id ORDER BY position LIMIT 1) AS thumb
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.reviewed_at IS NULL AND (p.status = 'review' OR p.flag_score >= 0.45)
    ORDER BY (p.status = 'review') DESC, p.flag_score DESC LIMIT 50`).all();
  res.render('admin', { reports, stats, removed, queue, reasons: REPORT_REASONS, meta: { title: 'Moderación', noindex: true } });
});

r.post('/admin/reports/:id/dismiss', (req, res) => {
  db.prepare("UPDATE reports SET status = 'dismissed', resolved_at = ? WHERE id = ?").run(now(), intParam(req.params.id) || 0);
  res.redirect('/admin');
});

// Aprobar un look que la moderación automática había marcado u ocultado.
r.post('/admin/looks/:id/approve', (req, res) => {
  const id = intParam(req.params.id);
  const post = id && db.prepare('SELECT user_id, status FROM posts WHERE id = ?').get(id);
  if (!post) throw httpError(404, 'No encontrado');
  db.prepare("UPDATE posts SET status = 'published', flag_score = 0, flag_reason = NULL, reviewed_at = ? WHERE id = ?").run(now(), id);
  if (post.status === 'review') {
    notify({ userId: post.user_id, type: 'moderation', postId: id, text: 'Hemos revisado tu look y ya está publicado.', dedupeHours: 0 });
  }
  res.redirect('/admin');
});

// Retirada con "declaración de motivos" visible para el autor (DSA art. 17).
r.post('/admin/looks/:id/remove', (req, res) => {
  const id = intParam(req.params.id);
  const reason = clean(req.body.reason, 500, { multiline: true });
  if (!id || reason.length < 5) throw httpError(400, 'Indica el motivo de la retirada (lo verá el autor).');
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(id);
  db.prepare("UPDATE posts SET status = 'removed', removal_reason = ?, reviewed_at = ? WHERE id = ?").run(reason, now(), id);
  if (post) notify({ userId: post.user_id, type: 'moderation', postId: id, text: `Hemos retirado tu look: ${reason}`, dedupeHours: 0 });
  db.prepare("UPDATE reports SET status = 'actioned', resolved_at = ? WHERE post_id = ? AND status = 'open'").run(now(), id);
  res.redirect('/admin');
});

r.post('/admin/looks/:id/restore', (req, res) => {
  db.prepare("UPDATE posts SET status = 'published', removal_reason = NULL WHERE id = ?").run(intParam(req.params.id) || 0);
  res.redirect('/admin');
});

r.post('/admin/users/:id/suspend', (req, res) => {
  const id = intParam(req.params.id);
  if (!id || id === req.user.id) throw httpError(400, 'Operación no válida.');
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ? AND role != 'admin'").run(id);
  db.prepare("UPDATE posts SET status = 'removed', removal_reason = COALESCE(removal_reason, 'Cuenta suspendida por incumplir las normas de la comunidad.') WHERE user_id = ? AND status = 'published'").run(id);
  sessionStore.destroyUser(id);
  res.redirect('/admin');
});

export default r;
