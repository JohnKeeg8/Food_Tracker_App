import { Router } from "express";

// Food data comes from Open Food Facts (https://world.openfoodfacts.org), a free, open database.
const OFF_BASE = "https://world.openfoodfacts.org";
const USER_AGENT = "FoodTrackerApp/0.1 (self-hosted; https://github.com/JohnKeeg8/food_tracker_app)";
const FIELDS = "code,product_name,brands,serving_size,serving_quantity,nutriments,image_front_small_url";

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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

type Nutriments = Record<string, number | string | undefined>;

function pick(n: Nutriments, key: string): number | undefined {
  const v = n[key];
  const num = typeof v === "string" ? Number(v) : v;
  return typeof num === "number" && Number.isFinite(num) ? num : undefined;
}

function nutritionFor(n: Nutriments, suffix: "_100g" | "_serving"): Nutrition | null {
  let calories = pick(n, `energy-kcal${suffix}`);
  if (calories === undefined) {
    const kj = pick(n, `energy-kj${suffix}`) ?? pick(n, `energy${suffix}`);
    if (kj !== undefined) calories = kj / 4.184;
  }
  const protein = pick(n, `proteins${suffix}`);
  const carbs = pick(n, `carbohydrates${suffix}`);
  const fat = pick(n, `fat${suffix}`);
  if (calories === undefined && protein === undefined && carbs === undefined && fat === undefined) return null;
  return { calories: calories ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(p: any): FoodProduct | null {
  if (!p || !p.product_name) return null;
  const n: Nutriments = p.nutriments ?? {};
  const servingGrams = Number(p.serving_quantity);
  return {
    barcode: String(p.code ?? ""),
    name: String(p.product_name),
    brand: p.brands ? String(p.brands).split(",")[0].trim() : null,
    image: p.image_front_small_url ?? null,
    servingSize: p.serving_size ?? null,
    servingGrams: Number.isFinite(servingGrams) && servingGrams > 0 ? servingGrams : null,
    per100g: nutritionFor(n, "_100g"),
    perServing: nutritionFor(n, "_serving"),
  };
}

async function offFetch(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`);
  return res.json();
}

export const lookupRouter = Router();

lookupRouter.get("/barcode/:code", async (req, res) => {
  const code = req.params.code.replace(/\D/g, "");
  if (code.length < 6 || code.length > 14) {
    res.status(400).json({ error: "That doesn't look like a valid barcode." });
    return;
  }
  try {
    const data = await offFetch(`${OFF_BASE}/api/v2/product/${code}.json?fields=${FIELDS}`);
    const product = data.status === 1 ? normalize({ code, ...data.product }) : null;
    if (!product) {
      res.status(404).json({ error: "Product not found. Try searching by name, or ask Claude." });
      return;
    }
    res.json(product);
  } catch (err) {
    console.error("Barcode lookup failed:", err);
    res.status(502).json({ error: "Couldn't reach the food database. Try again in a moment." });
  }
});

lookupRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }
  try {
    const params = new URLSearchParams({
      search_terms: q,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: "20",
      fields: FIELDS,
    });
    const data = await offFetch(`${OFF_BASE}/cgi/search.pl?${params}`);
    const products = (data.products ?? []).map(normalize).filter((p: FoodProduct | null) => p && (p.per100g || p.perServing));
    res.json(products);
  } catch (err) {
    console.error("Food search failed:", err);
    res.status(502).json({ error: "Couldn't reach the food database. Try again in a moment." });
  }
});
