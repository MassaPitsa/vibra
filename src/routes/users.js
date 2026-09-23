import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { sessionStore } from '../session-store.js';
import { requireAuth, csrfMultipart, limiters, verifyPassword, hashPassword, passwordProblem } from '../security.js';
import { uploader, processAvatar, removeFiles } from '../images.js';
import { userLooks, collectionsOf } from '../queries.js';
import { clean, safeInstagram, httpError, USERNAME_RE } from '../util.js';
import { mediaAbsolute } from '../storage.js';

const r = Router();

/* ───────────── Perfil público ───────────── */
r.get('/u/:username', (req, res, next) => {
  const username = String(req.params.username).toLowerCase();
  if (!USERNAME_RE.test(username)) return next(httpError(404, 'No encontrado'));
  const profile = db.prepare(`SELECT id, username, display_name, bio, city, instagram, avatar, og, created_at, status FROM users WHERE username = ?`).get(username);
  if (!profile || profile.status !== 'active') return next(httpError(404, 'No encontrado'));
  const isMe = req.user?.id === profile.id;
  const looks = userLooks(profile.id, req.user?.id, { includeHidden: isMe });
  const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ? AND status = 'published') AS looks,
      (SELECT COALESCE(SUM(save_count), 0) FROM posts WHERE user_id = ? AND status = 'published') AS saves,
      (SELECT COALESCE(SUM(view_count), 0) FROM posts WHERE user_id = ? AND status = 'published') AS views,
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following`)
    .get(profile.id, profile.id, profile.id, profile.id, profile.id);
  const iFollow = Boolean(req.user && db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, profile.id));
  res.render('profile', {
    profile, looks, stats, isMe, iFollow,
    collections: collectionsOf(profile.id, { onlyPublic: true }).filter((c) => c.count > 0),
    meta: {
      title: `${profile.display_name || profile.username} (@${profile.username})`,
      description: profile.bio || `Los outfits streetwear de @${profile.username} en VIBRA.`,
      image: profile.avatar ? mediaAbsolute(profile.avatar) : null,
      type: 'profile',
      noindex: stats.looks === 0,
    },
  });
});

/* ───────────── Ajustes de cuenta ───────────── */
const renderSettings = (req, res, extra = {}) => {
  const me = db.prepare('SELECT username, email, display_name, bio, city, instagram, avatar, created_at, terms_version, terms_accepted_at, google_sub, password_hash FROM users WHERE id = ?').get(req.user.id);
  me.hasGoogle = Boolean(me.google_sub);
  me.hasPassword = Boolean(me.password_hash);
  delete me.password_hash;
  delete me.google_sub;
  res.status(extra.status || 200).render('settings', { me, error: null, section: null, meta: { title: 'Ajustes', noindex: true }, ...extra });
};

r.get('/ajustes', requireAuth, (req, res) => renderSettings(req, res));

r.post('/ajustes/perfil', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET display_name = ?, bio = ?, city = ?, instagram = ? WHERE id = ?').run(
    clean(req.body.display_name, 40) || req.user.username,
    clean(req.body.bio, 280, { multiline: true }),
    clean(req.body.city, 40),
    safeInstagram(req.body.instagram),
    req.user.id,
  );
  req.session.flash = { type: 'ok', msg: 'Perfil actualizado.' };
  res.redirect('/ajustes');
});

const avatarUpload = uploader(1);
r.post('/ajustes/avatar', requireAuth, limiters.upload, avatarUpload.single('avatar'), csrfMultipart, async (req, res, next) => {
  try {
    if (!req.file) return renderSettings(req, res, { status: 400, error: 'Elige una imagen.', section: 'perfil' });
    const file = await processAvatar(req.file.buffer);
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id).avatar;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(file, req.user.id);
    await removeFiles(old);
    req.session.flash = { type: 'ok', msg: 'Foto de perfil actualizada.' };
    res.redirect('/ajustes');
  } catch (e) {
    if (e.expose) return renderSettings(req, res, { status: 400, error: e.message, section: 'perfil' });
    next(e);
  }
});

r.post('/ajustes/password', requireAuth, limiters.auth, async (req, res, next) => {
  try {
    const row = db.prepare('SELECT password_hash, username, email FROM users WHERE id = ?').get(req.user.id);
    // Quien entró con Google todavía no tiene contraseña: puede crear una sin pedir la anterior.
    if (row.password_hash && !(await verifyPassword(String(req.body.current || ''), row.password_hash))) {
      return renderSettings(req, res, { status: 400, error: 'La contraseña actual no es correcta.', section: 'seguridad' });
    }
    const pw = String(req.body.password || '');
    const problem = passwordProblem(pw, row) || (pw !== req.body.password2 ? 'Las contraseñas no coinciden.' : null);
    if (problem) return renderSettings(req, res, { status: 400, error: problem, section: 'seguridad' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), req.user.id);
    // Cierra el resto de sesiones y mantiene la actual con un id nuevo.
    sessionStore.destroyUser(req.user.id);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = req.user.id;
      req.session.flash = { type: 'ok', msg: 'Contraseña cambiada. Hemos cerrado tus otras sesiones.' };
      res.redirect('/ajustes');
    });
  } catch (e) { next(e); }
});

/* ───────────── Reclamar el rol de administrador con un código secreto ─────────────
   El alta por email no da permisos porque el correo no está verificado: quien conozca
   el email del administrador podría adelantarse. Con un código de ADMIN_CLAIM_CODE,
   sólo quien tenga acceso a la configuración del servidor puede promocionarse. */
r.post('/ajustes/admin', requireAuth, limiters.auth, (req, res) => {
  const code = config.adminClaimCode;
  const sent = String(req.body.code || '');
  const ok = code.length >= 16 && sent.length === code.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(code));
  if (!ok) return renderSettings(req, res, { status: 400, error: 'Código de administración incorrecto.', section: 'seguridad' });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(req.user.id);
  console.log(`[admin] @${req.user.username} (${req.user.email}) se ha promocionado a administrador`);
  req.session.flash = { type: 'ok', msg: 'Ya eres administrador: tienes acceso al panel de moderación.' };
  res.redirect('/admin');
});

/* ───────────── Derecho de acceso y portabilidad (RGPD arts. 15 y 20) ───────────── */
r.get('/ajustes/exportar', requireAuth, (req, res) => {
  const id = req.user.id;
  const data = {
    exported_at: new Date().toISOString(),
    service: config.siteName,
    account: db.prepare('SELECT username, email, display_name, bio, city, instagram, role, terms_version, terms_accepted_at, created_at FROM users WHERE id = ?').get(id),
    looks: db.prepare('SELECT id, title, description, city, tags, pieces, status, save_count, view_count, created_at FROM posts WHERE user_id = ?').all(id)
      .map((p) => ({ ...p, url: `${config.siteUrl}/look/${p.id}`, images: db.prepare('SELECT file FROM post_images WHERE post_id = ? ORDER BY position').all(p.id).map((i) => mediaAbsolute(i.file)) })),
    saved: db.prepare('SELECT post_id, created_at FROM saves WHERE user_id = ?').all(id),
    collections: db.prepare('SELECT id, name, is_public, created_at FROM collections WHERE user_id = ?').all(id)
      .map((c) => ({ ...c, posts: db.prepare('SELECT post_id FROM collection_items WHERE collection_id = ?').all(c.id).map((x) => x.post_id) })),
    reports_sent: db.prepare('SELECT post_id, reason, details, created_at FROM reports WHERE reporter_id = ?').all(id),
  };
  res.set('Content-Disposition', `attachment; filename="vibra-datos-${req.user.username}.json"`);
  res.set('Cache-Control', 'no-store');
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

/* ───────────── Derecho de supresión (RGPD art. 17) ───────────── */
r.post('/ajustes/eliminar', requireAuth, limiters.auth, async (req, res, next) => {
  try {
    const row = db.prepare('SELECT password_hash, avatar FROM users WHERE id = ?').get(req.user.id);
    if (req.body.confirm !== req.user.username || !(await verifyPassword(String(req.body.password || ''), row.password_hash))) {
      return renderSettings(req, res, { status: 400, error: 'Para eliminar la cuenta escribe tu usuario exacto y tu contraseña.', section: 'peligro' });
    }
    const files = db.prepare('SELECT file, thumb FROM post_images pi JOIN posts p ON p.id = pi.post_id WHERE p.user_id = ?').all(req.user.id);
    const affected = db.prepare('SELECT DISTINCT post_id FROM saves WHERE user_id = ?').all(req.user.id).map((x) => x.post_id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // cascada completa
    const upd = db.prepare('UPDATE posts SET save_count = (SELECT COUNT(*) FROM saves WHERE post_id = ?) WHERE id = ?');
    affected.forEach((p) => upd.run(p, p));
    await removeFiles(row.avatar, ...files.flatMap((f) => [f.file, f.thumb]));
    sessionStore.destroyUser(req.user.id);
    req.session.destroy(() => res.redirect('/?adios=1'));
  } catch (e) { next(e); }
});

export default r;
