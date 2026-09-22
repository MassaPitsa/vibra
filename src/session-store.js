import session from 'express-session';
import { db } from './db.js';

/** Almacén de sesiones persistente en SQLite (sobrevive a reinicios, sin fugas de memoria). */
export class SqliteStore extends session.Store {
  constructor() {
    super();
    this.q = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'),
      del: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      delUser: db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      purge: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };
    setInterval(() => this.q.purge.run(Date.now()), 60 * 60 * 1000).unref();
  }
  #exp(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
  }
  get(sid, cb) {
    try {
      const row = this.q.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { this.q.set.run(sid, JSON.stringify(sess), this.#exp(sess)); cb?.(null); } catch (e) { cb?.(e); }
  }
  destroy(sid, cb) {
    try { this.q.del.run(sid); cb?.(null); } catch (e) { cb?.(e); }
  }
  touch(sid, sess, cb) {
    try { this.q.touch.run(this.#exp(sess), sid); cb?.(null); } catch (e) { cb?.(e); }
  }
  /** Cierra todas las sesiones de un usuario (cambio de contraseña, baneo, borrado). */
  destroyUser(userId) {
    this.q.delUser.run(userId);
  }
}

export const sessionStore = new SqliteStore();
