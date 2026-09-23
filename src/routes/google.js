import crypto from 'node:crypto';
import { Router } from 'express';
import { db, now } from '../db.js';
import { config } from '../config.js';
import { limiters, safeNext, randomToken } from '../security.js';
import { clean, usernameProblem, httpError, OG_LIMIT } from '../util.js';
import { TERMS_VERSION, loginSession } from './auth.js';

/**
 * Acceso con Google (OpenID Connect, flujo de código de autorización).
 * Sólo pedimos los permisos básicos «openid email profile», que no son sensibles:
 * Google no exige verificación de la app para usarlos con todo el mundo.
 */
const r = Router();
export const googleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);
const redirectUri = () => `${config.siteUrl}/auth/google/callback`;

r.get('/auth/google', limiters.auth, (req, res, next) => {
  if (!googleEnabled()) return next();
  if (req.user) return res.redirect('/');
  const state = randomToken(24);
  const nonce = randomToken(16);
  req.session.oauth = { state, nonce, next: safeNext(req.query.next), at: now() };
  req.session.save((err) => {
    if (err) return next(err);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state, nonce,
      prompt: 'select_account',
    });
    res.redirect(url.href);
  });
});

r.get('/auth/google/callback', limiters.auth, async (req, res, next) => {
  if (!googleEnabled()) return next();
  const saved = req.session.oauth;
  delete req.session.oauth;
  const fail = (msg) => res.status(400).render('auth/login', {
    meta: { title: 'Entrar', noindex: true }, form: {}, error: msg, next: '/',
  });

  try {
    if (req.query.error) return fail('Has cancelado el acceso con Google.');
    if (!saved || !req.query.state || req.query.state !== saved.state || now() - saved.at > 10 * 60_000) {
      return fail('La sesión de Google ha caducado. Inténtalo de nuevo.');
    }

    // Canje del código por el token, hablando directamente con Google por HTTPS.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code || ''),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.id_token) {
      console.error('[google] token:', token);
      return fail('Google no ha podido completar el acceso. Inténtalo de nuevo.');
    }

    const claims = decodeIdToken(token.id_token);
    const issuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!claims || claims.aud !== config.google.clientId || !issuers.includes(claims.iss) ||
        claims.exp * 1000 < Date.now() || claims.nonce !== saved.nonce) {
      return fail('No hemos podido verificar la respuesta de Google.');
    }
    if (!claims.email || claims.email_verified === false) {
      return fail('Tu cuenta de Google no tiene el email verificado.');
    }

    const email = String(claims.email).toLowerCase();
    const nextUrl = safeNext(saved.next);

    // 1) Ya tiene cuenta enlazada con Google
    const linked = db.prepare('SELECT id, status FROM users WHERE google_sub = ?').get(claims.sub);
    if (linked) {
      if (linked.status !== 'active') return fail('Esta cuenta está suspendida.');
      await loginSession(req, linked.id);
      return res.redirect(nextUrl);
    }

    // 2) Ya existe una cuenta con ese email: se enlaza (el email de Google está verificado)
    const byEmail = db.prepare('SELECT id, status FROM users WHERE email = ?').get(email);
    if (byEmail) {
      if (byEmail.status !== 'active') return fail('Esta cuenta está suspendida.');
      db.prepare('UPDATE users SET google_sub = ?, email_verified = 1 WHERE id = ?').run(claims.sub, byEmail.id);
      await loginSession(req, byEmail.id);
      req.session.flash = { type: 'ok', msg: 'Hemos conectado tu cuenta de Google.' };
      return res.redirect(nextUrl);
    }

    // 3) Usuario nuevo: falta elegir alias y aceptar las condiciones (hay que registrarlo).
    req.session.pendingGoogle = { sub: claims.sub, email, name: clean(claims.name, 40), next: nextUrl, at: now() };
    res.redirect('/registro/google');
  } catch (e) {
    next(e);
  }
});

/* ───────────── Último paso del registro con Google ───────────── */
const suggestUsername = (email, name) => {
  const base = (name || email.split('@')[0]).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._]/g, '').replace(/^[._]+|[._]+$/g, '').slice(0, 20) || 'look';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}${i}`;
    if (candidate.length >= 3 && !usernameProblem(candidate) &&
        !db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) return candidate;
  }
  return `look${crypto.randomInt(1000, 9999)}`;
};

const pending = (req) => {
  const p = req.session.pendingGoogle;
  if (!p || now() - p.at > 30 * 60_000) return null;
  return p;
};

r.get('/registro/google', (req, res, next) => {
  const p = pending(req);
  if (!p) return next(httpError(400, 'El registro con Google ha caducado. Empieza de nuevo.'));
  res.render('auth/google', {
    meta: { title: 'Completa tu registro', noindex: true },
    email: p.email, username: suggestUsername(p.email, p.name), error: null,
  });
});

r.post('/registro/google', limiters.register, async (req, res, next) => {
  const p = pending(req);
  if (!p) return next(httpError(400, 'El registro con Google ha caducado. Empieza de nuevo.'));
  const username = clean(req.body.username, 24).toLowerCase();
  const fail = (error) => res.status(400).render('auth/google', {
    meta: { title: 'Completa tu registro', noindex: true }, email: p.email, username, error,
  });
  try {
    const problem = usernameProblem(username);
    if (problem) return fail(problem);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail('Ese nombre de usuario ya está cogido.');
    if (req.body.age !== 'on') return fail('Debes confirmar que tienes 14 años o más.');
    if (req.body.terms !== 'on') return fail('Debes aceptar los Términos y la Política de privacidad.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(p.email)) return fail('Ya existe una cuenta con ese email.');

    const t = now();
    const role = config.adminEmail && p.email === config.adminEmail ? 'admin' : 'user';
    const og = db.prepare('SELECT COUNT(*) AS n FROM users').get().n < OG_LIMIT ? 1 : 0;
    const { lastInsertRowid } = db.prepare(`INSERT INTO users
      (username, email, password_hash, google_sub, email_verified, display_name, role, og, terms_version, terms_accepted_at, created_at)
      VALUES (?, ?, '', ?, 1, ?, ?, ?, ?, ?, ?)`)
      .run(username, p.email, p.sub, p.name || username, role, og, TERMS_VERSION, t, t);

    delete req.session.pendingGoogle;
    await loginSession(req, Number(lastInsertRowid));
    req.session.flash = { type: 'ok', msg: `Bienvenid@ a la pasarela, @${username}.` };
    res.redirect(p.next === '/' ? '/subir' : p.next);
  } catch (e) { next(e); }
});

/** Lee el id_token. Viene por HTTPS directo de Google, así que no hace falta validar la firma. */
function decodeIdToken(jwt) {
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
}

export default r;
