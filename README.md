# VIBRA — *La calle también tiene su pasarela*

Comunidad de outfits streetwear con estética de fashion week. La gente sube sus looks (título, descripción, fotos, ciudad, estilos y créditos de prendas), los descubre en un feed o en **modo pasarela** a pantalla completa, los **guarda** y los organiza en **colecciones** (privadas o públicas), como en los guardados de TikTok.

---

## 1. Qué incluye

**Producto**
- Feed con filtros por estilo, ciudad y búsqueda, orden *Nuevo / Tendencia / Top* y scroll infinito.
- **Modo pasarela**: scroll vertical a pantalla completa (teclado ↑↓, `S` para guardar, doble clic para guardar).
- Ficha de look estilo desfile: «Look Nº 014», galería con zoom, **créditos de prendas**, etiquetas, vistas y guardados.
- Guardar con animación + hoja «Guardar en colección» (como TikTok). Página de **Guardados** con colecciones en forma de entradas de desfile: crear, renombrar, borrar, hacer pública/privada, compartir y añadir en bloque desde guardados.
- Subida con arrastrar y soltar, reordenar fotos (la primera es la portada), barra de progreso, límite diario anti-spam.
- Perfiles públicos, ajustes, cambio de contraseña, recuperación por email.
- Moderación (`/admin`): denuncias, retirada con motivo visible para el autor, restaurar, suspender cuentas.
- Diseño propio: intro animada, cursor personalizado, grano de película, ticker, textos que se revelan, botones magnéticos, parallax, pase «backstage» en 3D en el registro, transiciones entre páginas, sello giratorio, 404 con glitch. Respeta «reducir movimiento».
- Responsive con barra inferior tipo app en móvil. PWA instalable.

**Legal (España / UE)**
- Aviso legal (LSSI-CE art. 10), Política de privacidad (RGPD + LOPDGDD), Política de cookies, Términos y condiciones, Normas de la comunidad, Accesibilidad y Contacto.
- Banner de cookies en el que **rechazar es tan fácil como aceptar**, con configuración por categorías y **Google Consent Mode v2**. AdSense no se carga hasta que el visitante decide.
- Edad mínima de 14 años (art. 7 LOPDGDD), aceptación registrada con versión y fecha.
- Derechos RGPD al instante: **descargar mis datos** (JSON) y **eliminar cuenta**.
- Reglamento de Servicios Digitales (DSA): botón de denuncia en cada look, punto de contacto, declaración de motivos y vía de reclamación.
- Fuentes alojadas en el propio servidor (no se envían IPs a Google Fonts).

**Seguridad**
- Contraseñas con **scrypt** y comparación en tiempo constante; política de contraseñas; sin enumeración de usuarios.
- Sesiones en SQLite, cookie `__Host-` HttpOnly + Secure + SameSite, regeneradas al iniciar sesión y cerradas en todos los dispositivos al cambiar la contraseña.
- **CSRF** en todos los formularios y llamadas a la API, además de comprobación de `Origin`.
- **CSP estricta con nonce**, HSTS con preload, X-Frame-Options DENY, nosniff, Referrer-Policy y Permissions-Policy (Helmet).
- Límite de intentos en login, registro, subidas, denuncias y API.
- Las imágenes se **decodifican y se vuelven a codificar** a WebP: se valida que sean imágenes de verdad, se eliminan EXIF/GPS y se neutralizan los archivos maliciosos. Nombres aleatorios y cabecera `sandbox`.
- Consultas SQL siempre parametrizadas, escapado de HTML en las plantillas, sin `innerHTML` con datos de usuario, protección contra redirecciones abiertas, honeypot contra bots y Cloudflare Turnstile opcional.
- Redirección HTTPS forzada, `security.txt` y `robots.txt`.

**SEO / AdSense**
- Metaetiquetas, Open Graph y Twitter Cards, datos estructurados JSON-LD, `sitemap.xml` con imágenes, `robots.txt` y **`ads.txt` generado automáticamente**.
- Huecos de anuncio en el feed (cada 12 looks) y en la ficha del look, siempre etiquetados como «Publicidad».

---

## 2. Probarlo en tu ordenador

Necesitas **Node.js 22.13 o superior** (tienes la 24).

```bash
npm install
```

```bash
npm run dev
```

Abre http://localhost:3000. La primera cuenta que registres con el email de `ADMIN_EMAIL` será la de administración (o usa `npm run make-admin -- tu_usuario`).

---

## 3. Configuración (`.env`)

Copia `.env.example` como `.env` y rellénalo. Lo imprescindible para publicar:

| Variable | Para qué |
|---|---|
| `SITE_URL` | Tu dominio con https, p. ej. `https://www.vibra.es` |
| `SESSION_SECRET` | Secreto aleatorio de 48+ bytes (el propio archivo explica cómo generarlo) |
| `LEGAL_OWNER_NAME`, `LEGAL_OWNER_ID`, `LEGAL_OWNER_ADDRESS`, `LEGAL_CONTACT_EMAIL` | **Obligatorios por ley.** Mientras falten, las páginas legales muestran un aviso rojo |
| `ADMIN_EMAIL` | Tu email, para tener acceso a `/admin` |
| `SMTP_*` | Para enviar los emails de recuperación de contraseña |
| `ADSENSE_CLIENT` | Tu `ca-pub-…` cuando AdSense te apruebe |

---

## 4. Publicar la web

La app guarda la base de datos y las fotos en disco (`DATA_DIR`), así que necesita un **servidor con disco persistente**. Vercel o Netlify **no** sirven.

### Opción A — Railway / Render / Fly.io (lo más fácil)
1. Sube el proyecto a un repositorio privado de GitHub.
2. Crea el servicio desde el repo (detectan el `Dockerfile`).
3. Añade un **volumen persistente** montado en `/data`.
4. Configura las variables del `.env` en el panel. `DATA_DIR=/data` ya viene en el Dockerfile.
5. Conecta tu dominio. El HTTPS lo pone la plataforma. Deja `TRUST_PROXY=1`.

### Opción B — VPS (Hetzner, OVH, DigitalOcean… desde ~5 €/mes)
```bash
docker build -t vibra .
```
```bash
docker run -d --name vibra --restart unless-stopped -p 127.0.0.1:3000:3000 -v vibra-data:/data --env-file .env vibra
```
Pon delante **Caddy** (HTTPS automático) con un `Caddyfile` de una línea: `tudominio.com { reverse_proxy 127.0.0.1:3000 }`.
Recomendado: **Cloudflare** delante (DNS con proxy) para protección DDoS gratuita.

### Opción C — Hosting gratuito (sin disco propio)

La app puede funcionar **sin disco persistente**: guarda las fotos en un bucket compatible con S3 y replica la base de datos en ese mismo bucket, restaurándola sola al arrancar. Así valen alojamientos gratuitos como Render, Northflank o Koyeb.

1. **Almacenamiento (gratis):** crea un bucket en [Backblaze B2](https://www.backblaze.com/sign-up/b2-cloud-storage-backup-archive) (10 GB gratis y **sin tarjeta**) o en [Cloudflare R2](https://dash.cloudflare.com) (10 GB gratis, pide tarjeta). Genera una clave de aplicación con permiso de lectura y escritura sobre ese bucket. En B2, activa además la regla de ciclo de vida **«Keep only the last version of the file»** para que las copias antiguas no ocupen espacio.
2. Rellena en el hosting: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y, si haces el bucket público, `S3_PUBLIC_BASE_URL`.
3. **Servidor:** en Render usa el archivo `render.yaml` incluido (Blueprint). Pon `DATA_DIR=/tmp/vibra`.
4. Comprueba en los registros del arranque que dice «Base de datos restaurada desde el bucket» (a partir del segundo despliegue) y «copia … subida».

Cómo funciona la protección de datos:
- Cada `DB_SYNC_MINUTES` (5 por defecto) y **al apagarse**, la app sube una copia coherente de la base de datos al bucket, más una copia diaria con 7 días de retención.
- Al arrancar, si el disco está vacío, la descarga del bucket. Si la copia existe pero la app arrancó vacía (bucket mal configurado), **se niega a subir nada y se detiene** para no destruir tus datos.
- Ventana de pérdida máxima ante un corte brusco: los minutos de `DB_SYNC_MINUTES`. Las fotos nunca se pierden: van directas al bucket.

> En el plan gratuito de Render la web **se duerme** tras 15 minutos sin visitas y tarda ~50 s en despertar. Para empezar vale; cuando tengas visitas reales, pasa al plan de pago (7 $/mes) o a Northflank, que no duerme. Mover la web de un sitio a otro ahora es trivial: los datos ya no viven en el servidor.

### Copias de seguridad
`npm run backup` hace una copia en caliente de la base de datos (guarda las 14 últimas). Prográmalo a diario y copia también `data/uploads`.

---

## 5. Monetizar con Google AdSense

1. Publica la web con tu dominio, los datos legales completos y **contenido real** (AdSense rechaza sitios vacíos: consigue primero looks y actividad).
2. Solicita AdSense y pon tu `ca-pub-…` en `ADSENSE_CLIENT`. `/ads.txt` se genera solo.
3. Crea bloques de anuncios y pon sus IDs en `ADSENSE_SLOT_FEED` y `ADSENSE_SLOT_LOOK` (o activa los Anuncios automáticos).
4. **Consentimiento en la UE:** Google exige un CMP certificado por el IAB (TCF v2.2) para servir **anuncios personalizados** en el EEE y Reino Unido. Lo más sencillo es activar el suyo (gratis) en *AdSense → Privacidad y mensajes → RGPD* y poner `CMP_MODE=google`; el banner propio se desactiva y «Configurar cookies» abre el de Google. Con `CMP_MODE=own` (por defecto) el banner propio cumple la normativa española de cookies, pero en el EEE Google sólo mostrará anuncios limitados o no personalizados, que generan menos ingresos.
5. Las Normas de la comunidad ya prohíben desnudez y contenido sexual (incompatibles con AdSense). **Modera las denuncias** desde `/admin`: el contenido de los usuarios es tu responsabilidad ante Google.

---

## 6. Antes de lanzar (checklist)

- [ ] Datos legales completos en `.env` y revisados por un profesional si tienes dudas (sobre todo si facturas: alta en Hacienda como autónomo o empresa).
- [ ] `SESSION_SECRET` largo y aleatorio. `NODE_ENV=production`.
- [ ] Dominio con HTTPS. Comprueba https://securityheaders.com (debería dar A+).
- [ ] SMTP configurado y recuperación de contraseña probada.
- [ ] Tu cuenta de administración creada.
- [ ] Copias de seguridad programadas.
- [ ] Sitemap enviado a Google Search Console.
- [ ] `npm audit` de vez en cuando y actualizaciones de dependencias.

> Ningún sistema es 100 % imposible de hackear. VIBRA aplica las protecciones estándar del sector (OWASP Top 10), pero la seguridad también depende de mantener el servidor y las dependencias actualizados, usar contraseñas fuertes y hacer copias de seguridad.

---

## 7. Estructura

```
src/            servidor (Express 5 + SQLite nativo de Node)
  routes/       auth, looks, guardados/colecciones, usuarios, legal, admin, SEO
  security.js   scrypt, CSRF, rate limiting, Turnstile
  images.js     validación y re-codificación de fotos (sharp)
views/          plantillas EJS (escapado automático)
public/         CSS, JS e imágenes
scripts/        make-admin, backup, build-assets
data/           base de datos y fotos (NO se sube al repositorio)
```
