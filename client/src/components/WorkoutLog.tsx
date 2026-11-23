import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Workout, type WorkoutDrop, type WorkoutExercise, type WorkoutInput, type WorkoutSet } from "../api";
import { EXERCISES, ROUTINES, exerciseById, isTimed, prescribedSets, videoUrl, type Routine } from "../data/workouts";
import { kgToLb, lbToKg, type Units } from "../health";
import { formatDateLabel, today } from "../util";
import { ErrorNote } from "./ui";

// ---- Units and formatting ----

const round1 = (n: number) => Math.round(n * 10) / 10;
const unitLabel = (units: Units) => (units === "imperial" ? "lb" : "kg");
const toDisplay = (kg: number, units: Units) => round1(units === "imperial" ? kgToLb(kg) : kg);
const toKg = (value: number, units: Units) => (units === "imperial" ? lbToKg(value) : value);

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}:${String(s).padStart(2, "0")} min` : `${m} min`;
}

function formatLift(s: { weightKg: number | null; reps: number | null }, units: Units): string {
  if (s.weightKg != null) return `${toDisplay(s.weightKg, units)}×${s.reps ?? "?"}`;
  return `${s.reps ?? 0} reps`;
}

/** e.g. "135×8", or with drops "135×8 → 95×5 → 65×4". */
function formatSet(s: WorkoutSet, units: Units): string {
  if (s.seconds != null && s.reps == null && s.weightKg == null) return formatDuration(s.seconds);
  return [s, ...(s.drops ?? [])].map((part) => formatLift(part, units)).join(" → ");
}

/** e.g. "3×8 @ 135 lb", "135×8, 135×8, 140×6 → 95×5 lb", "3×12 reps" or "20 min". */
export function summarizeSets(sets: WorkoutSet[], units: Units): string {
  if (sets.length === 0) return "";
  const texts = sets.map((s) => formatSet(s, units));
  const weighted = sets.some((s) => s.weightKg != null || (s.drops ?? []).some((d) => d.weightKg != null));
  const hasDrops = sets.some((s) => (s.drops ?? []).length > 0);
  if (sets.length > 1 && !hasDrops && texts.every((t) => t === texts[0])) {
    const s = sets[0];
    if (s.weightKg != null) return `${sets.length}×${s.reps ?? "?"} @ ${toDisplay(s.weightKg, units)} ${unitLabel(units)}`;
    if (s.reps != null) return `${sets.length}×${s.reps} reps`;
    return `${sets.length} × ${texts[0]}`;
  }
  return texts.join(", ") + (weighted ? ` ${unitLabel(units)}` : "");
}

function workoutSummary(w: Workout, units: Units): string {
  const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
  const lifted = (s: { weightKg: number | null; reps: number | null }) => (s.weightKg ?? 0) * (s.reps ?? 0);
  const volumeKg = w.exercises.reduce(
    (v, e) => v + e.sets.reduce((a, s) => a + lifted(s) + (s.drops ?? []).reduce((b, d) => b + lifted(d), 0), 0),
    0,
  );
  const parts = [`${w.exercises.length} exercise${w.exercises.length === 1 ? "" : "s"}`, `${sets} set${sets === 1 ? "" : "s"}`];
  if (volumeKg > 0) parts.push(`${Math.round(units === "imperial" ? kgToLb(volumeKg) : volumeKg).toLocaleString()} ${unitLabel(units)} lifted`);
  return parts.join(" · ");
}

const sameExercise = (a: { exerciseId: string | null; name: string }, b: { exerciseId: string | null; name: string }) =>
  (a.exerciseId != null && a.exerciseId === b.exerciseId) || a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/** The most recent logged sets for an exercise (workouts are newest first). */
function lastPerformance(workouts: Workout[], ex: { exerciseId: string | null; name: string }, excludeId?: number) {
  for (const w of workouts) {
    if (w.id === excludeId) continue;
    const match = w.exercises.find((e) => sameExercise(e, ex) && e.sets.length > 0);
    if (match) return { date: w.date, sets: match.sets };
  }
  return null;
}

// ---- Draft (the workout being entered; kept as text so half-typed numbers survive) ----

export interface DraftDrop {
  weight: string;
  reps: string;
}

export interface DraftSet {
  weight: string;
  reps: string;
  minutes: string;
  seconds: string;
  /** Drop sets after this set. Optional because workouts in progress from before drops existed don't have it. */
  drops?: DraftDrop[];
}

export interface DraftExercise {
  key: string;
  exerciseId: string | null;
  name: string;
  /** Logged by time instead of weight and reps. */
  timed: boolean;
  sets: DraftSet[];
}

export interface WorkoutDraft {
  /** Set when editing a saved workout. */
  id?: number;
  date: string;
  name: string;
  notes: string;
  exercises: DraftExercise[];
}

const blankSet = (): DraftSet => ({ weight: "", reps: "", minutes: "", seconds: "", drops: [] });
const blankDrop = (): DraftDrop => ({ weight: "", reps: "" });
const newKey = () => Math.random().toString(36).slice(2);

/**
 * A new exercise with empty sets. With `template` (sets from last time), each set also gets as many empty
 * drop rows as it had then, so last time's drop numbers show as hints.
 */
function draftExercise(
  exerciseId: string | null,
  name: string,
  setCount: number,
  timed = isTimed(exerciseId),
  template?: WorkoutSet[],
): DraftExercise {
  const sets = Array.from({ length: Math.max(1, setCount) }, (_, i) => ({
    ...blankSet(),
    drops: timed ? [] : (template?.[i]?.drops ?? []).map(blankDrop),
  }));
  return { key: newKey(), exerciseId, name, timed, sets };
}

export function emptyDraft(): WorkoutDraft {
  return { date: today(), name: "", notes: "", exercises: [] };
}

export function draftFromRoutine(routine: Routine): WorkoutDraft {
  return {
    date: today(),
    name: routine.name,
    notes: "",
    exercises: routine.items.flatMap((item) => {
      const ex = exerciseById.get(item.id);
      return ex ? [draftExercise(ex.id, ex.name, prescribedSets(item.prescription))] : [];
    }),
  };
}

const isTimedSets = (e: WorkoutExercise) =>
  isTimed(e.exerciseId) || (e.sets.length > 0 && e.sets.every((s) => s.seconds != null && s.reps == null && s.weightKg == null));

/** A fresh workout with the same exercises and number of sets as an earlier one. */
export function draftRepeating(w: Workout): WorkoutDraft {
  return {
    date: today(),
    name: w.name,
    notes: "",
    exercises: w.exercises.map((e) => draftExercise(e.exerciseId, e.name, e.sets.length, isTimedSets(e), e.sets)),
  };
}

export function draftEditing(w: Workout, units: Units): WorkoutDraft {
  return {
    id: w.id,
    date: w.date,
    name: w.name,
    notes: w.notes,
    exercises: w.exercises.map((e) => ({
      key: newKey(),
      exerciseId: e.exerciseId,
      name: e.name,
      timed: isTimedSets(e),
      sets: e.sets.map((s) => ({
        weight: s.weightKg == null ? "" : String(toDisplay(s.weightKg, units)),
        reps: s.reps == null ? "" : String(s.reps),
        minutes: s.seconds == null ? "" : String(Math.floor(s.seconds / 60)),
        seconds: s.seconds == null || s.seconds % 60 === 0 ? "" : String(s.seconds % 60),
        drops: (s.drops ?? []).map((d) => ({
          weight: d.weightKg == null ? "" : String(toDisplay(d.weightKg, units)),
          reps: d.reps == null ? "" : String(d.reps),
        })),
      })),
    })),
  };
}

/** Converts the draft for saving, dropping sets and exercises that were left blank. */
function draftToInput(draft: WorkoutDraft, units: Units): WorkoutInput {
  const exercises = draft.exercises
    .map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name.trim(),
      sets: e.sets.flatMap((s): WorkoutSet[] => {
        if (e.timed) {
          const total = Math.round((Number(s.minutes) || 0) * 60 + (Number(s.seconds) || 0));
          return total > 0 ? [{ weightKg: null, reps: null, seconds: total, drops: [] }] : [];
        }
        const lift = (weightText: string, repsText: string) => {
          const weight = Number(weightText);
          const reps = Number(repsText);
          return {
            weightKg: weightText.trim() === "" || !(weight >= 0) ? null : toKg(weight, units),
            reps: repsText.trim() === "" || !(reps >= 0) ? null : Math.round(reps),
          };
        };
        const drops: WorkoutDrop[] = (s.drops ?? [])
          .filter((d) => d.weight.trim() !== "" || d.reps.trim() !== "")
          .map((d) => lift(d.weight, d.reps));
        if (s.weight.trim() === "" && s.reps.trim() === "" && drops.length === 0) return [];
        return [{ ...lift(s.weight, s.reps), seconds: null, drops }];
      }),
    }))
    .filter((e) => e.name && e.sets.length > 0);
  return { date: draft.date, name: draft.name.trim() || "Workout", notes: draft.notes.trim(), exercises };
}

// ---- Log: start a workout, history and personal bests ----

interface LogProps {
  workouts: Workout[];
  units: Units;
  onStart: (draft: WorkoutDraft) => void;
  onChanged: () => void;
}

export function WorkoutLog({ workouts, units, onStart, onChanged }: LogProps) {
  const [open, setOpen] = useState<number | null>(null);
  const [showAllBests, setShowAllBests] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One entry per workout name, newest first, for "repeat a recent workout".
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return workouts.filter((w) => !seen.has(w.name.toLowerCase()) && seen.add(w.name.toLowerCase())).slice(0, 8);
  }, [workouts]);

  const bests = useMemo(() => {
    const byExercise = new Map<string, { name: string; weightKg: number; reps: number | null; date: string; lastDate: string }>();
    // Oldest first, so a later equal lift doesn't replace the date a best was first set.
    for (const w of [...workouts].reverse()) {
      for (const e of w.exercises) {
        const key = e.exerciseId ?? e.name.trim().toLowerCase();
        for (const s of e.sets) {
          if (s.weightKg == null || s.weightKg <= 0 || !s.reps) continue;
          const best = byExercise.get(key);
          if (!best || s.weightKg > best.weightKg || (s.weightKg === best.weightKg && s.reps > (best.reps ?? 0))) {
            byExercise.set(key, { name: e.name, weightKg: s.weightKg, reps: s.reps, date: w.date, lastDate: w.date });
          } else {
            best.lastDate = w.date;
          }
        }
      }
    }
    return [...byExercise.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [workouts]);

  const startFrom = (value: string) => {
    if (value.startsWith("routine:")) {
      const routine = ROUTINES.find((r) => r.id === value.slice(8));
      if (routine) onStart(draftFromRoutine(routine));
    } else if (value.startsWith("repeat:")) {
      const workout = workouts.find((w) => w.id === Number(value.slice(7)));
      if (workout) onStart(draftRepeating(workout));
    }
  };

  const remove = async (w: Workout) => {
    if (!confirm(`Delete “${w.name}” from ${formatDateLabel(w.date)}?`)) return;
    try {
      await api.deleteWorkout(w.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const shownBests = showAllBests ? bests : bests.slice(0, 5);
  const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <>
      <section className="card stack">
        <h2>Record a workout</h2>
        <button className="primary" onClick={() => onStart(emptyDraft())}>
          ＋ Start an empty workout
        </button>
        <label>
          Or start from a common workout
          <select value="" onChange={(e) => startFrom(e.target.value)}>
            <option value="">Choose one…</option>
            {recent.length > 0 && (
              <optgroup label="Repeat one of mine">
                {recent.map((w) => (
                  <option key={w.id} value={`repeat:${w.id}`}>
                    {w.name} ({shortDate(w.date)})
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="At the gym">
              {ROUTINES.filter((r) => r.location === "gym").map((r) => (
                <option key={r.id} value={`routine:${r.id}`}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="At home">
              {ROUTINES.filter((r) => r.location === "home").map((r) => (
                <option key={r.id} value={`routine:${r.id}`}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </section>

      <ErrorNote error={error} />

      {bests.length > 0 && (
        <section className="card">
          <h2>🏆 Personal bests</h2>
          <ul className="list">
            {shownBests.map((b, i) => (
              <li key={i} className="best-row">
                <span className="grow">{b.name}</span>
                <strong>
                  {toDisplay(b.weightKg, units)} {unitLabel(units)} × {b.reps}
                </strong>
                <span className="muted small best-date">{shortDate(b.date)}</span>
              </li>
            ))}
          </ul>
          {bests.length > 5 && (
            <button className="link-button" onClick={() => setShowAllBests(!showAllBests)}>
              {showAllBests ? "Show less" : `Show all ${bests.length}`}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <h2>History</h2>
        {workouts.length === 0 && <p className="muted">Workouts you record will show up here, with your weights and reps.</p>}
        <ul className="list">
          {workouts.map((w) => (
            <li key={w.id} className="workout-item">
              <button className="routine-header" onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id}>
                <span className="grow">
                  <strong>{w.name}</strong>
                  <span className="muted small block">
                    {formatDateLabel(w.date)} · {workoutSummary(w, units)}
                  </span>
                </span>
                <span aria-hidden className="muted">
                  {open === w.id ? "▲" : "▼"}
                </span>
              </button>
              {open === w.id && (
                <div className="stack workout-detail">
                  <ul className="list">
                    {w.exercises.map((e, i) => (
                      <li key={i}>
                        <strong>{e.name}</strong>
                        <span className="muted small block">{summarizeSets(e.sets, units)}</span>
                      </li>
                    ))}
                  </ul>
                  {w.notes && <p className="note pre-wrap">{w.notes}</p>}
                  <div className="row">
                    <button className="secondary grow" onClick={() => onStart(draftEditing(w, units))}>
                      Edit
                    </button>
                    <button className="secondary grow" onClick={() => onStart(draftRepeating(w))}>
                      Do it again
                    </button>
                    <button className="danger" onClick={() => remove(w)} aria-label="Delete workout">
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ---- Editor ----

interface EditorProps {
  draft: WorkoutDraft;
  setDraft: (draft: WorkoutDraft) => void;
  workouts: Workout[];
  units: Units;
  /** Called after saving or discarding. */
  onDone: (saved: boolean) => void;
}

export function WorkoutEditor({ draft, setDraft, workouts, units, onDone }: EditorProps) {
  const [picking, setPicking] = useState(draft.exercises.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateExercise = (key: string, change: (e: DraftExercise) => DraftExercise) =>
    setDraft({ ...draft, exercises: draft.exercises.map((e) => (e.key === key ? change(e) : e)) });

  const addExercise = (exerciseId: string | null, name: string) => {
    const last = lastPerformance(workouts, { exerciseId, name }, draft.id);
    const timed = isTimed(exerciseId) || (!!last && last.sets.every((s) => s.seconds != null && s.reps == null && s.weightKg == null));
    const count = last?.sets.length ?? (timed ? 1 : 3);
    setDraft({ ...draft, exercises: [...draft.exercises, draftExercise(exerciseId, name, count, timed, last?.sets)] });
    setPicking(false);
  };

  // Reordering: swap with the neighbour, then keep the moved exercise in view and briefly highlight it.
  // `tick` makes moving the same exercise twice in a row count as a new move.
  const [moved, setMoved] = useState<{ key: string; tick: number } | null>(null);
  const moveExercise = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.exercises.length) return;
    const exercises = [...draft.exercises];
    [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
    setDraft({ ...draft, exercises });
    setMoved((m) => ({ key: exercises[target].key, tick: (m?.tick ?? 0) + 1 }));
  };
  useEffect(() => {
    if (!moved) return;
    document.getElementById(`exercise-${moved.key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = setTimeout(() => setMoved(null), 1200);
    return () => clearTimeout(timer);
  }, [moved]);

  const hasContent = draft.exercises.some((e) =>
    e.sets.some((s) => s.weight || s.reps || s.minutes || s.seconds || (s.drops ?? []).some((d) => d.weight || d.reps)),
  );

  const discard = () => {
    if (hasContent && !confirm(draft.id ? "Discard your changes?" : "Discard this workout?")) return;
    onDone(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const input = draftToInput(draft, units);
    if (input.exercises.length === 0) {
      setError("Fill in at least one set before saving.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (draft.id !== undefined) await api.updateWorkout(draft.id, input);
      else await api.createWorkout(input);
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <section className="card stack">
        <label>
          Workout name
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Push day, Leg day, Morning run" />
        </label>
        <label>
          Date
          <input type="date" value={draft.date} max={today()} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} />
        </label>
      </section>

      {draft.exercises.map((ex, i) => (
        <ExerciseEditor
          key={ex.key}
          exercise={ex}
          position={i + 1}
          highlighted={moved?.key === ex.key}
          last={lastPerformance(workouts, ex, draft.id)}
          units={units}
          onChange={(change) => updateExercise(ex.key, change)}
          onMoveUp={i > 0 ? () => moveExercise(i, -1) : undefined}
          onMoveDown={i < draft.exercises.length - 1 ? () => moveExercise(i, 1) : undefined}
          onRemove={() => setDraft({ ...draft, exercises: draft.exercises.filter((e) => e.key !== ex.key) })}
        />
      ))}

      {picking ? (
        <ExercisePicker workouts={workouts} onPick={addExercise} onCancel={draft.exercises.length > 0 ? () => setPicking(false) : undefined} />
      ) : (
        <button type="button" className="secondary" onClick={() => setPicking(true)}>
          ＋ Add exercise
        </button>
      )}

      <section className="card">
        <label>
          Notes <span className="muted small">(optional)</span>
          <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="How it felt, what to change next time…" />
        </label>
      </section>

      <p className="muted small">Your progress is kept on this phone until you save, so you can switch screens or lock your phone between sets.</p>
      <ErrorNote error={error} />
      <div className="row editor-actions">
        <button type="button" className="secondary grow" onClick={discard}>
          {draft.id ? "Cancel" : "Discard"}
        </button>
        <button className="primary grow" disabled={busy}>
          {busy ? "Saving…" : draft.id ? "Save changes" : "Finish & save"}
        </button>
      </div>
    </form>
  );
}

function ExerciseEditor({
  exercise: ex,
  position,
  highlighted,
  last,
  units,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  exercise: DraftExercise;
  /** 1-based place in the workout. */
  position: number;
  /** Just moved, so briefly highlighted. */
  highlighted: boolean;
  last: { date: string; sets: WorkoutSet[] } | null;
  units: Units;
  onChange: (change: (e: DraftExercise) => DraftExercise) => void;
  /** Not set for the first exercise. */
  onMoveUp?: () => void;
  /** Not set for the last exercise. */
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  const library = ex.exerciseId ? exerciseById.get(ex.exerciseId) : undefined;
  const setField = (index: number, field: "weight" | "reps" | "minutes" | "seconds", value: string) =>
    onChange((e) => ({ ...e, sets: e.sets.map((s, i) => (i === index ? { ...s, [field]: value } : s)) }));
  const changeDrops = (index: number, change: (drops: DraftDrop[]) => DraftDrop[]) =>
    onChange((e) => ({ ...e, sets: e.sets.map((s, i) => (i === index ? { ...s, drops: change(s.drops ?? []) } : s)) }));
  const setDropField = (index: number, dropIndex: number, field: keyof DraftDrop, value: string) =>
    changeDrops(index, (drops) => drops.map((d, j) => (j === dropIndex ? { ...d, [field]: value } : d)));
  // Suggest last time's numbers for each set (the final set repeats for any extra ones).
  const hint = (index: number) => last?.sets[Math.min(index, last.sets.length - 1)];
  // Last time's drop for the same set and position, if there was one.
  const dropHint = (index: number, dropIndex: number) => last?.sets[index]?.drops?.[dropIndex];

  return (
    <section id={`exercise-${ex.key}`} className={highlighted ? "card stack exercise-card moved" : "card stack exercise-card"}>
      <div className="row space-between exercise-title">
        <strong className="grow">
          <span className="exercise-position">{position}.</span> {ex.name}
        </strong>
        <span className="row reorder-buttons">
          <button type="button" className="icon-button" aria-label={`Move ${ex.name} up`} disabled={!onMoveUp} onClick={onMoveUp}>
            ↑
          </button>
          <button type="button" className="icon-button" aria-label={`Move ${ex.name} down`} disabled={!onMoveDown} onClick={onMoveDown}>
            ↓
          </button>
          <button type="button" className="icon-button" aria-label={`Remove ${ex.name}`} onClick={onRemove}>
            ✕
          </button>
        </span>
      </div>
      {last && (
        <p className="muted small last-time">
          Last time ({formatDateLabel(last.date)}): {summarizeSets(last.sets, units)}
        </p>
      )}

      <div className="set-grid">
        <span className="muted small">Set</span>
        {ex.timed ? (
          <>
            <span className="muted small">Minutes</span>
            <span className="muted small">Seconds</span>
          </>
        ) : (
          <>
            <span className="muted small">Weight ({unitLabel(units)})</span>
            <span className="muted small">Reps</span>
          </>
        )}
        <span />
        <span />
        {ex.sets.map((s, i) => {
          const h = hint(i);
          return (
            <SetRow
              key={i}
              index={i}
              name={ex.name}
              drops={ex.timed ? [] : (s.drops ?? []).map((d, j) => {
                const dh = dropHint(i, j);
                return {
                  weight: { value: d.weight, placeholder: dh?.weightKg != null ? String(toDisplay(dh.weightKg, units)) : "–", onChange: (v) => setDropField(i, j, "weight", v) },
                  reps: { value: d.reps, placeholder: dh?.reps != null ? String(dh.reps) : "0", onChange: (v) => setDropField(i, j, "reps", v) },
                  onRemove: () => changeDrops(i, (drops) => drops.filter((_, n) => n !== j)),
                };
              })}
              onAddDrop={ex.timed ? undefined : () => changeDrops(i, (drops) => [...drops, blankDrop()])}
              first={
                ex.timed
                  ? { value: s.minutes, placeholder: h?.seconds != null ? String(Math.floor(h.seconds / 60)) : "0", onChange: (v) => setField(i, "minutes", v) }
                  : { value: s.weight, placeholder: h?.weightKg != null ? String(toDisplay(h.weightKg, units)) : "–", onChange: (v) => setField(i, "weight", v) }
              }
              second={
                ex.timed
                  ? { value: s.seconds, placeholder: h?.seconds != null ? String(h.seconds % 60) : "0", onChange: (v) => setField(i, "seconds", v) }
                  : { value: s.reps, placeholder: h?.reps != null ? String(h.reps) : "0", onChange: (v) => setField(i, "reps", v) }
              }
              labels={ex.timed ? ["minutes", "seconds"] : ["weight", "reps"]}
              onRemove={ex.sets.length > 1 ? () => onChange((e) => ({ ...e, sets: e.sets.filter((_, n) => n !== i) })) : undefined}
            />
          );
        })}
      </div>

      <div className="row space-between exercise-actions">
        {/* A new set starts with the previous set's numbers (drops included), since they usually repeat. */}
        <button
          type="button"
          className="link-button"
          onClick={() =>
            onChange((e) => {
              const previous = e.sets[e.sets.length - 1] ?? blankSet();
              return { ...e, sets: [...e.sets, { ...previous, drops: (previous.drops ?? []).map((d) => ({ ...d })) }] };
            })
          }
        >
          ＋ Add set
        </button>
        <span className="row exercise-links">
          <button type="button" className="link-button muted-link" onClick={() => onChange((e) => ({ ...e, timed: !e.timed }))}>
            {ex.timed ? "Log weight & reps" : "Log time instead"}
          </button>
          {library && (
            <a className="video-link" href={videoUrl(library)} target="_blank" rel="noopener noreferrer">
              ▶ How to
            </a>
          )}
        </span>
      </div>
    </section>
  );
}

interface SetField {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

interface DropFields {
  weight: SetField;
  reps: SetField;
  onRemove: () => void;
}

function SetRow({
  index,
  name,
  first,
  second,
  labels,
  drops,
  onAddDrop,
  onRemove,
}: {
  index: number;
  name: string;
  first: SetField;
  second: SetField;
  labels: [string, string];
  drops: DropFields[];
  /** Not set for timed exercises, which have no drops. */
  onAddDrop?: () => void;
  onRemove?: () => void;
}) {
  const input = (field: SetField, label: string, decimal: boolean) => (
    <input
      type="number"
      inputMode={decimal ? "decimal" : "numeric"}
      min="0"
      step="any"
      aria-label={`${name} set ${index + 1} ${label}`}
      value={field.value}
      placeholder={field.placeholder}
      onChange={(e) => field.onChange(e.target.value)}
    />
  );
  return (
    <>
      <span className="set-number">{index + 1}</span>
      {input(first, labels[0], labels[0] === "weight")}
      {input(second, labels[1], false)}
      {onAddDrop ? (
        <button type="button" className="drop-button" aria-label={`Add a drop to set ${index + 1}`} title="Drop set: lower the weight and keep going" onClick={onAddDrop}>
          <span aria-hidden>↘</span>
          <span className="drop-button-text"> Drop</span>
        </button>
      ) : (
        <span />
      )}
      {onRemove ? (
        <button type="button" className="icon-button" aria-label={`Remove set ${index + 1}`} onClick={onRemove}>
          ✕
        </button>
      ) : (
        <span />
      )}
      {drops.map((d, j) => (
        <DropRow key={j} setIndex={index} dropIndex={j} name={name} drop={d} />
      ))}
    </>
  );
}

function DropRow({ setIndex, dropIndex, name, drop }: { setIndex: number; dropIndex: number; name: string; drop: DropFields }) {
  const label = `${name} set ${setIndex + 1} drop ${dropIndex + 1}`;
  return (
    <>
      <span className="drop-marker" aria-hidden>
        ↘
      </span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        className="drop-input"
        aria-label={`${label} weight`}
        value={drop.weight.value}
        placeholder={drop.weight.placeholder}
        onChange={(e) => drop.weight.onChange(e.target.value)}
      />
      <input
        type="number"
        inputMode="numeric"
        min="0"
        step="any"
        className="drop-input"
        aria-label={`${label} reps`}
        value={drop.reps.value}
        placeholder={drop.reps.placeholder}
        onChange={(e) => drop.reps.onChange(e.target.value)}
      />
      <span className="muted small drop-label">drop</span>
      <button type="button" className="icon-button" aria-label={`Remove ${label}`} onClick={drop.onRemove}>
        ✕
      </button>
    </>
  );
}

function ExercisePicker({ workouts, onPick, onCancel }: { workouts: Workout[]; onPick: (exerciseId: string | null, name: string) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // The built-in library plus any custom exercises this person has logged before.
  const options = useMemo(() => {
    const list: { exerciseId: string | null; name: string; detail: string }[] = EXERCISES.map((e) => ({
      exerciseId: e.id,
      name: e.name,
      detail: e.equipment,
    }));
    const known = new Set(list.map((o) => o.name.toLowerCase()));
    for (const w of workouts) {
      for (const e of w.exercises) {
        if (e.exerciseId == null && !known.has(e.name.toLowerCase())) {
          known.add(e.name.toLowerCase());
          list.unshift({ exerciseId: null, name: e.name, detail: "My exercise" });
        }
      }
    }
    return list;
  }, [workouts]);

  const matches = options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, q ? 30 : 12);
  const exact = options.some((o) => o.name.toLowerCase() === q);

  return (
    <section className="card stack">
      <div className="row space-between">
        <h2>Add an exercise</h2>
        {onCancel && (
          <button type="button" className="link-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <input placeholder="Search, or type your own (e.g. Bench press)" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul className="list picker-list">
        {q && !exact && (
          <li>
            <button type="button" className="list-item" onClick={() => onPick(null, query.trim())}>
              <span className="grow">
                <strong>＋ Add “{query.trim()}”</strong>
                <span className="muted small block">Your own exercise</span>
              </span>
            </button>
          </li>
        )}
        {matches.map((o) => (
          <li key={o.exerciseId ?? `custom:${o.name}`}>
            <button type="button" className="list-item" onClick={() => onPick(o.exerciseId, o.name)}>
              <span className="grow">
                <strong>{o.name}</strong>
                <span className="muted small block">{o.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!q && <p className="muted small">Showing a few to start. Search to see all {options.length}.</p>}
    </section>
  );
}
