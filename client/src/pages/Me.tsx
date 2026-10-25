import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Goals, type Profile, type WeightEntry } from "../api";
import { ErrorNote, PageHeader } from "../components/ui";
import {
  ACTIVITY_LEVELS,
  GOAL_TEXT,
  bmiCategory,
  calculatePlan,
  cmToFtIn,
  formatHeight,
  formatWeight,
  ftInToCm,
  kgToLb,
  lbToKg,
  paceLabel,
  planToGoals,
  type Pace,
  type Units,
  type WeightGoal,
} from "../health";
import { formatWater, getWaterUnit, today } from "../util";

const defaultProfile: Profile = {
  sex: "male",
  age: 30,
  heightCm: 175,
  activity: "light",
  goal: "maintain",
  pace: "moderate",
  units: "imperial",
  autoGoals: true,
};

/** Keeps saved daily goals in step with the profile when the user opted in. */
async function syncGoals(profile: Profile, weightKg: number) {
  if (!profile.autoGoals) return;
  await api.saveGoals(planToGoals(calculatePlan(profile, weightKg)));
}

export function MePage() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [goals, setGoals] = useState<Goals | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.profile(), api.weights(365), api.goals()])
      .then(([p, w, g]) => {
        setProfile(p.profile);
        setWeights(w);
        setGoals(g);
      })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (profile === undefined) {
    return (
      <div className="page">
        <PageHeader title="Me" />
        <ErrorNote error={error} />
        {!error && <p className="muted">Loading…</p>}
      </div>
    );
  }

  const latest = weights[weights.length - 1];

  if (!profile || !latest || editing) {
    return (
      <div className="page">
        <PageHeader title={profile ? "Edit my details" : "Set up your plan"} />
        {!profile && (
          <p className="muted">
            Tell us a bit about yourself and your goal. We'll work out how much to eat each day to lose, maintain or gain
            weight.
          </p>
        )}
        <ProfileForm
          initial={profile ?? defaultProfile}
          initialWeightKg={latest?.weightKg}
          onCancel={profile && latest ? () => setEditing(false) : undefined}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      </div>
    );
  }

  const plan = calculatePlan(profile, latest.weightKg);
  const goalsMatch =
    goals !== null &&
    Math.round(goals.calories) === plan.calories &&
    Math.round(goals.protein) === plan.protein &&
    Math.round(goals.waterMl) === plan.waterMl;

  const applyPlan = async () => {
    setError(null);
    try {
      setGoals(await api.saveGoals(planToGoals(plan)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Me"
        right={
          <button className="link-button" onClick={() => setEditing(true)}>
            Edit details
          </button>
        }
      />
      <ErrorNote error={error} />

      <section className="card stack">
        <div className="row space-between">
          <h2>🎯 {GOAL_TEXT[profile.goal]}</h2>
          {profile.goal !== "maintain" && <span className="muted small">{paceLabel(profile.goal, profile.pace, profile.units)}</span>}
        </div>
        <div className="plan-calories">
          <div className="big-number">{plan.calories.toLocaleString()}</div>
          <div className="muted small">calories a day</div>
        </div>
        <div className="grid-4 plan-grid">
          <Stat label="Protein" value={`${plan.protein} g`} />
          <Stat label="Carbs" value={`${plan.carbs} g`} />
          <Stat label="Fat" value={`${plan.fat} g`} />
          <Stat label="Water" value={formatWater(plan.waterMl, getWaterUnit())} />
        </div>
        <p className="muted small">
          Your body burns about <strong>{plan.maintenance.toLocaleString()} kcal</strong> a day at your activity level
          {profile.goal === "lose" && `, so eating ${(plan.maintenance - plan.calories).toLocaleString()} less creates a steady deficit`}
          {profile.goal === "gain" && `, so eating ${(plan.calories - plan.maintenance).toLocaleString()} more supports gaining`}
          . BMI {plan.bmi} ({bmiCategory(plan.bmi)}).
        </p>
        {plan.warnings.map((w) => (
          <p key={w} className="note">
            ⚠️ {w}
          </p>
        ))}
        {goalsMatch ? (
          <p className="success">
            {profile.autoGoals ? "Your daily goals follow this plan and update when your weight changes." : "Your daily goals match this plan."}
          </p>
        ) : (
          <button className="primary" onClick={applyPlan}>
            Use these as my daily goals
          </button>
        )}
        <p className="muted small">
          These are estimates from a standard formula (Mifflin–St Jeor). Adjust based on how your weight actually changes
          over a few weeks, and check with a doctor if you have a health condition.
        </p>
      </section>

      <WeightSection profile={profile} weights={weights} onChanged={load} />

      <section className="card">
        <h2>About you</h2>
        <div className="grid-3">
          <Stat label="Age" value={String(profile.age)} />
          <Stat label="Height" value={formatHeight(profile.heightCm, profile.units)} />
          <Stat label="Weight" value={formatWeight(latest.weightKg, profile.units)} />
        </div>
        <p className="muted small">
          {profile.sex === "male" ? "Male" : "Female"} · {ACTIVITY_LEVELS.find((a) => a.value === profile.activity)?.label}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

function WeightSection({ profile, weights, onChanged }: { profile: Profile; weights: WeightEntry[]; onChanged: () => void }) {
  const units = profile.units;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!(n > 0)) return;
    const kg = units === "imperial" ? lbToKg(n) : n;
    setError(null);
    try {
      await api.logWeight(today(), kg);
      await syncGoals(profile, kg);
      setValue("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: number) => {
    if (weights.length <= 1) {
      setError("Keep at least one weight entry — it's used to work out your plan.");
      return;
    }
    if (!confirm("Delete this weight entry?")) return;
    await api.deleteWeight(id).catch((err) => setError(err.message));
    onChanged();
  };

  const first = weights[0];
  const last = weights[weights.length - 1];
  const change = first && last ? last.weightKg - first.weightKg : 0;
  const shown = showAll ? [...weights].reverse() : [...weights].reverse().slice(0, 5);

  return (
    <section className="card stack">
      <h2>⚖️ Weight</h2>
      <form className="row" onSubmit={save}>
        <input
          className="grow"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          placeholder={`Today's weight (${units === "imperial" ? "lb" : "kg"})`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="primary">Log</button>
      </form>
      <ErrorNote error={error} />

      {weights.length >= 2 && (
        <>
          <WeightChart weights={weights} units={units} />
          <p className="small">
            {change === 0 ? "No change" : `${change < 0 ? "Down" : "Up"} ${formatWeight(Math.abs(change), units)}`} since{" "}
            {new Date(`${first.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        </>
      )}

      <ul className="list">
        {shown.map((w) => (
          <li key={w.id} className="entry">
            <span className="entry-main">
              {formatWeight(w.weightKg, units)}
              <span className="muted small">
                {" "}
                · {new Date(`${w.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
            </span>
            <button className="icon-button" aria-label="Delete weight entry" onClick={() => remove(w.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {weights.length > 5 && (
        <button className="link-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show less" : `Show all ${weights.length}`}
        </button>
      )}
      <p className="muted small">Weigh in at the same time of day (e.g. mornings) — the trend over weeks matters more than any single day.</p>
    </section>
  );
}

function WeightChart({ weights, units }: { weights: WeightEntry[]; units: Units }) {
  const W = 300;
  const H = 110;
  const pad = 8;
  const values = weights.map((w) => (units === "imperial" ? kgToLb(w.weightKg) : w.weightKg));
  const times = weights.map((w) => new Date(`${w.date}T12:00:00`).getTime());
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const spanV = Math.max(maxV - minV, 1);
  const t0 = times[0];
  const spanT = Math.max(times[times.length - 1] - t0, 1);
  const x = (t: number) => pad + ((t - t0) / spanT) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - minV) / spanV) * (H - pad * 2);
  const points = values.map((v, i) => `${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const unit = units === "imperial" ? "lb" : "kg";
  return (
    <div className="weight-chart">
      <div className="weight-chart-labels muted small">
        <span>
          {Math.round(maxV * 10) / 10} {unit}
        </span>
        <span>
          {Math.round(minV * 10) / 10} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Weight over time">
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => (
          <circle key={i} cx={x(times[i])} cy={y(v)} r="3" fill="var(--accent)" />
        ))}
      </svg>
    </div>
  );
}

function ProfileForm({
  initial,
  initialWeightKg,
  onSaved,
  onCancel,
}: {
  initial: Profile;
  initialWeightKg?: number;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [p, setP] = useState<Profile>(initial);
  const { ft, inches } = cmToFtIn(initial.heightCm);
  const [heightFt, setHeightFt] = useState(String(ft));
  const [heightIn, setHeightIn] = useState(String(inches));
  const [heightCm, setHeightCm] = useState(String(Math.round(initial.heightCm)));
  const toDisplayWeight = (kg: number | undefined, units: Units) =>
    kg === undefined ? "" : String(Math.round((units === "imperial" ? kgToLb(kg) : kg) * 10) / 10);
  const [weight, setWeight] = useState(toDisplayWeight(initialWeightKg, initial.units));
  const [age, setAge] = useState(String(initial.age));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setP((prev) => ({ ...prev, [key]: value }));

  const currentHeightCm = () =>
    p.units === "imperial" ? ftInToCm(Number(heightFt) || 0, Number(heightIn) || 0) : Number(heightCm) || 0;
  const currentWeightKg = () => {
    const n = Number(weight);
    if (!(n > 0)) return undefined;
    return p.units === "imperial" ? lbToKg(n) : n;
  };

  const switchUnits = (units: Units) => {
    if (units === p.units) return;
    const cm = currentHeightCm();
    const kg = currentWeightKg();
    const fi = cmToFtIn(cm);
    setHeightFt(String(fi.ft));
    setHeightIn(String(fi.inches));
    setHeightCm(String(Math.round(cm)));
    setWeight(toDisplayWeight(kg, units));
    set("units", units);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const kg = currentWeightKg();
    if (kg === undefined) {
      setError("Enter your current weight.");
      return;
    }
    const profile: Profile = { ...p, age: Number(age), heightCm: Math.round(currentHeightCm() * 10) / 10 };
    setError(null);
    setBusy(true);
    try {
      await api.saveProfile(profile);
      if (initialWeightKg === undefined || Math.abs(kg - initialWeightKg) > 0.01) await api.logWeight(today(), kg);
      await syncGoals(profile, kg);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const goalOptions: WeightGoal[] = ["lose", "maintain", "gain"];
  const paceOptions: Pace[] = ["slow", "moderate", "fast"];

  return (
    <form className="stack" onSubmit={submit}>
      <section className="card stack">
        <h2>My goal</h2>
        <div className="segmented">
          {goalOptions.map((g) => (
            <button type="button" key={g} className={p.goal === g ? "selected" : ""} onClick={() => set("goal", g)}>
              {g === "lose" ? "Lose" : g === "maintain" ? "Maintain" : "Gain"}
            </button>
          ))}
        </div>
        {p.goal !== "maintain" && (
          <label>
            How fast?
            <select value={p.pace} onChange={(e) => set("pace", e.target.value as Pace)}>
              {paceOptions.map((pace) => (
                <option key={pace} value={pace}>
                  {paceLabel(p.goal, pace, p.units)}
                  {pace === "moderate" ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card stack">
        <div className="row space-between">
          <h2>About you</h2>
          <div className="segmented compact">
            <button type="button" className={p.units === "imperial" ? "selected" : ""} onClick={() => switchUnits("imperial")}>
              lb / ft
            </button>
            <button type="button" className={p.units === "metric" ? "selected" : ""} onClick={() => switchUnits("metric")}>
              kg / cm
            </button>
          </div>
        </div>
        <div className="row">
          <label className="grow">
            Sex <span className="muted small">(for the calorie formula)</span>
            <select value={p.sex} onChange={(e) => set("sex", e.target.value as Profile["sex"])}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          <label className="age-field">
            Age
            <input type="number" inputMode="numeric" min="13" max="120" value={age} onChange={(e) => setAge(e.target.value)} required />
          </label>
        </div>
        {p.units === "imperial" ? (
          <div className="row">
            <label className="grow">
              Height (ft)
              <input type="number" inputMode="numeric" min="3" max="8" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} required />
            </label>
            <label className="grow">
              (in)
              <input type="number" inputMode="numeric" min="0" max="11" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} required />
            </label>
          </div>
        ) : (
          <label>
            Height (cm)
            <input type="number" inputMode="numeric" min="90" max="250" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} required />
          </label>
        )}
        <label>
          Current weight ({p.units === "imperial" ? "lb" : "kg"})
          <input type="number" inputMode="decimal" step="0.1" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} required />
        </label>
        <label>
          Activity level
          <select value={p.activity} onChange={(e) => set("activity", e.target.value as Profile["activity"])}>
            {ACTIVITY_LEVELS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label} — {a.detail}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={p.autoGoals} onChange={(e) => set("autoGoals", e.target.checked)} />
          Set my daily calorie, macro and water goals from this plan, and update them when my weight changes
        </label>
      </section>

      <ErrorNote error={error} />
      <div className="row">
        {onCancel && (
          <button type="button" className="secondary grow" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary grow" disabled={busy}>
          {busy ? "Saving…" : "Save and see my plan"}
        </button>
      </div>
    </form>
  );
}
