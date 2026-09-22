import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { isRemote, save, remove, fetchObject } from './storage.js';

/**
 * Persistencia de la base de datos en servidores SIN disco duradero
 * (Render, Northflank, Koyeb…), donde el sistema de archivos se borra en cada reinicio.
 *
 *  - Al arrancar: si no hay base de datos local, la descarga del bucket S3.
 *  - Cada X minutos y al apagarse: sube una copia consistente (backup en caliente de SQLite).
 *  - Guarda además una copia diaria con 7 días de retención.
 *
 * Si no hay bucket configurado (servidor con disco propio) no hace nada.
 */
const KEY = 'db/vibra.db';
const dailyKey = (d = new Date()) => `db/daily-${d.toISOString().slice(0, 10)}.db`;
const enabled = () => isRemote() && config.dbSync.minutes > 0;

// Estado de la restauración, para no sobrescribir nunca una copia buena con una base vacía.
const state = { restored: false, remoteExists: false, localExisted: false };

/** Se llama ANTES de abrir la base de datos (desde boot.js). */
export async function restoreIfNeeded() {
  if (!enabled()) return;
  state.localExisted = fs.existsSync(config.dbFile) && fs.statSync(config.dbFile).size > 0;
  if (state.localExisted) {
    console.log('  Base de datos local encontrada: no se restaura.');
    return;
  }
  try {
    const res = await fetchObject(KEY);
    if (res.status === 404) {
      console.log('  Sin copia previa en el bucket: se empieza con una base de datos nueva.');
      return;
    }
    if (!res.ok) throw new Error(`S3 ${res.status}`);
    state.remoteExists = true;
    await fsp.writeFile(config.dbFile, Buffer.from(await res.arrayBuffer()));
    state.restored = true;
    console.log(`  ✔ Base de datos restaurada desde el bucket (${(fs.statSync(config.dbFile).size / 1024).toFixed(0)} KB).`);
  } catch (e) {
    // Mejor no arrancar que arrancar vacío y sobrescribir la copia buena.
    console.error('\n  ✖ No se pudo restaurar la base de datos del bucket:', e.message);
    console.error('    Revisa las credenciales S3. La app no arranca para no perder datos.\n');
    process.exit(1);
  }
}

/** Se llama DESPUÉS de abrir la base de datos (desde server.js). */
export function startDbSync(db) {
  if (!enabled()) return { snapshot: async () => {} };
  let busy = false;
  let lastDaily = '';

  // Seguro anti-desastre: si hay copia en el bucket pero estamos con una base vacía
  // (restauración fallida o bucket equivocado), no subimos nada y avisamos.
  const empty = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0
    && db.prepare('SELECT COUNT(*) AS n FROM posts').get().n === 0;
  if (empty && !state.restored) {
    fetchObject(KEY).then((res) => {
      if (res.ok) {
        console.error('\n  ✖ PELIGRO: hay una copia de la base de datos en el bucket pero la app ha arrancado vacía.');
        console.error('    No se subirá ninguna copia para no destruirla. Revisa S3_BUCKET / credenciales y reinicia.\n');
        process.exit(1);
      }
    }).catch(() => {});
  }

  const snapshot = async (reason = 'periódica') => {
    if (busy) return;
    busy = true;
    const tmp = path.join(config.dataDir, `.snapshot-${process.pid}.db`);
    try {
      const { backup } = await import('node:sqlite');
      await backup(db, tmp);
      const data = await fsp.readFile(tmp);
      // PUT sobrescribe: no borramos antes (en Backblaze B2 eso dejaría versiones ocultas).
      await save(KEY, data, 'application/octet-stream', { overwrite: true });
      const today = dailyKey();
      if (today !== lastDaily) {
        await save(today, data, 'application/octet-stream', { overwrite: true });
        await remove(dailyKey(new Date(Date.now() - 7 * 864e5)));
        lastDaily = today;
      }
      console.log(`[db-sync] copia ${reason} subida (${(data.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.error('[db-sync] error al subir la copia:', e.message);
    } finally {
      await fsp.unlink(tmp).catch(() => {});
      busy = false;
    }
  };

  const timer = setInterval(() => snapshot(), config.dbSync.minutes * 60_000);
  timer.unref();
  snapshot('inicial');
  return { snapshot };
}
