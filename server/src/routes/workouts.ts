import { Router } from "express";
import { z } from "zod";
import { db, transaction } from "../db.js";

export const workoutsRouter = Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const workoutSchema = z.object({
  date: dateSchema,
  name: z.string().trim().min(1).max(100),
  notes: z.string().max(2000).default(""),
  exercises: z
    .array(
      z.object({
        // Id from the app's exercise library, or null for a custom exercise.
        exerciseId: z.string().max(64).nullish(),
        name: z.string().trim().min(1).max(100),
        sets: z
          .array(
            z.object({
              weightKg: z.number().min(0).max(2000).nullish(),
              reps: z.number().int().min(0).max(10000).nullish(),
              seconds: z.number().int().min(0).max(86400).nullish(),
            }),
          )
          .max(50),
      }),
    )
    .min(1, "Add at least one exercise")
    .max(60),
});

type WorkoutInput = z.infer<typeof workoutSchema>;

interface WorkoutRow {
  id: number;
  date: string;
  name: string;
  notes: string;
}

function loadWorkouts(userId: number, where: string, params: (string | number)[], limit: number) {
  const workouts = db
    .prepare(`SELECT id, date, name, notes FROM workouts WHERE user_id = ? ${where} ORDER BY date DESC, id DESC LIMIT ?`)
    .all(userId, ...params, limit) as unknown as WorkoutRow[];
  const exerciseStmt = db.prepare(
    "SELECT id, exercise_id AS exerciseId, name FROM workout_exercises WHERE workout_id = ? ORDER BY position",
  );
  const setStmt = db.prepare(
    "SELECT weight_kg AS weightKg, reps, seconds FROM workout_sets WHERE workout_exercise_id = ? ORDER BY position",
  );
  return workouts.map((w) => ({
    ...w,
    exercises: (exerciseStmt.all(w.id) as { id: number; exerciseId: string | null; name: string }[]).map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      sets: setStmt.all(e.id),
    })),
  }));
}

function saveExercises(workoutId: number, exercises: WorkoutInput["exercises"]) {
  // Sets are removed with their exercises (ON DELETE CASCADE).
  db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?").run(workoutId);
  const insertExercise = db.prepare(
    "INSERT INTO workout_exercises (workout_id, position, exercise_id, name) VALUES (?, ?, ?, ?)",
  );
  const insertSet = db.prepare(
    "INSERT INTO workout_sets (workout_exercise_id, position, weight_kg, reps, seconds) VALUES (?, ?, ?, ?, ?)",
  );
  exercises.forEach((e, position) => {
    const exerciseRowId = insertExercise.run(workoutId, position, e.exerciseId ?? null, e.name).lastInsertRowid;
    e.sets.forEach((s, setPosition) =>
      insertSet.run(exerciseRowId, setPosition, s.weightKg ?? null, s.reps ?? null, s.seconds ?? null),
    );
  });
}

workoutsRouter.get("/", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const date = dateSchema.safeParse(req.query.date);
  res.json(date.success ? loadWorkouts(req.userId!, "AND date = ?", [date.data], limit) : loadWorkouts(req.userId!, "", [], limit));
});

workoutsRouter.post("/", (req, res) => {
  const parsed = workoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid workout" });
    return;
  }
  const w = parsed.data;
  const id = transaction(() => {
    const result = db
      .prepare("INSERT INTO workouts (user_id, date, name, notes) VALUES (?, ?, ?, ?)")
      .run(req.userId!, w.date, w.name, w.notes);
    const workoutId = Number(result.lastInsertRowid);
    saveExercises(workoutId, w.exercises);
    return workoutId;
  });
  res.status(201).json(loadWorkouts(req.userId!, "AND id = ?", [id], 1)[0]);
});

workoutsRouter.put("/:id", (req, res) => {
  const parsed = workoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid workout" });
    return;
  }
  const w = parsed.data;
  const id = Number(req.params.id);
  const updated = transaction(() => {
    const result = db
      .prepare("UPDATE workouts SET date = ?, name = ?, notes = ? WHERE id = ? AND user_id = ?")
      .run(w.date, w.name, w.notes, id, req.userId!);
    if (result.changes === 0) return false;
    saveExercises(id, w.exercises);
    return true;
  });
  if (!updated) {
    res.status(404).json({ error: "Workout not found" });
    return;
  }
  res.json(loadWorkouts(req.userId!, "AND id = ?", [id], 1)[0]);
});

workoutsRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM workouts WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId!);
  res.json({ ok: true });
});
