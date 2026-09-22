// Copia de seguridad en caliente de la base de datos (segura con la web en marcha).
// Uso: npm run backup   → crea data/backups/vibra-AAAA-MM-DD-HHMM.db y conserva las 14 últimas.
// Las fotos están en data/uploads: cópialas también (p. ej. con rsync o el snapshot del disco).
import fs from 'node:fs';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = path.join(dir, `vibra-${stamp}.db`);
await backup(db, file);
const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -14);
old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
console.log(`✔ Copia creada: ${file}`);
process.exit(0);
