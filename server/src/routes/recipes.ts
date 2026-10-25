import { Router } from "express";
import { z } from "zod";
import { db, transaction } from "../db.js";
import { insertFoodEntry } from "./tracking.js";

export const recipesRouter = Router();

const num = z.coerce.number().min(0).max(100000);

const recipeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  servings: z.coerce.number().positive().max(1000),
  instructions: z.string().max(20000).default(""),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.string().trim().max(100).default(""),
        calories: num,
        protein: num,
        carbs: num,
        fat: num,
      }),
    )
    .max(200),
});

interface RecipeRow {
  id: number;
  name: string;
  servings: number;
  instructions: string;
  updatedAt: string;
}

interface IngredientRow {
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

function loadRecipe(userId: number, id: number) {
  const recipe = db
    .prepare("SELECT id, name, servings, instructions, updated_at AS updatedAt FROM recipes WHERE id = ? AND user_id = ?")
    .get(id, userId) as RecipeRow | undefined;
  if (!recipe) return undefined;
  const ingredients = db
    .prepare(
      `SELECT name, quantity, calories, protein_g AS protein, carbs_g AS carbs, fat_g AS fat
       FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position`,
    )
    .all(id) as unknown as IngredientRow[];
  return { ...recipe, ingredients, perServing: perServing(ingredients, recipe.servings) };
}

function perServing(ingredients: IngredientRow[], servings: number) {
  const total = ingredients.reduce(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      protein: acc.protein + i.protein,
      carbs: acc.carbs + i.carbs,
      fat: acc.fat + i.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return {
    calories: total.calories / servings,
    protein: total.protein / servings,
    carbs: total.carbs / servings,
    fat: total.fat / servings,
  };
}

function saveIngredients(recipeId: number, ingredients: z.infer<typeof recipeSchema>["ingredients"]) {
  db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").run(recipeId);
  const insert = db.prepare(
    `INSERT INTO recipe_ingredients (recipe_id, position, name, quantity, calories, protein_g, carbs_g, fat_g)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ingredients.forEach((i, position) =>
    insert.run(recipeId, position, i.name, i.quantity, i.calories, i.protein, i.carbs, i.fat),
  );
}

recipesRouter.get("/", (req, res) => {
  const recipes = db
    .prepare("SELECT id FROM recipes WHERE user_id = ? ORDER BY lower(name)")
    .all(req.userId!) as { id: number }[];
  res.json(recipes.map((r) => loadRecipe(req.userId!, r.id)));
});

recipesRouter.get("/:id", (req, res) => {
  const recipe = loadRecipe(req.userId!, Number(req.params.id));
  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }
  res.json(recipe);
});

recipesRouter.post("/", (req, res) => {
  const parsed = recipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid recipe" });
    return;
  }
  const r = parsed.data;
  const id = transaction(() => {
    const result = db
      .prepare("INSERT INTO recipes (user_id, name, servings, instructions) VALUES (?, ?, ?, ?)")
      .run(req.userId!, r.name, r.servings, r.instructions);
    const recipeId = Number(result.lastInsertRowid);
    saveIngredients(recipeId, r.ingredients);
    return recipeId;
  });
  res.status(201).json(loadRecipe(req.userId!, id));
});

recipesRouter.put("/:id", (req, res) => {
  const parsed = recipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid recipe" });
    return;
  }
  const r = parsed.data;
  const id = Number(req.params.id);
  const updated = transaction(() => {
    const result = db
      .prepare(
        "UPDATE recipes SET name = ?, servings = ?, instructions = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      )
      .run(r.name, r.servings, r.instructions, id, req.userId!);
    if (result.changes === 0) return false;
    saveIngredients(id, r.ingredients);
    return true;
  });
  if (!updated) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }
  res.json(loadRecipe(req.userId!, id));
});

recipesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM recipes WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId!);
  res.json({ ok: true });
});

recipesRouter.post("/:id/log", (req, res) => {
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      servings: z.coerce.number().positive().max(100),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid log request" });
    return;
  }
  const recipe = loadRecipe(req.userId!, Number(req.params.id));
  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }
  const { date, meal, servings } = parsed.data;
  const round = (n: number) => Math.round(n * servings * 10) / 10;
  const entry = insertFoodEntry(req.userId!, {
    date,
    meal,
    name: recipe.name,
    amount: `${servings} serving${servings === 1 ? "" : "s"}`,
    calories: round(recipe.perServing.calories),
    protein: round(recipe.perServing.protein),
    carbs: round(recipe.perServing.carbs),
    fat: round(recipe.perServing.fat),
    source: "recipe",
  });
  res.status(201).json(entry);
});
