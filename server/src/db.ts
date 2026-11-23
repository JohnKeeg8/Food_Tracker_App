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

  CREATE TABLE IF NOT EXISTS workouts (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    name       TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

  CREATE TABLE IF NOT EXISTS workout_exercises (
    id          INTEGER PRIMARY KEY,
    workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    exercise_id TEXT,
    name        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises(workout_id);

  CREATE TABLE IF NOT EXISTS workout_sets (
    id                  INTEGER PRIMARY KEY,
    workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL,
    weight_kg           REAL,
    reps                INTEGER,
    seconds             INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(workout_exercise_id);

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

// ---- Migrations for databases created by earlier versions (CREATE TABLE IF NOT EXISTS doesn't add columns) ----

function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

// Food entries store how many servings were eaten, so "Recent" can offer the food per serving
// (e.g. 1 slice) instead of the multiplied amount (e.g. 300% × 1 slice).
if (!hasColumn("food_entries", "quantity")) {
  transaction(() => {
    db.exec("ALTER TABLE food_entries ADD COLUMN quantity REAL NOT NULL DEFAULT 1");
    // Earlier versions wrote portions into the amount text ("½ of 1 plate", "300% × 1 slice", "2 portions").
    // Split those back into the serving and the quantity. Calories and macros stay as the totals eaten.
    const fractions: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "1½": 1.5 };
    const parseQuantity = (text: string) => {
      if (text in fractions) return fractions[text];
      if (/^\d+(\.\d+)?%$/.test(text)) return Number(text.slice(0, -1)) / 100;
      if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
      return undefined;
    };
    const rows = db.prepare("SELECT id, amount FROM food_entries WHERE amount IS NOT NULL").all() as { id: number; amount: string }[];
    const update = db.prepare("UPDATE food_entries SET amount = ?, quantity = ? WHERE id = ?");
    for (const row of rows) {
      // Only text the app generated: "of" was used for less than one serving, "×" for more than one.
      const withServing = row.amount.match(/^(\S+) (of|×) (.+)$/);
      if (withServing) {
        const quantity = parseQuantity(withServing[1]);
        const fits = quantity !== undefined && (withServing[2] === "of" ? quantity < 1 : quantity > 1);
        if (fits && quantity > 0) update.run(withServing[3], quantity, row.id);
        continue;
      }
      const portionsOnly = row.amount.match(/^(\S+) (portion|portions)$/);
      if (portionsOnly) {
        const quantity = parseQuantity(portionsOnly[1]);
        const fits = quantity !== undefined && (portionsOnly[2] === "portion" ? quantity < 1 : quantity > 1);
        if (fits && quantity > 0) update.run(null, quantity, row.id);
      }
    }
  });
}

// Drop sets: extra rows that continue the set before them at a lower weight.
if (!hasColumn("workout_sets", "is_drop")) {
  db.exec("ALTER TABLE workout_sets ADD COLUMN is_drop INTEGER NOT NULL DEFAULT 0");
}

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
