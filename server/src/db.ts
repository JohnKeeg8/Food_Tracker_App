import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "health.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goals (
    user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    calories  REAL NOT NULL DEFAULT 2000,
    protein_g REAL NOT NULL DEFAULT 120,
    carbs_g   REAL NOT NULL DEFAULT 225,
    fat_g     REAL NOT NULL DEFAULT 65,
    water_ml  REAL NOT NULL DEFAULT 2500
  );

  CREATE TABLE IF NOT EXISTS food_entries (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    meal       TEXT NOT NULL,
    name       TEXT NOT NULL,
    brand      TEXT,
    barcode    TEXT,
    amount     TEXT,
    calories   REAL NOT NULL DEFAULT 0,
    protein_g  REAL NOT NULL DEFAULT 0,
    carbs_g    REAL NOT NULL DEFAULT 0,
    fat_g      REAL NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_food_user_date ON food_entries(user_id, date);

  CREATE TABLE IF NOT EXISTS water_entries (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    amount_ml  REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_water_user_date ON water_entries(user_id, date);

  CREATE TABLE IF NOT EXISTS profiles (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sex        TEXT NOT NULL,
    age        INTEGER NOT NULL,
    height_cm  REAL NOT NULL,
    activity   TEXT NOT NULL,
    goal       TEXT NOT NULL,
    pace       TEXT NOT NULL,
    units      TEXT NOT NULL DEFAULT 'imperial',
    auto_goals INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS weight_entries (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    weight_kg  REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, date)
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    servings     REAL NOT NULL DEFAULT 1,
    instructions TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id        INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    name      TEXT NOT NULL,
    quantity  TEXT NOT NULL DEFAULT '',
    calories  REAL NOT NULL DEFAULT 0,
    protein_g REAL NOT NULL DEFAULT 0,
    carbs_g   REAL NOT NULL DEFAULT 0,
    fat_g     REAL NOT NULL DEFAULT 0
  );
`);

/** Run `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
