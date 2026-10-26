import { useEffect, useState, type FormEvent } from "react";
import { api, MEALS, type FoodProduct, type FoodSource, type Meal, type Nutrition } from "../api";
import { useApp } from "../App";
import { capitalize, defaultMeal, parseNutritionText, round, scale } from "../util";
import { ErrorNote } from "./ui";

export interface FoodDraft extends Nutrition {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  amount?: string | null;
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

const PORTIONS: { value: number; label: string }[] = [
  { value: 0.25, label: "¼" },
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
  { value: 1, label: "All" },
  { value: 1.5, label: "1½" },
  { value: 2, label: "2×" },
];

const fractionText = (p: number) =>
  ({ 0.25: "¼", 0.5: "½", 0.75: "¾", 1.5: "1½", 2: "2" } as Record<number, string>)[p] ?? `${round(p * 100)}%`;

/** Describes a portion of the original amount, e.g. "½ of 1 plate" or "1½ × 1 bowl". */
function portionAmount(baseAmount: string, p: number): string {
  if (p === 1) return baseAmount;
  const text = fractionText(p);
  if (baseAmount) return p < 1 ? `${text} of ${baseAmount}` : `${text} × ${baseAmount}`;
  return p < 1 ? `${text} portion` : `${text} portions`;
}

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
  const [amount, setAmount] = useState(draft.amount ?? "");
  const [values, setValues] = useState(() => toValues(draft));
  // "How much did you eat?": nutrition and amount for the full portion, scaled by `portion`.
  const [base, setBase] = useState<{ nutrition: Nutrition; amount: string }>({
    nutrition: { calories: draft.calories, protein: draft.protein, carbs: draft.carbs, fat: draft.fat },
    amount: draft.amount ?? "",
  });
  const [portion, setPortion] = useState(1);
  const [customPct, setCustomPct] = useState("");
  const [unit, setUnit] = useState<Unit>(product?.perServing ? "serving" : "g");
  const [quantity, setQuantity] = useState(product?.perServing ? "1" : "100");
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
    if (parsed.amount) setAmount(parsed.amount);
    // Claude's answer is for the whole serving; start portion scaling from there.
    setBase({ nutrition: pasted, amount: parsed.amount ?? amount });
    setPortion(1);
    setCustomPct("");
    // Photo answers name the food; keep a name the user already typed.
    if (parsed.name) setName((current) => (current.trim() ? current : parsed.name!));
    setPasteNote("Filled in from Claude's answer. Check the numbers, then add it.");
  };

  // Recalculate nutrition when the portion of a looked-up product changes.
  useEffect(() => {
    if (!product) return;
    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) return;
    let n: Nutrition | null = null;
    if (unit === "serving") {
      if (product.perServing) n = scale(product.perServing, q);
      else if (product.per100g && product.servingGrams) n = scale(product.per100g, (q * product.servingGrams) / 100);
      setAmount(`${q} serving${q === 1 ? "" : "s"}${product.servingSize ? ` (${product.servingSize})` : ""}`);
    } else {
      if (product.per100g) n = scale(product.per100g, q / 100);
      setAmount(`${q} g`);
    }
    if (n) {
      setValues({
        calories: String(n.calories),
        protein: String(n.protein),
        carbs: String(n.carbs),
        fat: String(n.fat),
      });
    }
  }, [product, unit, quantity]);

  const applyPortion = (p: number) => {
    if (!(p > 0)) return;
    setPortion(p);
    setValues(toValues(scale(base.nutrition, p)));
    setAmount(portionAmount(base.amount, p));
  };

  const editValue = (key: keyof Nutrition, value: string) => {
    setValues({ ...values, [key]: value });
    // Keep the full-portion value in step so changing the portion later scales from the corrected number.
    setBase((b) => ({ ...b, nutrition: { ...b.nutrition, [key]: (Number(value) || 0) / portion } }));
  };

  const editAmount = (value: string) => {
    setAmount(value);
    if (portion === 1) setBase((b) => ({ ...b, amount: value }));
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
      amount: amount.trim() || null,
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
            <input type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
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
          Amount / serving <span className="muted small">(optional)</span>
          <input value={amount} onChange={(e) => editAmount(e.target.value)} placeholder="e.g. 1 cup, 2 slices, 150 g" />
        </label>
      )}

      {!product && (
        <div className="portion">
          <span className="portion-title">
            How much did you eat?{" "}
            {portion !== 1 && <span className="muted small">({round(portion * 100)}% of the original)</span>}
          </span>
          <div className="segmented portion-buttons" role="radiogroup" aria-label="Portion eaten">
            {PORTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                className={portion === opt.value ? "selected" : ""}
                aria-pressed={portion === opt.value}
                onClick={() => {
                  setCustomPct("");
                  applyPortion(opt.value);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="row portion-custom">
            <span>Or enter</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              step="any"
              placeholder="e.g. 60"
              value={customPct}
              onChange={(e) => {
                setCustomPct(e.target.value);
                const pct = Number(e.target.value);
                if (pct > 0) applyPortion(pct / 100);
              }}
            />
            <span>%</span>
          </label>
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
