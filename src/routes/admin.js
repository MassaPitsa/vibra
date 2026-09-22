import { Router } from 'express';
import { db, now } from '../db.js';
import { sessionStore } from '../session-store.js';
import { requireAuth, requireAdmin } from '../security.js';
import { REPORT_REASONS } from './posts.js';
import { clean, intParam, httpError } from '../util.js';

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
  res.render('admin', { reports, stats, removed, reasons: REPORT_REASONS, meta: { title: 'Moderación', noindex: true } });
});

r.post('/admin/reports/:id/dismiss', (req, res) => {
  db.prepare("UPDATE reports SET status = 'dismissed', resolved_at = ? WHERE id = ?").run(now(), intParam(req.params.id) || 0);
  res.redirect('/admin');
});

// Retirada con "declaración de motivos" visible para el autor (DSA art. 17).
r.post('/admin/looks/:id/remove', (req, res) => {
  const id = intParam(req.params.id);
  const reason = clean(req.body.reason, 500, { multiline: true });
  if (!id || reason.length < 5) throw httpError(400, 'Indica el motivo de la retirada (lo verá el autor).');
  db.prepare("UPDATE posts SET status = 'removed', removal_reason = ? WHERE id = ?").run(reason, id);
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
