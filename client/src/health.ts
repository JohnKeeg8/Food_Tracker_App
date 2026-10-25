import type { Goals, Profile } from "./api";

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very-active";
export type WeightGoal = "lose" | "maintain" | "gain";
export type Pace = "slow" | "moderate" | "fast";
export type Units = "imperial" | "metric";

export const ACTIVITY_LEVELS: { value: Activity; label: string; detail: string; factor: number }[] = [
  { value: "sedentary", label: "Sedentary", detail: "Desk job, little exercise", factor: 1.2 },
  { value: "light", label: "Lightly active", detail: "Exercise 1–3 days a week", factor: 1.375 },
  { value: "moderate", label: "Moderately active", detail: "Exercise 3–5 days a week", factor: 1.55 },
  { value: "active", label: "Very active", detail: "Hard exercise 6–7 days a week", factor: 1.725 },
  { value: "very-active", label: "Extremely active", detail: "Physical job plus training", factor: 1.9 },
];

/** Daily calorie change for each pace. ~7,700 kcal ≈ 1 kg (3,500 kcal ≈ 1 lb) of body weight. */
export const PACE_KCAL: Record<WeightGoal, Record<Pace, number>> = {
  lose: { slow: -250, moderate: -500, fast: -750 },
  maintain: { slow: 0, moderate: 0, fast: 0 },
  gain: { slow: 250, moderate: 350, fast: 500 },
};

export function paceLabel(goal: WeightGoal, pace: Pace, units: Units): string {
  const kgPerWeek = Math.abs(PACE_KCAL[goal][pace]) * 7 / 7700;
  const amount = units === "imperial" ? `${round1(kgToLb(kgPerWeek))} lb` : `${round1(kgPerWeek)} kg`;
  const verb = goal === "lose" ? "Lose" : "Gain";
  const name = pace === "slow" ? "Slow" : pace === "moderate" ? "Steady" : "Faster";
  return `${name}: ${verb.toLowerCase()} ~${amount}/week`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
export const kgToLb = (kg: number) => kg * 2.20462;
export const lbToKg = (lb: number) => lb / 2.20462;
export const cmToFtIn = (cm: number) => {
  const totalIn = Math.round(cm / 2.54);
  return { ft: Math.floor(totalIn / 12), inches: totalIn % 12 };
};
export const ftInToCm = (ft: number, inches: number) => (ft * 12 + inches) * 2.54;

export function formatWeight(kg: number, units: Units): string {
  return units === "imperial" ? `${round1(kgToLb(kg))} lb` : `${round1(kg)} kg`;
}

export function formatHeight(cm: number, units: Units): string {
  if (units === "metric") return `${Math.round(cm)} cm`;
  const { ft, inches } = cmToFtIn(cm);
  return `${ft}′${inches}″`;
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function bmiCategory(value: number): string {
  if (value < 18.5) return "Underweight";
  if (value < 25) return "Healthy range";
  if (value < 30) return "Overweight";
  return "Obese range";
}

export interface Plan {
  bmr: number;
  maintenance: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number;
  bmi: number;
  /** Calories were raised to a safe minimum. */
  floored: boolean;
  warnings: string[];
}

/**
 * Daily targets from the Mifflin–St Jeor equation, an activity multiplier and the chosen goal.
 * These are standard estimates for adults, not medical advice.
 */
export function calculatePlan(p: Pick<Profile, "sex" | "age" | "heightCm" | "activity" | "goal" | "pace">, weightKg: number): Plan {
  const bmr = 10 * weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const factor = ACTIVITY_LEVELS.find((a) => a.value === p.activity)?.factor ?? 1.2;
  const maintenance = bmr * factor;
  const bmiValue = bmi(weightKg, p.heightCm);
  const warnings: string[] = [];

  let calories = maintenance + PACE_KCAL[p.goal][p.pace];
  // Don't recommend very low intakes without medical supervision.
  const minimum = Math.max(p.sex === "male" ? 1500 : 1200, Math.round(bmr));
  let floored = false;
  if (p.goal === "lose" && calories < minimum) {
    calories = minimum;
    floored = true;
    warnings.push("Your calorie target was raised to a safe minimum. Try a slower pace or adding more activity.");
  }
  if (p.goal === "lose" && bmiValue < 18.5) {
    warnings.push("Your BMI is already below the healthy range. Losing more weight isn't recommended; consider maintaining, and talk to a doctor.");
  }
  if (p.age < 18) {
    warnings.push("These formulas are made for adults. Teens should check calorie needs with a doctor or dietitian.");
  }

  // Protein: higher when losing (keeps muscle, keeps you full) or gaining (builds muscle).
  // For higher body weights, base it on a healthy-range weight so the target stays realistic.
  const proteinWeight = bmiValue > 27 ? 25 * (p.heightCm / 100) ** 2 : weightKg;
  const proteinPerKg = p.goal === "maintain" ? 1.4 : 1.8;
  const protein = proteinWeight * proteinPerKg;
  const fat = (calories * 0.3) / 9;
  const carbs = Math.max(0, (calories - protein * 4 - fat * 9) / 4);
  const waterMl = Math.min(4000, Math.max(1500, Math.round((weightKg * 35) / 50) * 50));

  return {
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    calories: Math.round(calories / 10) * 10,
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    waterMl,
    bmi: round1(bmiValue),
    floored,
    warnings,
  };
}

export function planToGoals(plan: Plan): Goals {
  return { calories: plan.calories, protein: plan.protein, carbs: plan.carbs, fat: plan.fat, waterMl: plan.waterMl };
}

export const GOAL_TEXT: Record<WeightGoal, string> = {
  lose: "Lose weight",
  maintain: "Maintain weight",
  gain: "Gain weight",
};

/** A short, goal-aware nudge for the rest of the day, based on what's been eaten so far. */
export function dailyTip(goal: WeightGoal, remaining: { calories: number; protein: number }): string {
  const cal = Math.round(remaining.calories);
  const protein = Math.round(remaining.protein);
  if (cal < -150) {
    if (goal === "gain") return `You're ${-cal} kcal over today's target — that's fine while gaining, just keep the protein up.`;
    return `You're ${-cal} kcal over today's target. No stress — just aim to get back on track tomorrow.`;
  }
  if (goal === "lose") {
    if (protein > 20) return `${cal} kcal left. Prioritise protein (${protein} g to go) — it keeps you full and protects muscle while you lose fat.`;
    return `${cal} kcal left. Fill up on vegetables, fruit and lean protein to stay satisfied.`;
  }
  if (goal === "gain") {
    if (cal > 300) return `${cal} kcal still to eat. Add calorie-dense foods like nuts, peanut butter, whole milk, rice or an extra snack.`;
    return `Almost there — ${cal} kcal and ${Math.max(protein, 0)} g protein to go.`;
  }
  if (protein > 20) return `${cal} kcal left. Try to fit in ${protein} g more protein.`;
  return `${cal} kcal left for the day.`;
}

/** The question for "Ask Claude for meal ideas", using what's left of today's targets. */
export function mealIdeasPrompt(goal: WeightGoal, remaining: { calories: number; protein: number; carbs: number; fat: number }): string {
  const r = (n: number) => Math.max(0, Math.round(n));
  const aim = goal === "lose" ? "lose weight" : goal === "gain" ? "gain weight" : "maintain my weight";
  return (
    `I'm trying to ${aim}. For the rest of today I have about ${r(remaining.calories)} calories left, ` +
    `and I still need about ${r(remaining.protein)} g protein, ${r(remaining.carbs)} g carbs and ${r(remaining.fat)} g fat. ` +
    `Suggest 3 simple meal or snack ideas that fit, with approximate calories and protein for each.`
  );
}
