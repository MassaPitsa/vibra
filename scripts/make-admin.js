// Da rol de administrador a un usuario. Uso: npm run make-admin -- nombre_usuario
import { db } from '../src/db.js';

const username = (process.argv[2] || '').toLowerCase();
if (!username) {
  console.error('Uso: npm run make-admin -- <usuario>');
  process.exit(1);
}
const r = db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(username);
console.log(r.changes ? `✔ @${username} ahora es administrador.` : `✖ No existe el usuario @${username}.`);
process.exit(0);
