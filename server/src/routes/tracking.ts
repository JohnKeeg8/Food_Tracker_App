import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const trackingRouter = Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const meals = ["breakfast", "lunch", "dinner", "snack"] as const;
const num = z.coerce.number().min(0).max(100000);

function parseDate(value: unknown) {
  const parsed = dateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---- Goals ----

const goalsSelect =
  "SELECT calories, protein_g AS protein, carbs_g AS carbs, fat_g AS fat, water_ml AS waterMl FROM goals WHERE user_id = ?";

trackingRouter.get("/goals", (req, res) => {
  res.json(db.prepare(goalsSelect).get(req.userId!));
});

trackingRouter.put("/goals", (req, res) => {
  const parsed = z
    .object({ calories: num, protein: num, carbs: num, fat: num, waterMl: num })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid goals" });
    return;
  }
  const g = parsed.data;
  db.prepare(
    `INSERT INTO goals (user_id, calories, protein_g, carbs_g, fat_g, water_ml) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET calories = excluded.calories, protein_g = excluded.protein_g,
       carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, water_ml = excluded.water_ml`,
  ).run(req.userId!, g.calories, g.protein, g.carbs, g.fat, g.waterMl);
  res.json(db.prepare(goalsSelect).get(req.userId!));
});

// ---- Food log ----

const foodSelect = `SELECT id, date, meal, name, brand, barcode, amount, calories, protein_g AS protein,
  carbs_g AS carbs, fat_g AS fat, source, created_at AS createdAt FROM food_entries`;

export const foodEntrySchema = z.object({
  date: dateSchema,
  meal: z.enum(meals),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullish(),
  barcode: z.string().trim().max(64).nullish(),
  amount: z.string().trim().max(100).nullish(),
  calories: num,
  protein: num,
  carbs: num,
  fat: num,
  source: z.enum(["manual", "barcode", "search", "claude", "recipe", "recent"]).default("manual"),
});

export function insertFoodEntry(userId: number, e: z.infer<typeof foodEntrySchema>) {
  const result = db
    .prepare(
      `INSERT INTO food_entries (user_id, date, meal, name, brand, barcode, amount, calories, protein_g, carbs_g, fat_g, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId, e.date, e.meal, e.name, e.brand ?? null, e.barcode ?? null, e.amount ?? null,
      e.calories, e.protein, e.carbs, e.fat, e.source,
    );
  return db.prepare(`${foodSelect} WHERE id = ?`).get(result.lastInsertRowid);
}

trackingRouter.get("/food", (req, res) => {
  const date = parseDate(req.query.date);
  if (!date) {
    res.status(400).json({ error: "date query parameter is required" });
    return;
  }
  res.json(db.prepare(`${foodSelect} WHERE user_id = ? AND date = ? ORDER BY id`).all(req.userId!, date));
});

trackingRouter.get("/food/recent", (req, res) => {
  // Most recently logged distinct foods, for one-tap re-logging.
  const rows = db
    .prepare(
      `${foodSelect} WHERE id IN (
         SELECT MAX(id) FROM food_entries WHERE user_id = ? AND source != 'recipe'
         GROUP BY lower(name), coalesce(amount, '')
       ) ORDER BY id DESC LIMIT 20`,
    )
    .all(req.userId!);
  res.json(rows);
});

trackingRouter.post("/food", (req, res) => {
  const parsed = foodEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" });
    return;
  }
  res.status(201).json(insertFoodEntry(req.userId!, parsed.data));
});

trackingRouter.put("/food/:id", (req, res) => {
  const parsed = foodEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" });
    return;
  }
  const e = parsed.data;
  const result = db
    .prepare(
      `UPDATE food_entries SET date = ?, meal = ?, name = ?, brand = ?, barcode = ?, amount = ?, calories = ?,
         protein_g = ?, carbs_g = ?, fat_g = ? WHERE id = ? AND user_id = ?`,
    )
    .run(
      e.date, e.meal, e.name, e.brand ?? null, e.barcode ?? null, e.amount ?? null,
      e.calories, e.protein, e.carbs, e.fat, Number(req.params.id), req.userId!,
    );
  if (result.changes === 0) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json(db.prepare(`${foodSelect} WHERE id = ?`).get(Number(req.params.id)));
});

trackingRouter.delete("/food/:id", (req, res) => {
  db.prepare("DELETE FROM food_entries WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId!);
  res.json({ ok: true });
});

// ---- Water ----

trackingRouter.get("/water", (req, res) => {
  const date = parseDate(req.query.date);
  if (!date) {
    res.status(400).json({ error: "date query parameter is required" });
    return;
  }
  res.json(
    db
      .prepare(
        "SELECT id, date, amount_ml AS amountMl, created_at AS createdAt FROM water_entries WHERE user_id = ? AND date = ? ORDER BY id",
      )
      .all(req.userId!, date),
  );
});

trackingRouter.post("/water", (req, res) => {
  const parsed = z.object({ date: dateSchema, amountMl: z.coerce.number().positive().max(10000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid water entry" });
    return;
  }
  const result = db
    .prepare("INSERT INTO water_entries (user_id, date, amount_ml) VALUES (?, ?, ?)")
    .run(req.userId!, parsed.data.date, parsed.data.amountMl);
  res.status(201).json({ id: Number(result.lastInsertRowid), ...parsed.data });
});

trackingRouter.delete("/water/:id", (req, res) => {
  db.prepare("DELETE FROM water_entries WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId!);
  res.json({ ok: true });
});

// ---- Summaries ----

trackingRouter.get("/history", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const end = parseDate(req.query.end);
  if (!end) {
    res.status(400).json({ error: "end query parameter is required" });
    return;
  }
  const dates: string[] = [];
  const endDate = new Date(`${end}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const food = db
    .prepare(
      `SELECT date, SUM(calories) AS calories, SUM(protein_g) AS protein, SUM(carbs_g) AS carbs, SUM(fat_g) AS fat
       FROM food_entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date`,
    )
    .all(req.userId!, dates[0], end) as { date: string; calories: number; protein: number; carbs: number; fat: number }[];
  const water = db
    .prepare(
      "SELECT date, SUM(amount_ml) AS waterMl FROM water_entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date",
    )
    .all(req.userId!, dates[0], end) as { date: string; waterMl: number }[];
  const foodByDate = new Map(food.map((f) => [f.date, f]));
  const waterByDate = new Map(water.map((w) => [w.date, w.waterMl]));
  res.json(
    dates.map((date) => {
      const f = foodByDate.get(date);
      return {
        date,
        calories: f?.calories ?? 0,
        protein: f?.protein ?? 0,
        carbs: f?.carbs ?? 0,
        fat: f?.fat ?? 0,
        waterMl: waterByDate.get(date) ?? 0,
      };
    }),
  );
});
