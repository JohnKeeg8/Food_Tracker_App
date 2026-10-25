import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../App";
import { addDays, formatDateLabel, today } from "../util";

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <div className="page-header-right">
        {right}
        <Link to="/settings" className="icon-button" aria-label="Settings">
          ⚙️
        </Link>
      </div>
    </header>
  );
}

export function DatePicker() {
  const { date, setDate } = useApp();
  return (
    <div className="date-picker">
      <button className="icon-button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
        ‹
      </button>
      <label className="date-label">
        {formatDateLabel(date)}
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      <button className="icon-button" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
        ›
      </button>
      {date !== today() && (
        <button className="link-button" onClick={() => setDate(today())}>
          Today
        </button>
      )}
    </div>
  );
}

/** `overOk` marks goals where going past the target is good (e.g. water), so it isn't shown in red. */
export function ProgressBar({ value, max, color, overOk }: { value: number; max: number; color?: string; overOk?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = !overOk && max > 0 && value > max;
  return (
    <div className="progress">
      <div
        className={over ? "progress-fill over" : "progress-fill"}
        style={{ width: `${pct}%`, background: over ? undefined : color }}
      />
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}

export function MacroLine({ calories, protein, carbs, fat }: { calories: number; protein: number; carbs: number; fat: number }) {
  return (
    <span className="macro-line">
      {Math.round(calories)} kcal · P {Math.round(protein)}g · C {Math.round(carbs)}g · F {Math.round(fat)}g
    </span>
  );
}
