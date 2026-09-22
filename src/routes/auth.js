import { Router } from 'express';
import { db, now } from '../db.js';
import { config } from '../config.js';
import { sessionStore } from '../session-store.js';
import { hashPassword, verifyPassword, passwordProblem, limiters, safeNext, randomToken, sha256, verifyTurnstile } from '../security.js';
import { clean, usernameProblem, EMAIL_RE } from '../util.js';
import { sendMail } from '../mailer.js';

export const TERMS_VERSION = '2026-09';
const r = Router();

const meta = (title) => ({ title, noindex: true });

/** Inicia sesión regenerando el identificador (previene fijación de sesión). */
export const loginSession = (req, userId) => login(req, userId);

function login(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

/* ───────────── Registro ───────────── */
r.get('/registro', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register', { meta: meta('Crear cuenta'), form: {}, error: null, next: safeNext(req.query.next) });
});

r.post('/registro', limiters.register, async (req, res, next) => {
  try {
    const form = {
      username: clean(req.body.username, 24).toLowerCase(),
      email: clean(req.body.email, 254).toLowerCase(),
    };
    const nextUrl = safeNext(req.body.next);
    const fail = (error, status = 400) => res.status(status).render('auth/register', { meta: meta('Crear cuenta'), form, error, next: nextUrl });

    if (req.body.website) return fail('No se pudo completar el registro.'); // honeypot anti-bots
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const uErr = usernameProblem(form.username);
    if (uErr) return fail(uErr);
    if (!EMAIL_RE.test(form.email)) return fail('Introduce un email válido.');
    const pErr = passwordProblem(password, form);
    if (pErr) return fail(pErr);
    if (password !== req.body.password2) return fail('Las contraseñas no coinciden.');
    if (req.body.age !== 'on') return fail('Debes confirmar que tienes 14 años o más.');
    if (req.body.terms !== 'on') return fail('Debes aceptar los Términos y la Política de privacidad.');
    if (!(await verifyTurnstile(req))) return fail('No hemos podido verificar que no eres un bot. Inténtalo de nuevo.');

    const exists = db.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?').get(form.username, form.email);
    // Mensaje genérico para el email: no revelamos qué correos están registrados.
    if (exists?.username?.toLowerCase() === form.username) return fail('Ese nombre de usuario ya está cogido.');
    if (exists) return fail('No se pudo crear la cuenta con esos datos. Si ya tienes cuenta, inicia sesión o recupera tu contraseña.');

    const hash = await hashPassword(password);
    const t = now();
    const role = config.adminEmail && form.email === config.adminEmail ? 'admin' : 'user';
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (username, email, password_hash, display_name, role, terms_version, terms_accepted_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(form.username, form.email, hash, form.username, role, TERMS_VERSION, t, t);

    await login(req, Number(lastInsertRowid));
    req.session.flash = { type: 'ok', msg: `Bienvenid@ a la pasarela, @${form.username}.` };
    res.redirect(nextUrl === '/' ? '/subir' : nextUrl);
  } catch (e) { next(e); }
});

/* ───────────── Inicio de sesión ───────────── */
r.get('/entrar', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { meta: meta('Entrar'), form: {}, error: null, next: safeNext(req.query.next) });
});

r.post('/entrar', limiters.auth, async (req, res, next) => {
  try {
    const id = clean(req.body.identifier, 254).toLowerCase().replace(/^@/, '');
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 256) : '';
    const nextUrl = safeNext(req.body.next);
    const user = db.prepare('SELECT id, password_hash, status FROM users WHERE email = ? OR username = ?').get(id, id);
    const ok = await verifyPassword(password, user?.password_hash);
    if (!user || !ok) {
      return res.status(401).render('auth/login', { meta: meta('Entrar'), form: { identifier: id }, error: 'Usuario o contraseña incorrectos.', next: nextUrl });
    }
    if (user.status !== 'active') {
      return res.status(403).render('auth/login', { meta: meta('Entrar'), form: { identifier: id }, error: 'Esta cuenta está suspendida. Si crees que es un error, escríbenos.', next: nextUrl });
    }
    await login(req, user.id);
    res.redirect(nextUrl);
  } catch (e) { next(e); }
});

r.post('/salir', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(config.isProd ? '__Host-vibra.sid' : 'vibra.sid', { path: '/', secure: config.isProd, httpOnly: true, sameSite: 'lax' });
    res.redirect('/');
  });
});

/* ───────────── Recuperar contraseña ───────────── */
r.get('/olvide', (req, res) => {
  res.render('auth/forgot', { meta: meta('Recuperar contraseña'), sent: false, error: null });
});

r.post('/olvide', limiters.reset, async (req, res, next) => {
  try {
    const email = clean(req.body.email, 254).toLowerCase();
    if (!(await verifyTurnstile(req))) {
      return res.status(400).render('auth/forgot', { meta: meta('Recuperar contraseña'), sent: false, error: 'Verificación anti-bots fallida.' });
    }
    const user = EMAIL_RE.test(email) && db.prepare("SELECT id, username FROM users WHERE email = ? AND status = 'active'").get(email);
    if (user) {
      const token = randomToken(32);
      db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, now());
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), user.id, now() + 60 * 60 * 1000);
      const link = `${config.siteUrl}/restablecer/${token}`;
      sendMail({
        to: email,
        subject: `${config.siteName} · Restablece tu contraseña`,
        text: `Hola @${user.username},\n\nPara crear una nueva contraseña abre este enlace (caduca en 1 hora):\n${link}\n\nSi no lo has pedido tú, ignora este mensaje: tu cuenta sigue segura.\n\n— ${config.siteName}`,
      }).catch((e) => console.error('[mail]', e.message));
    }
    // Misma respuesta exista o no la cuenta (evita enumeración de usuarios).
    res.render('auth/forgot', { meta: meta('Recuperar contraseña'), sent: true, error: null });
  } catch (e) { next(e); }
});

const findReset = (token) => typeof token === 'string' && token.length < 100
  ? db.prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?').get(sha256(token), now())
  : null;

r.get('/restablecer/:token', (req, res) => {
  const valid = Boolean(findReset(req.params.token));
  res.render('auth/reset', { meta: meta('Nueva contraseña'), valid, token: req.params.token, error: null });
});

r.post('/restablecer/:token', limiters.reset, async (req, res, next) => {
  try {
    const row = findReset(req.params.token);
    if (!row) return res.status(400).render('auth/reset', { meta: meta('Nueva contraseña'), valid: false, token: '', error: null });
    const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(row.user_id);
    const pw = typeof req.body.password === 'string' ? req.body.password : '';
    const problem = passwordProblem(pw, user) || (pw !== req.body.password2 ? 'Las contraseñas no coinciden.' : null);
    if (problem) return res.status(400).render('auth/reset', { meta: meta('Nueva contraseña'), valid: true, token: req.params.token, error: problem });

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
    sessionStore.destroyUser(row.user_id); // cierra sesiones abiertas en otros dispositivos
    await login(req, row.user_id);
    req.session.flash = { type: 'ok', msg: 'Contraseña actualizada. Ya estás dentro.' };
    res.redirect('/');
  } catch (e) { next(e); }
});

export default r;
