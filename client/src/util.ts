import type { Meal, Nutrition } from "./api";

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's clock). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function formatDateLabel(date: string): string {
  const t = today();
  if (date === t) return "Today";
  if (date === addDays(t, -1)) return "Yesterday";
  if (date === addDays(t, 1)) return "Tomorrow";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Guess which meal the user is logging based on the time of day. */
export function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function scale(n: Nutrition, factor: number): Nutrition {
  return {
    calories: round(n.calories * factor),
    protein: round(n.protein * factor, 1),
    carbs: round(n.carbs * factor, 1),
    fat: round(n.fat * factor, 1),
  };
}

export function sum(items: Nutrition[]): Nutrition {
  return items.reduce(
    (acc, n) => ({
      calories: acc.calories + n.calories,
      protein: acc.protein + n.protein,
      carbs: acc.carbs + n.carbs,
      fat: acc.fat + n.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Water units (stored as ml on the server, shown in the user's preferred unit) ----

export type WaterUnit = "oz" | "ml";
const ML_PER_OZ = 29.5735;

export function getWaterUnit(): WaterUnit {
  try {
    return localStorage.getItem("waterUnit") === "ml" ? "ml" : "oz";
  } catch {
    return "oz";
  }
}

export function setWaterUnit(unit: WaterUnit) {
  try {
    localStorage.setItem("waterUnit", unit);
  } catch {
    // Ignore storage failures (private mode); the default unit is used instead.
  }
}

export const mlToUnit = (ml: number, unit: WaterUnit) => (unit === "oz" ? round(ml / ML_PER_OZ, 1) : round(ml));
export const unitToMl = (value: number, unit: WaterUnit) => (unit === "oz" ? value * ML_PER_OZ : value);
export const formatWater = (ml: number, unit: WaterUnit) => `${mlToUnit(ml, unit)} ${unit}`;

// ---- Claude nutrition block parsing ----

export interface ClaudeNutrition extends Nutrition {
  name: string;
  amount?: string;
}

const NUTRITION_BLOCK = /```nutrition\s*([\s\S]*?)```/;

/** Splits Claude's reply into display text and the optional structured nutrition estimate. */
export function parseClaudeReply(text: string): { display: string; nutrition: ClaudeNutrition | null } {
  const match = text.match(NUTRITION_BLOCK);
  if (!match) return { display: text, nutrition: null };
  const display = text.replace(NUTRITION_BLOCK, "").trim();
  try {
    const raw = JSON.parse(match[1]);
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : Number(v) || 0);
    if (typeof raw?.name !== "string") return { display, nutrition: null };
    return {
      display,
      nutrition: {
        name: raw.name,
        amount: typeof raw.amount === "string" ? raw.amount : undefined,
        calories: n(raw.calories),
        protein: n(raw.protein),
        carbs: n(raw.carbs),
        fat: n(raw.fat),
      },
    };
  } catch {
    return { display, nutrition: null };
  }
}
