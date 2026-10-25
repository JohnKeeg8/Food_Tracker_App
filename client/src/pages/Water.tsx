import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type DaySummary, type Goals, type WaterEntry } from "../api";
import { useApp } from "../App";
import { DatePicker, ErrorNote, PageHeader, ProgressBar } from "../components/ui";
import { formatWater, getWaterUnit, mlToUnit, unitToMl } from "../util";

const QUICK = { oz: [8, 12, 16, 24], ml: [250, 330, 500, 750] };

export function WaterPage() {
  const { date } = useApp();
  const unit = getWaterUnit();
  const [goals, setGoals] = useState<Goals | null>(null);
  const [entries, setEntries] = useState<WaterEntry[]>([]);
  const [history, setHistory] = useState<DaySummary[]>([]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.goals(), api.water(date), api.history(date, 7)])
      .then(([g, w, h]) => {
        setGoals(g);
        setEntries(w);
        setHistory(h);
      })
      .catch((err) => setError(err.message));
  }, [date]);
  useEffect(load, [load]);

  const add = async (amount: number) => {
    if (!(amount > 0)) return;
    setError(null);
    try {
      await api.addWater(date, unitToMl(amount, unit));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitCustom = (e: FormEvent) => {
    e.preventDefault();
    add(Number(custom));
    setCustom("");
  };

  const remove = async (id: number) => {
    await api.deleteWater(id).catch((err) => setError(err.message));
    load();
  };

  const total = entries.reduce((a, w) => a + w.amountMl, 0);
  const goal = goals?.waterMl ?? 0;
  const pct = goal ? Math.round((total / goal) * 100) : 0;

  return (
    <div className="page">
      <PageHeader title="Water" />
      <DatePicker />
      <ErrorNote error={error} />

      <section className="card water-hero">
        <div className="water-glass" aria-hidden>
          <div className="water-level" style={{ height: `${Math.min(pct, 100)}%` }} />
        </div>
        <div>
          <div className="big-number">{formatWater(total, unit)}</div>
          <div className="muted">
            of {formatWater(goal, unit)} goal · {pct}%
          </div>
          {total >= goal && goal > 0 && <div className="success-text">Goal reached! 🎉</div>}
        </div>
      </section>

      <section className="card stack">
        <h2>Add water</h2>
        <div className="grid-4">
          {QUICK[unit].map((q) => (
            <button key={q} className="secondary" onClick={() => add(q)}>
              +{q} {unit}
            </button>
          ))}
        </div>
        <form className="row" onSubmit={submitCustom}>
          <input
            className="grow"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            placeholder={`Custom amount (${unit})`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button className="primary">Add</button>
        </form>
      </section>

      {entries.length > 0 && (
        <section className="card">
          <h2>Logged</h2>
          <ul className="list">
            {entries.map((w) => (
              <li key={w.id} className="entry">
                <span className="entry-main">
                  {formatWater(w.amountMl, unit)}
                  {w.createdAt && (
                    <span className="muted small">
                      {" "}
                      · {new Date(`${w.createdAt.replace(" ", "T")}Z`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                </span>
                <button className="icon-button" aria-label="Remove" onClick={() => remove(w.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && goal > 0 && (
        <section className="card">
          <h2>Last 7 days</h2>
          {history.map((h) => (
            <div key={h.date} className="history-row">
              <span className="history-day">
                {new Date(`${h.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <div className="grow">
                <ProgressBar value={h.waterMl} max={goal} color="var(--sky)" overOk />
              </div>
              <span className="muted small history-value">
                {mlToUnit(h.waterMl, unit)} {unit}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
