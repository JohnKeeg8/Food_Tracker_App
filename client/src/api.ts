export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];

export interface User {
  id: number;
  username: string;
  displayName: string;
}

export interface AppConfig {
  claudeEnabled: boolean;
  signupEnabled: boolean;
  signupCodeRequired: boolean;
}

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Goals extends Nutrition {
  waterMl: number;
}

export type FoodSource = "manual" | "barcode" | "search" | "claude" | "recipe" | "recent";

export interface FoodEntryInput extends Nutrition {
  date: string;
  meal: Meal;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  amount?: string | null;
  source: FoodSource;
}

export interface FoodEntry extends FoodEntryInput {
  id: number;
  createdAt: string;
}

export interface WaterEntry {
  id: number;
  date: string;
  amountMl: number;
  createdAt?: string;
}

export interface FoodProduct {
  barcode: string;
  name: string;
  brand: string | null;
  image: string | null;
  servingSize: string | null;
  servingGrams: number | null;
  per100g: Nutrition | null;
  perServing: Nutrition | null;
}

export interface Ingredient extends Nutrition {
  name: string;
  quantity: string;
}

export interface RecipeInput {
  name: string;
  servings: number;
  instructions: string;
  ingredients: Ingredient[];
}

export interface Recipe extends RecipeInput {
  id: number;
  updatedAt: string;
  perServing: Nutrition;
}

export interface DaySummary extends Nutrition {
  date: string;
  waterMl: number;
}

export interface Profile {
  sex: "male" | "female";
  age: number;
  heightCm: number;
  activity: "sedentary" | "light" | "moderate" | "active" | "very-active";
  goal: "lose" | "maintain" | "gain";
  pace: "slow" | "moderate" | "fast";
  units: "imperial" | "metric";
  /** Update daily goals automatically when the profile or weight changes. */
  autoGoals: boolean;
}

export interface WeightEntry {
  id: number;
  date: string;
  weightKg: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** A photo attached to a user message (base64 JPEG). */
  image?: { data: string; mediaType: "image/jpeg" };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  config: () => request<AppConfig>("GET", "/api/config"),

  me: () => request<{ user: User | null }>("GET", "/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: User }>("POST", "/api/auth/login", { username, password }),
  register: (body: { username: string; password: string; displayName: string; signupCode?: string }) =>
    request<{ user: User }>("POST", "/api/auth/register", body),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("POST", "/api/auth/password", { currentPassword, newPassword }),

  goals: () => request<Goals>("GET", "/api/goals"),
  saveGoals: (goals: Goals) => request<Goals>("PUT", "/api/goals", goals),

  food: (date: string) => request<FoodEntry[]>("GET", `/api/food?date=${enc(date)}`),
  recentFood: () => request<FoodEntry[]>("GET", "/api/food/recent"),
  addFood: (entry: FoodEntryInput) => request<FoodEntry>("POST", "/api/food", entry),
  updateFood: (id: number, entry: FoodEntryInput) => request<FoodEntry>("PUT", `/api/food/${id}`, entry),
  deleteFood: (id: number) => request<{ ok: true }>("DELETE", `/api/food/${id}`),

  water: (date: string) => request<WaterEntry[]>("GET", `/api/water?date=${enc(date)}`),
  addWater: (date: string, amountMl: number) => request<WaterEntry>("POST", "/api/water", { date, amountMl }),
  deleteWater: (id: number) => request<{ ok: true }>("DELETE", `/api/water/${id}`),

  history: (end: string, days = 7) => request<DaySummary[]>("GET", `/api/history?end=${enc(end)}&days=${days}`),

  lookupBarcode: (code: string) => request<FoodProduct>("GET", `/api/lookup/barcode/${enc(code)}`),
  searchFood: (q: string) => request<FoodProduct[]>("GET", `/api/lookup/search?q=${enc(q)}`),

  recipes: () => request<Recipe[]>("GET", "/api/recipes"),
  createRecipe: (r: RecipeInput) => request<Recipe>("POST", "/api/recipes", r),
  updateRecipe: (id: number, r: RecipeInput) => request<Recipe>("PUT", `/api/recipes/${id}`, r),
  deleteRecipe: (id: number) => request<{ ok: true }>("DELETE", `/api/recipes/${id}`),
  logRecipe: (id: number, date: string, meal: Meal, servings: number) =>
    request<FoodEntry>("POST", `/api/recipes/${id}/log`, { date, meal, servings }),

  profile: () => request<{ profile: Profile | null }>("GET", "/api/profile"),
  saveProfile: (p: Profile) => request<{ profile: Profile }>("PUT", "/api/profile", p),
  weights: (days = 365) => request<WeightEntry[]>("GET", `/api/weights?days=${days}`),
  latestWeight: () => request<WeightEntry | null>("GET", "/api/weights/latest"),
  logWeight: (date: string, weightKg: number) => request<WeightEntry>("POST", "/api/weights", { date, weightKg }),
  deleteWeight: (id: number) => request<{ ok: true }>("DELETE", `/api/weights/${id}`),

  chat: (messages: ChatMessage[]) => request<{ text: string }>("POST", "/api/chat", { messages }),
};
