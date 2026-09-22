import { Router } from 'express';

const r = Router();

const PAGES = {
  'aviso-legal': { view: 'legal/aviso-legal', title: 'Aviso legal' },
  privacidad: { view: 'legal/privacidad', title: 'Política de privacidad' },
  cookies: { view: 'legal/cookies', title: 'Política de cookies' },
  terminos: { view: 'legal/terminos', title: 'Términos y condiciones' },
  normas: { view: 'legal/normas', title: 'Normas de la comunidad' },
  accesibilidad: { view: 'legal/accesibilidad', title: 'Declaración de accesibilidad' },
};

r.get('/legal/:page', (req, res, next) => {
  const p = PAGES[req.params.page];
  if (!p) return next();
  res.render(p.view, { pages: PAGES, current: req.params.page, meta: { title: p.title, description: `${p.title} de VIBRA.` } });
});

r.get('/contacto', (req, res) => {
  res.render('contact', { meta: { title: 'Contacto', description: 'Contacta con el equipo de VIBRA.' } });
});

r.get('/sobre', (req, res) => {
  res.render('about', { meta: { title: 'Manifiesto', description: 'VIBRA nace para darle a la calle la pasarela que merece. Lee nuestro manifiesto.' } });
});

export default r;
