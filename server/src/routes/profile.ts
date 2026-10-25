import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const profileRouter = Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const profileSchema = z.object({
  sex: z.enum(["male", "female"]),
  age: z.coerce.number().int().min(13).max(120),
  heightCm: z.coerce.number().min(90).max(250),
  activity: z.enum(["sedentary", "light", "moderate", "active", "very-active"]),
  goal: z.enum(["lose", "maintain", "gain"]),
  pace: z.enum(["slow", "moderate", "fast"]),
  units: z.enum(["imperial", "metric"]),
  autoGoals: z.boolean(),
});

const profileSelect = `SELECT sex, age, height_cm AS heightCm, activity, goal, pace, units, auto_goals AS autoGoals
  FROM profiles WHERE user_id = ?`;

function loadProfile(userId: number) {
  const row = db.prepare(profileSelect).get(userId) as (Record<string, unknown> & { autoGoals: number }) | undefined;
  return row ? { ...row, autoGoals: Boolean(row.autoGoals) } : null;
}

profileRouter.get("/profile", (req, res) => {
  res.json({ profile: loadProfile(req.userId!) });
});

profileRouter.put("/profile", (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
    return;
  }
  const p = parsed.data;
  db.prepare(
    `INSERT INTO profiles (user_id, sex, age, height_cm, activity, goal, pace, units, auto_goals, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET sex = excluded.sex, age = excluded.age, height_cm = excluded.height_cm,
       activity = excluded.activity, goal = excluded.goal, pace = excluded.pace, units = excluded.units,
       auto_goals = excluded.auto_goals, updated_at = excluded.updated_at`,
  ).run(req.userId!, p.sex, p.age, p.heightCm, p.activity, p.goal, p.pace, p.units, p.autoGoals ? 1 : 0);
  res.json({ profile: loadProfile(req.userId!) });
});

// ---- Weight log (one entry per day; logging again on the same day replaces it) ----

const weightSelect = "SELECT id, date, weight_kg AS weightKg FROM weight_entries";

profileRouter.get("/weights", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 3650);
  res.json(
    db
      .prepare(`${weightSelect} WHERE user_id = ? AND date >= date('now', ?) ORDER BY date`)
      .all(req.userId!, `-${days} days`),
  );
});

profileRouter.get("/weights/latest", (req, res) => {
  res.json(db.prepare(`${weightSelect} WHERE user_id = ? ORDER BY date DESC LIMIT 1`).get(req.userId!) ?? null);
});

profileRouter.post("/weights", (req, res) => {
  const parsed = z.object({ date: dateSchema, weightKg: z.coerce.number().min(20).max(400) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a weight between 45 and 880 lb (20–400 kg)." });
    return;
  }
  const { date, weightKg } = parsed.data;
  db.prepare(
    `INSERT INTO weight_entries (user_id, date, weight_kg) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`,
  ).run(req.userId!, date, weightKg);
  res.status(201).json(db.prepare(`${weightSelect} WHERE user_id = ? AND date = ?`).get(req.userId!, date));
});

profileRouter.delete("/weights/:id", (req, res) => {
  db.prepare("DELETE FROM weight_entries WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId!);
  res.json({ ok: true });
});
