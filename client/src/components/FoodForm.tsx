import { useEffect, useState, type FormEvent } from "react";
import { api, MEALS, type FoodProduct, type FoodSource, type Meal, type Nutrition } from "../api";
import { useApp } from "../App";
import { capitalize, defaultMeal, formatAmount, parseNutritionText, quantityText, round, scale } from "../util";
import { ErrorNote } from "./ui";

export interface FoodDraft extends Nutrition {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  /** The serving size, e.g. "1 slice". */
  amount?: string | null;
  /** Servings eaten (default 1). Calories and macros above are the totals for all of them. */
  quantity?: number;
  meal?: Meal;
}

interface Props {
  draft: FoodDraft;
  source: FoodSource;
  /** When set, the user picks a portion and nutrition is calculated from the product data. */
  product?: FoodProduct;
  /** When set, the form edits this existing entry instead of adding a new one. */
  entryId?: number;
  date?: string;
  /** Show a box for pasting Claude's answer from claude.ai to fill in the numbers. */
  pasteFromClaude?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}

type Unit = "serving" | "g";

const PORTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

const toValues = (n: Nutrition): Record<keyof Nutrition, string> => ({
  calories: String(round(n.calories)),
  protein: String(round(n.protein, 1)),
  carbs: String(round(n.carbs, 1)),
  fat: String(round(n.fat, 1)),
});

const fields: { key: keyof Nutrition; label: string; unit: string }[] = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
];

export function FoodForm({ draft, source, product, entryId, date: dateOverride, pasteFromClaude, onSaved, onCancel }: Props) {
  const app = useApp();
  const date = dateOverride ?? app.date;
  const [name, setName] = useState(draft.name);
  const [meal, setMeal] = useState<Meal>(draft.meal ?? defaultMeal());
  // The serving size ("1 slice") and how many servings were eaten (3) are kept apart, so the entry can
  // be re-added later per serving. `values` are the totals for all servings; `base` is for one serving.
  const [serving, setServing] = useState(draft.amount ?? "");
  const initialQuantity = draft.quantity && draft.quantity > 0 ? draft.quantity : 1;
  const [servings, setServings] = useState(initialQuantity);
  const [servingsInput, setServingsInput] = useState(String(round(initialQuantity, 2)));
  const [pctInput, setPctInput] = useState("");
  const [values, setValues] = useState(() => toValues(draft));
  // Unrounded, so 3 slices → 1 slice → 3 slices gives back exactly the same totals.
  const [base, setBase] = useState<Nutrition>(() => ({
    calories: draft.calories / initialQuantity,
    protein: draft.protein / initialQuantity,
    carbs: draft.carbs / initialQuantity,
    fat: draft.fat / initialQuantity,
  }));
  const [unit, setUnit] = useState<Unit>(product?.perServing ? "serving" : "g");
  const [productAmount, setProductAmount] = useState(product?.perServing ? "1" : "100");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const onPaste = (text: string) => {
    const parsed = parseNutritionText(text);
    if (!parsed) {
      setPasteNote(text.trim() ? "Couldn't find the numbers in that text. Type them in below." : null);
      return;
    }
    const pick = (v: number | undefined, current: string) => (v === undefined || !Number.isFinite(v) ? Number(current) || 0 : v);
    const pasted = {
      calories: pick(parsed.calories, values.calories),
      protein: pick(parsed.protein, values.protein),
      carbs: pick(parsed.carbs, values.carbs),
      fat: pick(parsed.fat, values.fat),
    };
    setValues(toValues(pasted));
    if (parsed.amount) setServing(parsed.amount);
    // Claude's answer is for one serving; how many were eaten is chosen below.
    setBase(pasted);
    setServings(1);
    setServingsInput("1");
    setPctInput("");
    // Photo answers name the food; keep a name the user already typed.
    if (parsed.name) setName((current) => (current.trim() ? current : parsed.name!));
    setPasteNote("Filled in from Claude's answer. Check the numbers, then add it.");
  };

  // Recalculate nutrition when the portion of a looked-up product changes.
  useEffect(() => {
    if (!product) return;
    const q = Number(productAmount);
    if (!Number.isFinite(q) || q <= 0) return;
    let n: Nutrition | null = null;
    if (unit === "serving") {
      if (product.perServing) n = scale(product.perServing, q);
      else if (product.per100g && product.servingGrams) n = scale(product.per100g, (q * product.servingGrams) / 100);
      // Saved as q × one serving, so "Recent" offers a single serving next time.
      setServing(product.servingSize || "1 serving");
      setServings(q);
    } else {
      if (product.per100g) n = scale(product.per100g, q / 100);
      setServing(`${q} g`);
      setServings(1);
    }
    if (n) {
      setValues({
        calories: String(n.calories),
        protein: String(n.protein),
        carbs: String(n.carbs),
        fat: String(n.fat),
      });
    }
  }, [product, unit, productAmount]);

  const applyServings = (q: number) => {
    if (!(q > 0)) return;
    setServings(q);
    setValues(toValues(scale(base, q)));
  };

  const editValue = (key: keyof Nutrition, value: string) => {
    setValues({ ...values, [key]: value });
    // Keep the one-serving value in step so changing the number of servings scales from the corrected total.
    setBase((b) => ({ ...b, [key]: (Number(value) || 0) / servings }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const entry = {
      date,
      meal,
      name: name.trim(),
      brand: draft.brand ?? null,
      barcode: draft.barcode ?? null,
      amount: serving.trim() || null,
      quantity: servings,
      calories: Number(values.calories) || 0,
      protein: Number(values.protein) || 0,
      carbs: Number(values.carbs) || 0,
      fat: Number(values.fat) || 0,
      source,
    };
    try {
      if (entryId !== undefined) await api.updateFood(entryId, entry);
      else await api.addFood(entry);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      {product?.image && <img className="product-image" src={product.image} alt="" />}
      <label>
        Food
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {draft.brand && <p className="muted small">{draft.brand}</p>}

      {pasteFromClaude && (
        <label>
          Paste Claude's answer <span className="muted small">(optional, fills in the numbers)</span>
          <textarea rows={3} placeholder="Copy Claude's reply and paste it here…" onChange={(e) => onPaste(e.target.value)} />
          {pasteNote && <span className="muted small">{pasteNote}</span>}
        </label>
      )}

      {product && (
        <div className="row">
          <label className="grow">
            Amount
            <input type="number" inputMode="decimal" min="0" step="any" value={productAmount} onChange={(e) => setProductAmount(e.target.value)} />
          </label>
          <label className="grow">
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {(product.perServing || product.servingGrams) && (
                <option value="serving">serving{product.servingSize ? ` (${product.servingSize})` : ""}</option>
              )}
              {product.per100g && <option value="g">grams</option>}
            </select>
          </label>
        </div>
      )}
      {!product && (
        <label>
          Serving size <span className="muted small">(optional)</span>
          <input value={serving} onChange={(e) => setServing(e.target.value)} placeholder="e.g. 1 slice, 1 cup, 150 g" />
        </label>
      )}

      {!product && (
        <div className="portion">
          <span className="portion-title">
            How many servings?{" "}
            {servings !== 1 && <span className="muted small">({formatAmount(serving, servings)})</span>}
          </span>
          <div className="segmented portion-buttons" role="radiogroup" aria-label="Servings eaten">
            {PORTIONS.map((q) => (
              <button
                type="button"
                key={q}
                className={servings === q ? "selected" : ""}
                aria-pressed={servings === q}
                onClick={() => {
                  setServingsInput(String(q));
                  setPctInput("");
                  applyServings(q);
                }}
              >
                {quantityText(q)}
              </button>
            ))}
          </div>
          <div className="row portion-custom">
            <label className="row portion-field">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                aria-label="Number of servings"
                value={servingsInput}
                onChange={(e) => {
                  setServingsInput(e.target.value);
                  setPctInput("");
                  applyServings(Number(e.target.value));
                }}
              />
              <span>servings</span>
            </label>
            <span className="muted">or</span>
            <label className="row portion-field">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                aria-label="Percent of a serving"
                placeholder="60"
                value={pctInput}
                onChange={(e) => {
                  setPctInput(e.target.value);
                  const pct = Number(e.target.value);
                  if (pct > 0) {
                    setServingsInput(String(round(pct / 100, 2)));
                    applyServings(pct / 100);
                  }
                }}
              />
              <span>%</span>
            </label>
          </div>
          {serving.trim() && <span className="muted small">Calories and macros below are the total for everything you ate.</span>}
        </div>
      )}

      <div className="grid-4">
        {fields.map((f) => (
          <label key={f.key}>
            {f.label} <span className="muted small">{f.unit}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={values[f.key]}
              onChange={(e) => editValue(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="segmented" role="radiogroup" aria-label="Meal">
        {MEALS.map((m) => (
          <button type="button" key={m} className={m === meal ? "selected" : ""} onClick={() => setMeal(m)} aria-pressed={m === meal}>
            {capitalize(m)}
          </button>
        ))}
      </div>

      <ErrorNote error={error} />
      <div className="row">
        {onCancel && (
          <button type="button" className="secondary grow" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary grow" disabled={busy}>
          {busy ? "Saving…" : entryId !== undefined ? "Save changes" : "Add to log"}
        </button>
      </div>
    </form>
  );
}
