import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, MEALS, type DaySummary, type FoodEntry, type Goals, type WaterEntry } from "../api";
import { useApp } from "../App";
import { FoodForm } from "../components/FoodForm";
import { DatePicker, ErrorNote, MacroLine, PageHeader, ProgressBar } from "../components/ui";
import { capitalize, formatWater, getWaterUnit, sum, unitToMl } from "../util";

export function TodayPage() {
  const { user, date } = useApp();
  const [goals, setGoals] = useState<Goals | null>(null);
  const [food, setFood] = useState<FoodEntry[]>([]);
  const [water, setWater] = useState<WaterEntry[]>([]);
  const [history, setHistory] = useState<DaySummary[]>([]);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unit = getWaterUnit();

  const load = useCallback(() => {
    Promise.all([api.goals(), api.food(date), api.water(date), api.history(date, 7)])
      .then(([g, f, w, h]) => {
        setGoals(g);
        setFood(f);
        setWater(w);
        setHistory(h);
      })
      .catch((err) => setError(err.message));
  }, [date]);

  useEffect(load, [load]);

  const totals = sum(food);
  const waterMl = water.reduce((a, w) => a + w.amountMl, 0);

  const remove = async (id: number) => {
    if (!confirm("Remove this food from your log?")) return;
    await api.deleteFood(id).catch((err) => setError(err.message));
    load();
  };

  const quickWater = async () => {
    await api.addWater(date, unitToMl(unit === "oz" ? 8 : 250, unit)).catch((err) => setError(err.message));
    load();
  };

  if (editing) {
    return (
      <div className="page">
        <PageHeader title="Edit entry" />
        <div className="card">
          <FoodForm
            draft={editing}
            source={editing.source}
            entryId={editing.id}
            date={editing.date}
            onSaved={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      </div>
    );
  }

  // Leave headroom above the tallest bar/goal so the dashed goal line stays visible.
  const maxCal = Math.max(goals?.calories ?? 0, ...history.map((h) => h.calories), 1) * 1.15;

  return (
    <div className="page">
      <PageHeader title={`Hi, ${user.displayName}`} />
      <DatePicker />
      <ErrorNote error={error} />

      {goals && (
        <section className="card">
          <div className="calorie-summary">
            <div>
              <div className="big-number">{Math.round(totals.calories)}</div>
              <div className="muted small">eaten</div>
            </div>
            <div>
              <div className={totals.calories > goals.calories ? "big-number over-text" : "big-number"}>
                {Math.round(Math.abs(goals.calories - totals.calories))}
              </div>
              <div className="muted small">{totals.calories > goals.calories ? "over goal" : "remaining"}</div>
            </div>
            <div>
              <div className="big-number">{Math.round(goals.calories)}</div>
              <div className="muted small">goal</div>
            </div>
          </div>
          <ProgressBar value={totals.calories} max={goals.calories} color="var(--accent)" />
          <div className="macros">
            <Macro label="Protein" value={totals.protein} goal={goals.protein} color="var(--violet)" />
            <Macro label="Carbs" value={totals.carbs} goal={goals.carbs} color="var(--amber)" />
            <Macro label="Fat" value={totals.fat} goal={goals.fat} color="var(--pink)" />
          </div>
        </section>
      )}

      {goals && (
        <section className="card">
          <div className="row space-between">
            <h2>💧 Water</h2>
            <span className="muted">
              {formatWater(waterMl, unit)} / {formatWater(goals.waterMl, unit)}
            </span>
          </div>
          <ProgressBar value={waterMl} max={goals.waterMl} color="var(--sky)" overOk />
          <div className="row">
            <button className="secondary grow" onClick={quickWater}>
              + {unit === "oz" ? "8 oz" : "250 ml"} glass
            </button>
            <Link to="/water" className="button secondary grow">
              More
            </Link>
          </div>
        </section>
      )}

      {MEALS.map((meal) => {
        const items = food.filter((f) => f.meal === meal);
        const mealTotals = sum(items);
        return (
          <section className="card" key={meal}>
            <div className="row space-between">
              <h2>{capitalize(meal)}</h2>
              <span className="muted small">{Math.round(mealTotals.calories)} kcal</span>
            </div>
            {items.length > 0 && (
              <ul className="list">
                {items.map((f) => (
                  <li key={f.id} className="entry">
                    <button className="entry-main" onClick={() => setEditing(f)}>
                      <strong>{f.name}</strong>
                      {f.amount && <span className="muted small"> · {f.amount}</span>}
                      <MacroLine {...f} />
                    </button>
                    <button className="icon-button" aria-label={`Remove ${f.name}`} onClick={() => remove(f.id)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link to={`/add?meal=${meal}`} className="link-button">
              + Add {meal}
            </Link>
          </section>
        );
      })}

      {history.length > 0 && goals && (
        <section className="card">
          <h2>Last 7 days</h2>
          <div className="week-chart" role="img" aria-label="Calories eaten over the last 7 days">
            {history.map((h) => (
              <div key={h.date} className="week-bar">
                <span className="week-value">{h.calories ? Math.round(h.calories) : ""}</span>
                <div className="week-track">
                  <div
                    className={h.calories > goals.calories ? "week-fill over" : "week-fill"}
                    style={{ height: `${(h.calories / maxCal) * 100}%` }}
                  />
                  <div className="week-goal" style={{ bottom: `${(goals.calories / maxCal) * 100}%` }} />
                </div>
                <span className="week-day">
                  {new Date(`${h.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
              </div>
            ))}
          </div>
          <p className="muted small">Dashed line = your calorie goal</p>
        </section>
      )}
    </div>
  );
}

function Macro({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  return (
    <div className="macro">
      <div className="row space-between small">
        <span>{label}</span>
        <span className="muted">
          {Math.round(value)}/{Math.round(goal)}g
        </span>
      </div>
      <ProgressBar value={value} max={goal} color={color} />
    </div>
  );
}
