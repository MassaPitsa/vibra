import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    bio           TEXT NOT NULL DEFAULT '',
    city          TEXT NOT NULL DEFAULT '',
    instagram     TEXT NOT NULL DEFAULT '',
    avatar        TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'active',
    terms_version TEXT NOT NULL,
    terms_accepted_at INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    city        TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    pieces      TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'published',
    removal_reason TEXT,
    save_count  INTEGER NOT NULL DEFAULT 0,
    view_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS post_images (
    id       INTEGER PRIMARY KEY,
    post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    file     TEXT NOT NULL,
    thumb    TEXT NOT NULL,
    width    INTEGER NOT NULL,
    height   INTEGER NOT NULL,
    color    TEXT NOT NULL DEFAULT '#1a1a1a',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_images_post ON post_images(post_id, position);

  CREATE TABLE IF NOT EXISTS saves (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, post_id)
  );
  CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_saves_post ON saves(post_id);

  CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    is_public  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    added_at      INTEGER NOT NULL,
    PRIMARY KEY (collection_id, post_id)
  );
  CREATE INDEX IF NOT EXISTS idx_citems_post ON collection_items(post_id);

  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY,
    post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT NOT NULL,
    details     TEXT NOT NULL DEFAULT '',
    contact     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

export const now = () => Date.now();

/** Ejecuta fn dentro de una transacción. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Recalcula el contador de guardados de un post. */
export function refreshSaveCount(postId) {
  db.prepare('UPDATE posts SET save_count = (SELECT COUNT(*) FROM saves WHERE post_id = ?) WHERE id = ?').run(postId, postId);
}
