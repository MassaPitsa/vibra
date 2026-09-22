import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import { config, ROOT, missingLegalFields } from './config.js';
import { db } from './db.js';
import { sessionStore } from './session-store.js';
import { nonce, csrf, limiters } from './security.js';
import { lookNumber, timeAgo, compact, formatDate, escapeHtml } from './util.js';
import { icon } from './icons.js';
import { isRemote, fetchObject, media, mediaAbsolute, checkStorage } from './storage.js';
import { startDbSync } from './db-sync.js';
import authRoutes from './routes/auth.js';
import googleRoutes from './routes/google.js';
import postRoutes from './routes/posts.js';
import saveRoutes from './routes/saves.js';
import userRoutes from './routes/users.js';
import legalRoutes from './routes/legal.js';
import adminRoutes from './routes/admin.js';
import metaRoutes from './routes/meta.js';

const app = express();


app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy === 'true');
app.disable('x-powered-by');
app.set('query parser', 'simple'); // sin objetos anidados en la query (evita contaminación de parámetros)

/* ───────────── HTTPS obligatorio en producción ───────────── */
if (config.isProd) {
  app.use((req, res, next) => {
    if (req.secure || req.path === '/healthz') return next();
    res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  });
}

/* ───────────── Cabeceras de seguridad (Helmet + CSP con nonce) ───────────── */
app.use(nonce);
const ads = Boolean(config.adsense.client);
const ts = Boolean(config.turnstile.siteKey);
app.use((req, res, next) => helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // 'strict-dynamic' permite que los scripts con nonce (AdSense) carguen sus dependencias.
      scriptSrc: [`'nonce-${res.locals.nonce}'`, "'strict-dynamic'", 'https:', "'unsafe-inline'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', ...(config.s3.publicBase ? [config.s3.publicBase] : []), ...(ads ? ['https:'] : [])],
      fontSrc: ["'self'", ...(ads ? ['https://fonts.gstatic.com'] : [])],
      connectSrc: ["'self'", ...(ads ? ['https:'] : [])],
      frameSrc: [...(ads ? ['https:'] : []), ...(ts ? ['https://challenges.cloudflare.com'] : []), ...(!ads && !ts ? ["'none'"] : [])],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  xFrameOptions: { action: 'deny' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginOpenerPolicy: { policy: ads ? 'same-origin-allow-popups' : 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
})(req, res, next));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  next();
});

app.use(compression());

/* ───────────── Estáticos ───────────── */
const staticOpts = { maxAge: config.isProd ? '7d' : 0, index: false, dotfiles: 'ignore' };
app.use('/static', express.static(path.join(ROOT, 'public'), staticOpts));
const font = (pkg) => express.static(path.join(ROOT, 'node_modules/@fontsource', pkg, 'files'), { maxAge: '365d', immutable: true, index: false });
app.use('/fonts/anton', font('anton'));
app.use('/fonts/instrument-serif', font('instrument-serif'));
app.use('/fonts/space-mono', font('space-mono'));
app.use('/fonts/inter-tight', font('inter-tight'));
// Las subidas tienen nombres aleatorios e inmutables: caché agresiva y nunca se ejecutan.
const mediaHeaders = (res) => {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
};
if (isRemote()) {
  // Las fotos viven en el bucket S3: se sirven a través de este proxy (mismo origen)
  // salvo que se configure S3_PUBLIC_BASE_URL, en cuyo caso se enlazan directamente.
  app.get('/media/:file', async (req, res, next) => {
    if (!/^[a-f0-9]{32}(-t|-a)?\.webp$/.test(req.params.file)) return next();
    try {
      const upstream = await fetchObject(req.params.file);
      if (!upstream.ok || !upstream.body) return next();
      mediaHeaders(res);
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (e) {
      if (!res.headersSent) next(e);
    }
  });
} else {
  app.use('/media', express.static(config.uploadsDir, {
    maxAge: '365d', immutable: true, index: false, dotfiles: 'deny', fallthrough: false,
    setHeaders: mediaHeaders,
  }));
}

app.use(metaRoutes); // robots.txt, sitemap, ads.txt… (sin sesión)

app.use(limiters.global);
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }));
app.use(express.json({ limit: '32kb' }));

/* ───────────── Sesión ───────────── */
app.use(session({
  name: config.isProd ? '__Host-vibra.sid' : 'vibra.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: config.isProd,
  cookie: {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

/* ───────────── Usuario actual + variables de plantilla ───────────── */
const getUser = db.prepare("SELECT id, username, email, display_name, avatar, role, status, email_verified FROM users WHERE id = ?");
app.use((req, res, next) => {
  if (req.session.userId) {
    const u = getUser.get(req.session.userId);
    if (u && u.status === 'active') {
      if (config.adminEmail && u.email_verified && u.email.toLowerCase() === config.adminEmail && u.role !== 'admin') {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
        u.role = 'admin';
      }
      req.user = u;
    } else {
      delete req.session.userId;
    }
  }
  const consent = parseConsent(req.headers.cookie);
  Object.assign(res.locals, {
    user: req.user || null,
    config,
    consent,
    path: req.path,
    url: config.siteUrl + req.originalUrl.split('?')[0],
    flash: req.session.flash || null,
    lookNumber, timeAgo, compact, formatDate, icon, legalVal, media, mediaAbsolute,
    meta: {},
  });
  if (req.session.flash) delete req.session.flash;
  next();
});

// El token CSRF sólo se crea si ya hay sesión o la ruta lo necesita (evita cookies innecesarias).
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.session.userId && !needsCsrfOnGet(req.path)) {
    res.locals.csrf = req.session.csrf || '';
    return next();
  }
  csrf(req, res, next);
});
function needsCsrfOnGet(p) {
  return ['/entrar', '/registro', '/olvide', '/registro/google'].includes(p) ||
    p.startsWith('/restablecer/') || p.startsWith('/denunciar/') || p.startsWith('/auth/google');
}

const LEGAL_ENV = { ownerName: 'LEGAL_OWNER_NAME', ownerId: 'LEGAL_OWNER_ID', ownerAddress: 'LEGAL_OWNER_ADDRESS', contactEmail: 'LEGAL_CONTACT_EMAIL', registry: 'LEGAL_REGISTRY' };
/** Dato legal del titular escapado, o un aviso visible si falta en .env. */
function legalVal(key) {
  const v = config.legal[key];
  return v ? escapeHtml(v) : '<span class="todo">[Completa ' + LEGAL_ENV[key] + ' en .env]</span>';
}

function parseConsent(cookieHeader = '') {
  const m = /(?:^|;\s*)vibra_consent=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  try {
    const v = JSON.parse(decodeURIComponent(m[1]));
    return { ads: v.ads === true, personalized: v.personalized === true, v: v.v };
  } catch { return null; }
}

/* ───────────── Rutas ───────────── */
app.use(legalRoutes);
app.use(authRoutes);
app.use(googleRoutes);
app.use(saveRoutes);
app.use(userRoutes);
app.use(adminRoutes);
app.use(postRoutes);

/* ───────────── 404 + errores ───────────── */
app.use((req, res, next) => next(Object.assign(new Error('No encontrado'), { status: 404 })));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; err.message = `Cada imagen puede pesar como máximo ${config.limits.maxImageBytes / 1024 / 1024} MB.`; err.expose = true; }
  else if (err.code?.startsWith?.('LIMIT_')) { status = 400; err.message = `Máximo ${config.limits.maxImages} fotos por look.`; err.expose = true; }
  else if (err.type === 'entity.too.large') status = 413;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  const message = status === 404 ? 'Esta página se ha perdido entre bastidores.'
    : status < 500 ? err.message : 'Algo ha fallado en el backstage. Ya estamos en ello.';
  if (res.headersSent) return;
  if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({ error: true, message });
  }
  Object.assign(res.locals, { lookNumber, timeAgo, compact, formatDate, icon, legalVal, media, mediaAbsolute });
  res.locals.nonce ??= '';
  res.locals.user ??= null;
  res.locals.config ??= config;
  res.locals.meta ??= {};
  res.locals.csrf ??= '';
  res.locals.consent ??= null;
  res.locals.flash ??= null;
  res.locals.path ??= req.path;
  res.locals.url ??= config.siteUrl + req.path;
  res.status(status).render('error', { status, message, meta: { title: status === 404 ? 'No encontrado' : 'Error', noindex: true } });
});

const server = app.listen(config.port, () => {
  console.log(`\n  VIBRA · La calle también tiene su pasarela\n  → ${config.siteUrl} (puerto ${config.port}, ${config.isProd ? 'producción' : 'desarrollo'})\n`);
  const missing = missingLegalFields();
  if (missing.length) console.warn(`  ⚠  Faltan datos legales en .env: ${missing.join(', ')}\n`);
  console.log(`  Fotos: ${isRemote() ? `bucket S3 «${config.s3.bucket}»${config.s3.publicBase ? ' (URL pública)' : ' (servidas por la app)'}` : `disco local (${config.uploadsDir})`}`);
  checkStorage().then((ok) => { if (ok) dbSync = startDbSync(db); });
});
let dbSync = null;

// Cierre ordenado (Docker/PM2/Render envían SIGTERM).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    setTimeout(() => process.exit(1), 25_000).unref(); // red de seguridad
    server.close(async () => {
      // Última copia de la base de datos antes de apagarse (hosting sin disco persistente).
      await dbSync?.snapshot('de apagado').catch(() => {});
      db.close();
      process.exit(0);
    });
  });
}

export default app;
