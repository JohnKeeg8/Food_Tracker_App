import { useEffect, useState, type FormEvent } from "react";
import { api, type Goals } from "../api";
import { useApp } from "../App";
import { ErrorNote, PageHeader } from "../components/ui";
import { getWaterUnit, mlToUnit, setWaterUnit, unitToMl, type WaterUnit } from "../util";

export function SettingsPage() {
  const { user, signOut } = useApp();
  const [goals, setGoals] = useState<Record<keyof Goals, string> | null>(null);
  const [unit, setUnit] = useState<WaterUnit>(getWaterUnit());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    api
      .goals()
      .then((g) =>
        setGoals({
          calories: String(g.calories),
          protein: String(g.protein),
          carbs: String(g.carbs),
          fat: String(g.fat),
          waterMl: String(mlToUnit(g.waterMl, getWaterUnit())),
        }),
      )
      .catch((err) => setError(err.message));
  }, []);

  const changeUnit = (next: WaterUnit) => {
    if (goals) setGoals({ ...goals, waterMl: String(mlToUnit(unitToMl(Number(goals.waterMl) || 0, unit), next)) });
    setUnit(next);
  };

  const saveGoals = async (e: FormEvent) => {
    e.preventDefault();
    if (!goals) return;
    setError(null);
    setSaved(false);
    try {
      await api.saveGoals({
        calories: Number(goals.calories) || 0,
        protein: Number(goals.protein) || 0,
        carbs: Number(goals.carbs) || 0,
        fat: Number(goals.fat) || 0,
        waterMl: Math.round(unitToMl(Number(goals.waterMl) || 0, unit)),
      });
      setWaterUnit(unit);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwMessage(null);
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "" });
      setPwMessage("Password changed.");
    } catch (err) {
      setPwError((err as Error).message);
    }
  };

  const goalField = (key: keyof Goals, label: string, suffix: string) =>
    goals && (
      <label>
        {label} <span className="muted small">{suffix}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={goals[key]}
          onChange={(e) => {
            setGoals({ ...goals, [key]: e.target.value });
            setSaved(false);
          }}
        />
      </label>
    );

  return (
    <div className="page">
      <PageHeader title="Settings" />
      <section className="card">
        <p>
          Signed in as <strong>{user.displayName}</strong> <span className="muted">(@{user.username})</span>
        </p>
        <p className="muted small">Your log, recipes and goals are private to your account.</p>
      </section>

      <form className="card stack" onSubmit={saveGoals}>
        <h2>Daily goals</h2>
        {!goals && <p className="muted">Loading…</p>}
        {goalField("calories", "Calories", "kcal")}
        <div className="grid-3">
          {goalField("protein", "Protein", "g")}
          {goalField("carbs", "Carbs", "g")}
          {goalField("fat", "Fat", "g")}
        </div>
        <div className="row">
          <div className="grow">{goalField("waterMl", "Water", unit)}</div>
          <label>
            Water unit
            <select value={unit} onChange={(e) => changeUnit(e.target.value as WaterUnit)}>
              <option value="oz">oz</option>
              <option value="ml">ml</option>
            </select>
          </label>
        </div>
        <ErrorNote error={error} />
        {saved && <p className="success">Saved.</p>}
        <button className="primary">Save goals</button>
      </form>

      <form className="card stack" onSubmit={changePassword}>
        <h2>Change password</h2>
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        </label>
        <label>
          New password
          <input type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        </label>
        <ErrorNote error={pwError} />
        {pwMessage && <p className="success">{pwMessage}</p>}
        <button className="secondary">Change password</button>
      </form>

      <button className="danger" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}
