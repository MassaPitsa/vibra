/* ═══════════════════════════════════════════════════════════════
   VIBRA — cliente. Vanilla JS, sin dependencias.
   Regla de seguridad: nunca se inserta texto de usuario con innerHTML;
   sólo HTML ya escapado por el servidor (fragmentos del feed).
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const V = window.VIBRA || {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && el.append(c));
    return el;
  };
  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  /* ───────────── API ───────────── */
  async function api(url, body, method = 'POST') {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-CSRF-Token': V.csrf || '' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    if (res.status === 401) {
      toast('Inicia sesión para guardar looks y crear colecciones.', { action: 'Entrar', onAction: () => { location.href = '/entrar?next=' + encodeURIComponent(location.pathname + location.search); } });
      throw new Error('auth');
    }
    if (!res.ok) {
      toast(data.message || 'Algo ha fallado. Inténtalo de nuevo.', { error: true });
      throw new Error(data.message || 'error');
    }
    return data;
  }

  /* ───────────── Toasts ───────────── */
  function toast(msg, { action, onAction, error = false, ms = 4200 } = {}) {
    const box = $('[data-toasts]');
    if (!box) return;
    const t = h('div', { class: 'toast' + (error ? ' toast--err' : ''), role: 'status' }, h('span', { text: msg }));
    if (action) t.append(h('button', { type: 'button', text: action, onclick: () => { onAction?.(); close(); } }));
    box.append(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    const close = () => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); };
    setTimeout(close, ms);
  }

  /* ───────────── Diálogo genérico (confirmar / pedir texto) ───────────── */
  function dialog({ title, text, input, value = '', confirm = 'Aceptar', danger = false }) {
    return new Promise((resolve) => {
      const field = input ? h('input', { class: 'input input--box', maxlength: 40, value, 'aria-label': input, placeholder: input }) : null;
      const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      const form = h('form', { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
        onsubmit: (e) => { e.preventDefault(); done(field ? field.value.trim() || null : true); } },
        h('div', { class: 'modal__head' }, h('h2', { text: title })),
        text ? h('p', { class: 'muted', text, style: 'margin:0 0 18px' }) : null,
        field ? h('div', { style: 'margin-bottom:18px' }, field) : null,
        h('div', { style: 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap' },
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'Cancelar', onclick: () => done(null) }),
          h('button', { type: 'submit', class: 'btn btn--sm ' + (danger ? 'btn--danger' : 'btn--accent'), text: confirm })));
      const wrap = h('div', { class: 'modal is-open' }, h('div', { class: 'modal__backdrop', onclick: () => done(null) }), form);
      document.body.append(wrap);
      document.addEventListener('keydown', onKey);
      (field || form.querySelector('[type=submit]')).focus();
    });
  }

  // Formularios con confirmación (eliminar look, cuenta, etc.)
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-confirm]');
    if (!f || f.dataset.confirmed) return;
    e.preventDefault();
    const ok = await dialog({ title: '¿Seguro?', text: f.dataset.confirm, confirm: 'Sí, continuar', danger: true });
    if (ok) { f.dataset.confirmed = '1'; f.requestSubmit ? f.requestSubmit() : f.submit(); }
  });

  /* ───────────── Intro ───────────── */
  const intro = $('.intro');
  if (intro && !document.documentElement.classList.contains('no-intro')) {
    const count = $('.intro__count', intro);
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 1100);
      count.textContent = String(Math.round(p * 100)).padStart(3, '0');
      if (p < 1) requestAnimationFrame(tick);
      else {
        intro.classList.add('is-done');
        try { sessionStorage.setItem('vibra:intro', '1'); } catch { /* privado */ }
        setTimeout(() => intro.remove(), 1000);
      }
    };
    requestAnimationFrame(tick);
  } else intro?.remove();

  /* ───────────── Cursor personalizado ───────────── */
  const cursor = $('.cursor');
  if (cursor && finePointer && !reduced) {
    document.documentElement.classList.add('has-cursor');
    // El puntero va pegado al ratón (sin suavizado ni retardo): se pinta en el
    // siguiente fotograma con la posición exacta del evento.
    let x = innerWidth / 2, y = innerHeight / 2, queued = false;
    const paint = () => {
      queued = false;
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    };
    addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    }, { passive: true });
    document.addEventListener('mouseleave', () => cursor.classList.add('is-hidden'));
    document.addEventListener('mouseenter', () => cursor.classList.remove('is-hidden'));
    paint();
    document.addEventListener('mouseover', (e) => {
      const view = e.target.closest('[data-cursor="view"]');
      const link = e.target.closest('a, button, label, input, textarea, select, [role="button"]');
      cursor.classList.toggle('is-view', Boolean(view) && !e.target.closest('.save-btn, button:not(.card__link)'));
      cursor.classList.toggle('is-link', Boolean(link) && !view);
    });
  }

  /* ───────────── Cabecera que se esconde al bajar ───────────── */
  const header = $('[data-header]');
  if (header) {
    let last = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY;
      header.classList.toggle('is-hidden', y > last && y > 300);
      last = y;
    }, { passive: true });
  }

  /* ───────────── Menú de cuenta ───────────── */
  $$('[data-menu]').forEach((m) => {
    const btn = $('[data-menu-btn]', m);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = m.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', (e) => { if (!m.contains(e.target)) { m.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { m.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); } });
  });

  /* ───────────── Reloj en directo ───────────── */
  const clock = $('[data-clock]');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Madrid' });
    const upd = () => { clock.textContent = `Madrid · ${fmt.format(new Date())} · en directo`; };
    upd(); setInterval(upd, 1000);
  }
  const short = $('[data-clock-short]');
  if (short) short.textContent = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date());

  /* ───────────── Revelado al hacer scroll ───────────── */
  const io = 'IntersectionObserver' in window && !reduced
    ? new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 })
    : null;
  const observeReveals = (root = document) => $$('.reveal:not(.is-in), .rv:not(.is-in)', root).forEach((el) => (io ? io.observe(el) : el.classList.add('is-in')));
  observeReveals();

  /* ───────────── Contadores ───────────── */
  $$('[data-count-up]').forEach((el) => {
    const target = Number(el.dataset.countUp) || 0;
    const fmt = new Intl.NumberFormat('es-ES', { notation: target > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 });
    if (reduced || !target) { el.textContent = fmt.format(target); return; }
    const run = () => {
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 1600);
        el.textContent = fmt.format(Math.round(target * (1 - Math.pow(1 - p, 4))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const o = new IntersectionObserver(([en]) => { if (en.isIntersecting) { run(); o.disconnect(); } });
    o.observe(el);
  });

  /* ───────────── Hero: foco de luz + parallax ───────────── */
  const hero = $('[data-hero]');
  if (hero && finePointer && !reduced) {
    const stack = $('[data-parallax]', hero);
    hero.addEventListener('mousemove', (e) => {
      const r = hero.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      hero.style.setProperty('--mx', `${px * 100}%`);
      hero.style.setProperty('--my', `${py * 100}%`);
      if (stack) $$('.hero__card', stack).forEach((c, i) => {
        const d = (i + 1) * 5;
        c.style.transform = `translate3d(${(px - 0.5) * d}px, ${(py - 0.5) * d}px, 0) rotate(var(--r))`;
      });
    });
  }

  /* ───────────── Botones magnéticos ───────────── */
  if (finePointer && !reduced) {
    $$('.magnetic').forEach((b) => {
      b.addEventListener('mousemove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.12}px, ${(e.clientY - r.top - r.height / 2) * 0.16}px)`;
      });
      b.addEventListener('mouseleave', () => { b.style.transform = ''; });
    });
  }

  /* ───────────── Manifiesto: palabras que se encienden ───────────── */
  $$('[data-words] p').forEach((p) => {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((w) => frag.append(/\s+/.test(w) || !w ? w : h('span', { class: 'word', text: w })));
          n.replaceWith(frag);
        } else walk(n);
      });
    };
    walk(p);
    const words = $$('.word', p);
    if (reduced) { words.forEach((w) => w.classList.add('is-lit')); return; }
    const onScroll = () => {
      const r = p.getBoundingClientRect();
      const prog = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
      const n = Math.round(prog * words.length);
      words.forEach((w, i) => w.classList.toggle('is-lit', i < n));
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });

  /* ═══════════════ Guardar looks ═══════════════ */
  function setSaved(id, saved, count) {
    $$(`[data-save="${id}"]`).forEach((b) => {
      b.setAttribute('aria-pressed', saved);
      b.setAttribute('aria-label', saved ? 'Quitar de guardados' : 'Guardar look');
      const lbl = $('[data-save-label]', b);
      if (lbl) lbl.textContent = saved ? 'Guardado' : 'Guardar';
    });
    if (count != null) $$(`[data-count="${id}"]`).forEach((c) => { c.textContent = new Intl.NumberFormat('es-ES', { notation: 'compact' }).format(count); });
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-save]');
    if (!b) return;
    e.preventDefault();
    if (!V.user) { location.href = '/entrar?next=' + encodeURIComponent(location.pathname); return; }
    const id = b.dataset.save;
    const want = b.getAttribute('aria-pressed') !== 'true';
    setSaved(id, want);
    if (want && !reduced) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    try {
      const r = await api(`/api/looks/${id}/save`, { saved: want });
      setSaved(id, r.saved, r.count);
      if (r.saved) toast('Guardado en tus looks.', { action: 'Añadir a colección', onAction: () => openCollections(id) });
      else toast('Quitado de guardados.');
    } catch { setSaved(id, !want); }
  });

  /* ═══════════════ Hoja de colecciones (tipo TikTok) ═══════════════ */
  const cm = $('[data-coll-modal]');
  let cmPost = null, lastFocus = null;
  function closeModal(m) {
    m.classList.remove('is-open');
    m.setAttribute('aria-hidden', 'true');
    lastFocus?.focus?.();
  }
  function openModal(m) {
    lastFocus = document.activeElement;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('input, button:not([data-close]), [data-close]', m)?.focus(), 50);
  }
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(m); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(m); });
  });

  async function openCollections(postId) {
    if (!V.user) { location.href = '/entrar?next=' + encodeURIComponent(location.pathname); return; }
    if (!cm) return;
    cmPost = postId;
    const list = $('[data-coll-list]', cm);
    list.replaceChildren(h('li', {}, h('div', { class: 'loader' }, h('i'), h('i'), h('i'))));
    openModal(cm);
    try {
      const { collections } = await api(`/api/collections?post=${encodeURIComponent(postId)}`, undefined, 'GET');
      renderCollections(collections);
    } catch { closeModal(cm); }
  }

  function renderCollections(cols) {
    const list = $('[data-coll-list]', cm);
    if (!cols.length) {
      list.replaceChildren(h('li', { class: 'muted', style: 'padding:10px;font-size:14px', text: 'Aún no tienes colecciones. Crea la primera aquí abajo: «Invierno», «Para copiar», «Grails»…' }));
      return;
    }
    list.replaceChildren(...cols.map((c) => {
      const cover = h('span', { class: 'cv' });
      if (c.cover) cover.append(h('img', { src: (V.mediaBase || '/media') + '/' + encodeURIComponent(c.cover), alt: '' })); else cover.textContent = c.name.charAt(0).toUpperCase();
      const ck = h('span', { class: 'ck' }); ck.innerHTML = ICON.check; // SVG estático
      const count = h('span', { text: `${c.count} looks${c.is_public ? ' · pública' : ''}` });
      const btn = h('button', { type: 'button', 'aria-pressed': c.has ? 'true' : 'false' }, cover, h('span', { class: 'nm' }, h('b', { text: c.name }), count), ck);
      btn.addEventListener('click', async () => {
        const add = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', add);
        try {
          const r = await api(`/api/collections/${c.id}/items`, add ? { add: [cmPost] } : { remove: [cmPost] });
          count.textContent = `${r.count} looks${c.is_public ? ' · pública' : ''}`;
          if (add) setSaved(cmPost, true);
          toast(add ? `Añadido a «${c.name}».` : `Quitado de «${c.name}».`);
        } catch { btn.setAttribute('aria-pressed', !add); }
      });
      return h('li', {}, btn);
    }));
  }

  if (cm) {
    $('[data-coll-new]', cm).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.elements.name;
      const name = input.value.trim();
      if (!name) return;
      try {
        await api('/api/collections', { name, postId: cmPost });
        input.value = '';
        setSaved(cmPost, true);
        toast(`Colección «${name}» creada.`);
        const { collections } = await api(`/api/collections?post=${encodeURIComponent(cmPost)}`, undefined, 'GET');
        renderCollections(collections);
      } catch { /* toast ya mostrado */ }
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-collect]');
    if (b) { e.preventDefault(); openCollections(b.dataset.collect); }
  });

  /* ───────────── Compartir ───────────── */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    e.preventDefault();
    const url = new URL(b.dataset.share, location.origin).href;
    const title = b.dataset.shareTitle || document.title;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, text: `${title} — VIBRA · La calle también tiene su pasarela`, url }); return; } catch { /* cancelado */ }
    }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Pásalo por el grupo.'); }
    catch { await dialog({ title: 'Copia el enlace', input: 'Enlace', value: url, confirm: 'Listo' }); }
  });

  /* ═══════════════ Anuncios + consentimiento ═══════════════ */
  const CONSENT_KEY = 'vibra_consent';
  const readConsent = () => {
    const m = document.cookie.match(/(?:^|;\s*)vibra_consent=([^;]+)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  };
  function loadAds() {
    if (!V.ads) return;
    if (!document.querySelector('script[src*="adsbygoogle.js"]')) {
      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(V.ads.client)}`;
      document.head.append(s);
    }
    fillAds();
  }
  function fillAds(root = document) {
    if (!V.ads || (V.ads.cmp !== 'google' && !readConsent())) return;
    $$('ins.adsbygoogle:not([data-adsbygoogle-status]):not([data-queued])', root).forEach((ins) => {
      ins.dataset.queued = '1';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* bloqueador */ }
    });
  }
  fillAds();

  const cookie = $('[data-cookie]');
  if (cookie) {
    const prefs = { ads: $('[data-pref="ads"]', cookie), personalized: $('[data-pref="personalized"]', cookie) };
    const current = readConsent();
    if (current && prefs.ads) { prefs.ads.checked = current.ads; prefs.personalized.checked = current.personalized; }
    prefs.personalized?.addEventListener('change', () => { if (prefs.personalized.checked) prefs.ads.checked = true; });
    prefs.ads?.addEventListener('change', () => { if (!prefs.ads.checked) prefs.personalized.checked = false; });

    const save = (ads, personalized) => {
      const before = readConsent();
      const val = encodeURIComponent(JSON.stringify({ v: 1, ads, personalized, ts: Date.now() }));
      document.cookie = `${CONSENT_KEY}=${val}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      if (typeof window.gtag === 'function') {
        window.gtag('consent', 'update', { ad_storage: ads ? 'granted' : 'denied', ad_user_data: ads ? 'granted' : 'denied', ad_personalization: personalized ? 'granted' : 'denied' });
      }
      cookie.classList.remove('is-open', 'show-prefs');
      // Retirar un consentimiento ya dado exige recargar para detener los scripts de terceros.
      if (before && ((before.ads && !ads) || (before.personalized && !personalized))) { location.reload(); return; }
      loadAds();
      toast('Preferencias de cookies guardadas.');
    };
    $('[data-cookie-accept]', cookie)?.addEventListener('click', () => {
      if (cookie.classList.contains('show-prefs')) save(prefs.ads.checked, prefs.personalized.checked);
      else save(true, true);
    });
    $('[data-cookie-reject]', cookie)?.addEventListener('click', () => save(false, false));
    $('[data-cookie-config]', cookie)?.addEventListener('click', () => {
      const showing = cookie.classList.toggle('show-prefs');
      $('[data-cookie-accept]', cookie).textContent = showing ? 'Guardar selección' : 'Aceptar';
    });
    $('[data-cookie-close]', cookie)?.addEventListener('click', () => cookie.classList.remove('is-open'));
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-cookie-open]')) return;
    if (V.ads?.cmp === 'google' && window.googlefc?.showRevocationMessage) { window.googlefc.showRevocationMessage(); return; }
    if (!cookie) return;
    cookie.classList.add('is-open');
    if (!cookie.hasAttribute('data-no-ads')) {
      cookie.classList.add('show-prefs');
      const acc = $('[data-cookie-accept]', cookie);
      if (acc) acc.textContent = 'Guardar selección';
    }
  });

  /* ═══════════════ Scroll infinito del feed ═══════════════ */
  const grid = $('[data-grid]');
  if (grid && grid.dataset.next) {
    const loader = $('[data-loader]');
    let busy = false;
    const sentinel = h('div', { 'aria-hidden': 'true', style: 'height:1px' });
    grid.after(sentinel);
    const more = async () => {
      if (busy || !grid.dataset.next) return;
      busy = true; if (loader) loader.hidden = false;
      try {
        const q = new URLSearchParams(grid.dataset.query); q.set('page', grid.dataset.next);
        const r = await fetch(`/api/feed?${q}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then((x) => x.json());
        const tmp = document.createElement('div');
        tmp.innerHTML = r.html; // HTML generado y escapado por el servidor
        const nodes = [...tmp.children];
        grid.append(...nodes);
        nodes.forEach((n) => observeReveals(n.parentNode === grid ? n : grid));
        observeReveals(grid);
        fillAds(grid);
        grid.dataset.next = r.hasMore ? r.nextPage : '';
        if (!r.hasMore) { obs.disconnect(); sentinel.remove(); }
      } catch { toast('No se pudieron cargar más looks.', { error: true }); }
      finally { busy = false; if (loader) loader.hidden = true; }
    };
    const obs = new IntersectionObserver(([en]) => { if (en.isIntersecting) more(); }, { rootMargin: '900px 0px' });
    obs.observe(sentinel);
  }

  /* ═══════════════ Modo pasarela ═══════════════ */
  const runway = $('[data-runway]');
  if (runway) {
    const counter = $('[data-runway-counter]');
    const bar = $('[data-runway-progress]');
    let busy = false;
    const slides = () => $$('[data-slide]', runway);
    const so = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      slides().forEach((s) => s.classList.remove('is-active'));
      en.target.classList.add('is-active');
      const all = slides(); const i = all.indexOf(en.target);
      if (counter) counter.textContent = `Look ${String(i + 1).padStart(2, '0')} / ${String(all.length).padStart(2, '0')}${runway.dataset.next ? '+' : ''}`;
      if (bar) bar.style.width = `${((i + 1) / all.length) * 100}%`;
      if (i >= all.length - 3) loadMore();
    }), { root: runway, threshold: 0.6 });
    slides().forEach((s) => so.observe(s));
    async function loadMore() {
      if (busy || !runway.dataset.next) return;
      busy = true;
      try {
        const q = new URLSearchParams(runway.dataset.query); q.set('page', runway.dataset.next); q.set('view', 'runway');
        const r = await fetch(`/api/feed?${q}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then((x) => x.json());
        const tmp = document.createElement('div'); tmp.innerHTML = r.html; // HTML escapado por el servidor
        [...tmp.children].forEach((n) => { runway.append(n); so.observe(n); });
        runway.dataset.next = r.hasMore ? r.nextPage : '';
      } finally { busy = false; }
    }
    document.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'j', 'PageDown'].includes(e.key)) { e.preventDefault(); runway.scrollBy({ top: innerHeight, behavior: reduced ? 'auto' : 'smooth' }); }
      if (['ArrowUp', 'k', 'PageUp'].includes(e.key)) { e.preventDefault(); runway.scrollBy({ top: -innerHeight, behavior: reduced ? 'auto' : 'smooth' }); }
      if (e.key === 's') $('.slide.is-active [data-save]', runway)?.click();
      if (e.key === 'Escape') location.href = '/';
    });
    // Doble toque para guardar, como en las apps de vídeo
    runway.addEventListener('dblclick', (e) => {
      const s = e.target.closest('[data-slide]');
      const b = s && $('[data-save]', s);
      if (b && b.getAttribute('aria-pressed') !== 'true' && !e.target.closest('button, a')) b.click();
    });
  }

  /* ═══════════════ Galería del look ═══════════════ */
  const gal = $('[data-gallery]');
  if (gal) {
    const track = $('[data-slides]', gal);
    const figs = $$('figure', track);
    const thumbs = $$('[data-go]', gal);
    const dots = $$('.gallery__dots i', gal);
    const cur = $('[data-cur]', gal);
    let idx = 0;
    const go = (i) => { idx = Math.max(0, Math.min(figs.length - 1, i)); track.scrollTo({ left: track.clientWidth * idx, behavior: reduced ? 'auto' : 'smooth' }); };
    const sync = () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      idx = i;
      thumbs.forEach((t, k) => t.setAttribute('aria-current', k === i));
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      if (cur) cur.textContent = i + 1;
    };
    track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    thumbs.forEach((t) => t.addEventListener('click', () => go(Number(t.dataset.go))));
    $('[data-prev]', gal)?.addEventListener('click', () => go(idx - 1));
    $('[data-next]', gal)?.addEventListener('click', () => go(idx + 1));
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea') || $('.modal.is-open')) return;
      if (e.key === 'ArrowRight') go(idx + 1);
      if (e.key === 'ArrowLeft') go(idx - 1);
    });
    // Lightbox
    const lb = $('[data-lightbox]');
    const lbImg = lb && $('img', lb);
    const closeLb = () => { lb.classList.remove('is-open'); document.body.style.overflow = ''; };
    track.addEventListener('click', (e) => {
      const img = e.target.closest('[data-zoom]');
      if (!img || !lb) return;
      lbImg.src = img.currentSrc || img.src; lbImg.alt = img.alt;
      lb.classList.add('is-open'); document.body.style.overflow = 'hidden';
      $('[data-lightbox-close]', lb).focus();
    });
    lb?.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('[data-lightbox-close]')) closeLb(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb?.classList.contains('is-open')) closeLb(); });
  }

  // Transición de vista compartida: la foto de la tarjeta "vuela" al detalle.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.card__link');
    if (!link || !('startViewTransition' in document)) return;
    $$('[style*="view-transition-name"]').forEach((el) => { el.style.viewTransitionName = ''; });
    const img = link.closest('.card')?.querySelector('.card__media img');
    if (img) img.style.viewTransitionName = 'look-hero';
  });
  addEventListener('pageshow', () => $$('.card__media img').forEach((i) => { i.style.viewTransitionName = ''; }));

  /* ═══════════════ Subir look ═══════════════ */
  const upForm = $('form[data-upload]');
  if (upForm) {
    const drop = $('[data-drop]', upForm);
    const input = $('[data-file]', upForm);
    const previews = $('[data-previews]', upForm);
    const MAX = V.maxImages || 4, MAX_BYTES = V.maxBytes || 10 * 1024 * 1024;
    const OK = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    let files = [];
    let dragIdx = null;

    const syncInput = () => {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f.file));
      input.files = dt.files;
    };
    const render = () => {
      previews.replaceChildren(...files.map((f, i) => {
        const x = h('button', { type: 'button', class: 'x', 'aria-label': 'Quitar foto', text: '×', onclick: () => { URL.revokeObjectURL(f.url); files.splice(i, 1); syncInput(); render(); } });
        const el = h('div', { class: 'preview', draggable: 'true' }, h('img', { src: f.url, alt: `Foto ${i + 1}` }), x, i === 0 ? h('span', { class: 'tag', text: 'Portada' }) : null);
        el.addEventListener('dragstart', (e) => { dragIdx = i; el.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; });
        el.addEventListener('dragend', () => el.classList.remove('is-drag'));
        el.addEventListener('dragover', (e) => { if (dragIdx !== null) e.preventDefault(); });
        el.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (dragIdx === null || dragIdx === i) return;
          const [m] = files.splice(dragIdx, 1); files.splice(i, 0, m); dragIdx = null; syncInput(); render();
        });
        return el;
      }), ...(files.length && files.length < MAX ? [h('label', { class: 'preview preview--add', title: 'Añadir más fotos', text: '+' }, h('input', { type: 'file', accept: OK.join(','), multiple: true, class: 'sr-only', onchange: (e) => add(e.target.files) }))] : []));
      drop.classList.toggle('has-files', files.length > 0);
    };
    const add = (list) => {
      for (const file of list) {
        if (files.length >= MAX) { toast(`Máximo ${MAX} fotos por look.`, { error: true }); break; }
        if (!OK.includes(file.type)) { toast(`«${file.name}» no es un formato válido.`, { error: true }); continue; }
        if (file.size > MAX_BYTES) { toast(`«${file.name}» pesa más de ${Math.round(MAX_BYTES / 1048576)} MB.`, { error: true }); continue; }
        files.push({ file, url: URL.createObjectURL(file) });
      }
      syncInput(); render();
    };
    input.addEventListener('change', () => { const l = [...input.files]; files = []; add(l); });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { if (dragIdx === null) { e.preventDefault(); drop.classList.add('is-over'); } }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', (e) => { if (dragIdx === null && e.dataTransfer.files.length) { e.preventDefault(); add(e.dataTransfer.files); } });

    // Envío con barra de progreso sin perder las fotos si hay error.
    upForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!files.length) { toast('Añade al menos una foto de tu outfit.', { error: true }); return; }
      if (upForm.elements.title.value.trim().length < 3) { toast('El título necesita al menos 3 caracteres.', { error: true }); upForm.elements.title.focus(); return; }
      if (!upForm.elements.rights.checked) { toast('Confirma que tienes los derechos de las fotos.', { error: true }); return; }
      const btn = $('[data-submit]', upForm);
      const bar = $('[data-progress]', upForm);
      btn.disabled = true; upForm.classList.add('is-uploading');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', upForm.action);
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total) * 100}%`; };
      xhr.onload = () => {
        if (xhr.status < 400 && xhr.responseURL && !xhr.responseURL.endsWith('/subir')) { location.href = xhr.responseURL; return; }
        const doc = new DOMParser().parseFromString(xhr.responseText, 'text/html');
        toast(doc.querySelector('.form-error, .error-page .muted')?.textContent.trim() || 'No se pudo publicar. Inténtalo de nuevo.', { error: true, ms: 6000 });
        btn.disabled = false; upForm.classList.remove('is-uploading'); bar.style.width = '0';
      };
      xhr.onerror = () => { toast('Error de conexión. Revisa tu red.', { error: true }); btn.disabled = false; upForm.classList.remove('is-uploading'); };
      xhr.send(new FormData(upForm));
    });
  }

  // Contadores de caracteres, tags y piezas (subir y editar)
  $$('[data-counter-for]').forEach((c) => {
    const f = document.getElementById(c.dataset.counterFor);
    const upd = () => { c.textContent = `${f.value.length}/${f.maxLength}`; };
    f.addEventListener('input', upd); upd();
  });
  const tagInput = $('[data-tags]');
  if (tagInput) {
    const out = $('[data-tag-preview]');
    const upd = () => {
      const tags = [...new Set(tagInput.value.toLowerCase().split(/[,#\s]+/).map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24)).filter(Boolean))].slice(0, 8);
      out.replaceChildren(...tags.map((t) => h('span', { text: `#${t}` })));
    };
    tagInput.addEventListener('input', upd); upd();
  }
  const pieces = $('[data-pieces]');
  if (pieces) {
    $('[data-piece-add]').addEventListener('click', () => {
      if (pieces.children.length >= 12) { toast('Máximo 12 piezas.'); return; }
      const row = pieces.firstElementChild.cloneNode(true);
      $$('input', row).forEach((i) => { i.value = ''; });
      pieces.append(row); $('input', row).focus();
    });
    pieces.addEventListener('click', (e) => {
      const b = e.target.closest('[data-piece-remove]');
      if (!b) return;
      const row = b.closest('.pieces-row');
      if (pieces.children.length > 1) row.remove(); else $$('input', row).forEach((i) => { i.value = ''; });
    });
  }

  /* ═══════════════ Guardados: gestionar colecciones ═══════════════ */
  $('[data-new-collection]')?.addEventListener('click', async () => {
    const name = await dialog({ title: 'Nueva colección', input: 'Nombre (p. ej. «Invierno 26»)', confirm: 'Crear' });
    if (!name) return;
    try { const r = await api('/api/collections', { name }); location.href = `/guardados?c=${r.id}`; } catch { /* toast */ }
  });

  const bar = $('[data-coll-bar]');
  if (bar) {
    const id = bar.dataset.id;
    $('[data-coll-rename]', bar).addEventListener('click', async () => {
      const cur = $('[data-coll-name]', bar).textContent;
      const name = await dialog({ title: 'Renombrar colección', input: 'Nombre', value: cur, confirm: 'Guardar' });
      if (!name || name === cur) return;
      try { const r = await api(`/api/collections/${id}`, { name }); $('[data-coll-name]', bar).textContent = r.name; toast('Colección renombrada.'); setTimeout(() => location.reload(), 600); } catch { /* toast */ }
    });
    $('[data-coll-delete]', bar).addEventListener('click', async () => {
      const ok = await dialog({ title: 'Borrar colección', text: 'Los looks seguirán en «Todos» tus guardados.', confirm: 'Borrar', danger: true });
      if (!ok) return;
      try { await api(`/api/collections/${id}/delete`, {}); location.href = '/guardados'; } catch { /* toast */ }
    });
    const pub = $('[data-coll-public]', bar);
    pub.addEventListener('change', async () => {
      try {
        const r = await api(`/api/collections/${id}`, { is_public: pub.checked });
        $('[data-coll-share]', bar).hidden = !r.is_public;
        toast(r.is_public ? 'Colección pública: cualquiera con el enlace puede verla.' : 'Colección privada: sólo tú la ves.');
      } catch { pub.checked = !pub.checked; }
    });
  }

  const picker = $('[data-picker]');
  if (picker) {
    const form = $('[data-picker-form]', picker);
    const cnt = $('[data-picker-count]', picker);
    form.addEventListener('change', () => { const n = $$('input:checked', form).length; cnt.textContent = `${n} ${n === 1 ? 'seleccionado' : 'seleccionados'}`; });
    $$('[data-open-picker]').forEach((b) => b.addEventListener('click', () => openModal(picker)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const add = $$('input:checked', form).map((i) => Number(i.value));
      if (!add.length) { toast('Selecciona al menos un look.'); return; }
      try { await api(`/api/collections/${bar.dataset.id}/items`, { add }); location.reload(); } catch { /* toast */ }
    });
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove-from]');
    if (!b) return;
    e.preventDefault();
    try {
      await api(`/api/collections/${b.dataset.removeFrom}/items`, { remove: [Number(b.dataset.post)] });
      const card = b.closest('.card');
      card.animate?.([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 300, easing: 'ease-in' }).finished.then(() => card.remove());
      toast('Quitado de la colección (sigue en «Todos»).');
    } catch { /* toast */ }
  });

  /* ═══════════════ Registro: pase backstage en vivo ═══════════════ */
  const uname = $('[data-username]');
  const passName = $('[data-pass-name]');
  if (uname && passName) {
    uname.addEventListener('input', () => {
      uname.value = uname.value.toLowerCase().replace(/[^a-z0-9._]/g, '');
      passName.textContent = '@' + (uname.value || 'tu_usuario');
    });
  }
  const tiltArea = $('[data-tilt-area]');
  const tilt = $('[data-tilt]');
  if (tiltArea && tilt && finePointer && !reduced) {
    tiltArea.addEventListener('mousemove', (e) => {
      const r = tiltArea.getBoundingClientRect();
      tilt.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 30}deg`);
      tilt.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 20}deg`);
    });
    tiltArea.addEventListener('mouseleave', () => { tilt.style.removeProperty('--ry'); tilt.style.removeProperty('--rx'); });
  }

  // Mensaje de despedida tras borrar la cuenta
  if (new URLSearchParams(location.search).has('adios')) toast('Tu cuenta y tus datos se han eliminado. Gracias por desfilar con nosotros.', { ms: 7000 });
})();
