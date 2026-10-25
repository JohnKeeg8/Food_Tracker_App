import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, MEALS, type Ingredient, type Meal, type Recipe, type RecipeInput } from "../api";
import { useApp } from "../App";
import { ErrorNote, MacroLine, PageHeader } from "../components/ui";
import { capitalize, defaultMeal, formatDateLabel, sum } from "../util";

type View = { kind: "list" } | { kind: "detail"; recipe: Recipe } | { kind: "edit"; recipe?: Recipe };

export function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.recipes().then(setRecipes).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (view.kind === "edit") {
    return (
      <RecipeEditor
        recipe={view.recipe}
        onSaved={(r) => {
          load();
          setView({ kind: "detail", recipe: r });
        }}
        onCancel={() => setView(view.recipe ? { kind: "detail", recipe: view.recipe } : { kind: "list" })}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <RecipeDetail
        recipe={view.recipe}
        onBack={() => setView({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", recipe: view.recipe })}
        onDeleted={() => {
          load();
          setView({ kind: "list" });
        }}
      />
    );
  }

  const shown = recipes?.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Recipes"
        right={
          <button className="primary small-button" onClick={() => setView({ kind: "edit" })}>
            + New
          </button>
        }
      />
      <ErrorNote error={error} />
      {recipes && recipes.length > 3 && (
        <input placeholder="Search your recipes" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {recipes === null && <p className="muted">Loading…</p>}
      {recipes?.length === 0 && (
        <div className="card">
          <p>Save the meals you cook so you can log a serving in one tap.</p>
          <p className="muted">Add the ingredients with their nutrition and the number of servings, and the app works out the nutrition per serving.</p>
          <button className="primary" onClick={() => setView({ kind: "edit" })}>
            Create your first recipe
          </button>
        </div>
      )}
      <ul className="list">
        {shown.map((r) => (
          <li key={r.id}>
            <button className="card list-item" onClick={() => setView({ kind: "detail", recipe: r })}>
              <span className="grow">
                <strong>{r.name}</strong>
                <span className="muted small block">
                  {r.servings} serving{r.servings === 1 ? "" : "s"} · {r.ingredients.length} ingredient
                  {r.ingredients.length === 1 ? "" : "s"}
                </span>
                <span className="small">Per serving: </span>
                <MacroLine {...r.perServing} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecipeDetail({
  recipe,
  onBack,
  onEdit,
  onDeleted,
}: {
  recipe: Recipe;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { date } = useApp();
  const navigate = useNavigate();
  const [meal, setMeal] = useState<Meal>(defaultMeal());
  const [servings, setServings] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const log = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.logRecipe(recipe.id, date, meal, Number(servings) || 1);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the recipe “${recipe.name}”?`)) return;
    await api.deleteRecipe(recipe.id);
    onDeleted();
  };

  return (
    <div className="page">
      <PageHeader title={recipe.name} />
      <div className="row">
        <button className="link-button" onClick={onBack}>
          ‹ All recipes
        </button>
      </div>

      <section className="card stack">
        <div>
          <span className="small">Per serving ({recipe.servings} total): </span>
          <MacroLine {...recipe.perServing} />
        </div>
        <h2>Log it</h2>
        <div className="row">
          <label className="grow">
            Servings
            <input type="number" inputMode="decimal" min="0" step="any" value={servings} onChange={(e) => setServings(e.target.value)} />
          </label>
          <label className="grow">
            Meal
            <select value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
              {MEALS.map((m) => (
                <option key={m} value={m}>
                  {capitalize(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorNote error={error} />
        <button className="primary" onClick={log} disabled={busy}>
          Add to {formatDateLabel(date).toLowerCase() === "today" ? "today's" : `${formatDateLabel(date)}'s`} log
        </button>
      </section>

      <section className="card">
        <h2>Ingredients</h2>
        {recipe.ingredients.length === 0 && <p className="muted">No ingredients yet.</p>}
        <ul className="list">
          {recipe.ingredients.map((i, idx) => (
            <li key={idx} className="ingredient">
              <strong>{i.name}</strong>
              {i.quantity && <span className="muted small"> · {i.quantity}</span>}
              <MacroLine {...i} />
            </li>
          ))}
        </ul>
      </section>

      {recipe.instructions.trim() && (
        <section className="card">
          <h2>Instructions</h2>
          <div className="pre-wrap">{recipe.instructions}</div>
        </section>
      )}

      <div className="row">
        <button className="secondary grow" onClick={onEdit}>
          Edit
        </button>
        <button className="danger grow" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  );
}

type IngredientDraft = Record<keyof Ingredient, string>;

const blankIngredient = (): IngredientDraft => ({ name: "", quantity: "", calories: "", protein: "", carbs: "", fat: "" });

function RecipeEditor({ recipe, onSaved, onCancel }: { recipe?: Recipe; onSaved: (r: Recipe) => void; onCancel: () => void }) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(
    recipe?.ingredients.length
      ? recipe.ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          calories: String(i.calories),
          protein: String(i.protein),
          carbs: String(i.carbs),
          fat: String(i.fat),
        }))
      : [blankIngredient()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed: Ingredient[] = ingredients
    .filter((i) => i.name.trim())
    .map((i) => ({
      name: i.name.trim(),
      quantity: i.quantity.trim(),
      calories: Number(i.calories) || 0,
      protein: Number(i.protein) || 0,
      carbs: Number(i.carbs) || 0,
      fat: Number(i.fat) || 0,
    }));
  const total = sum(parsed);
  const servingCount = Number(servings) > 0 ? Number(servings) : 1;

  const update = (idx: number, key: keyof Ingredient, value: string) =>
    setIngredients(ingredients.map((i, n) => (n === idx ? { ...i, [key]: value } : i)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const body: RecipeInput = { name: name.trim(), servings: servingCount, instructions, ingredients: parsed };
    try {
      onSaved(recipe ? await api.updateRecipe(recipe.id, body) : await api.createRecipe(body));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={recipe ? "Edit recipe" : "New recipe"} />
      <form className="stack" onSubmit={submit}>
        <section className="card stack">
          <label>
            Recipe name
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Chicken stir fry" />
          </label>
          <label>
            Number of servings it makes
            <input type="number" inputMode="decimal" min="0.1" step="any" value={servings} onChange={(e) => setServings(e.target.value)} required />
          </label>
        </section>

        <section className="card stack">
          <h2>Ingredients</h2>
          <p className="muted small">Enter nutrition for the amount used in the whole recipe. Look values up in Add food → Search, or ask Claude.</p>
          {ingredients.map((i, idx) => (
            <div key={idx} className="ingredient-editor">
              <div className="row">
                <input className="grow" placeholder="Ingredient" value={i.name} onChange={(e) => update(idx, "name", e.target.value)} />
                <input className="qty" placeholder="Amount" value={i.quantity} onChange={(e) => update(idx, "quantity", e.target.value)} />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove ingredient"
                  onClick={() => setIngredients(ingredients.filter((_, n) => n !== idx))}
                >
                  ✕
                </button>
              </div>
              <div className="grid-4">
                {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
                  <input
                    key={k}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder={k === "calories" ? "kcal" : `${capitalize(k)} g`}
                    aria-label={k}
                    value={i[k]}
                    onChange={(e) => update(idx, k, e.target.value)}
                  />
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => setIngredients([...ingredients, blankIngredient()])}>
            + Add ingredient
          </button>
          <div className="totals">
            <div>
              <span className="small">Whole recipe: </span>
              <MacroLine {...total} />
            </div>
            <div>
              <span className="small">Per serving: </span>
              <MacroLine
                calories={total.calories / servingCount}
                protein={total.protein / servingCount}
                carbs={total.carbs / servingCount}
                fat={total.fat / servingCount}
              />
            </div>
          </div>
        </section>

        <section className="card stack">
          <label>
            Instructions <span className="muted small">(optional)</span>
            <textarea rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Steps, notes, cook time…" />
          </label>
        </section>

        <ErrorNote error={error} />
        <div className="row">
          <button type="button" className="secondary grow" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary grow" disabled={busy}>
            {busy ? "Saving…" : "Save recipe"}
          </button>
        </div>
      </form>
    </div>
  );
}
