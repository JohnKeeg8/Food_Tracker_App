import { useCallback, useEffect, useState } from "react";
import { api, type Workout } from "../api";
import { useApp } from "../App";
import { ErrorNote, PageHeader } from "../components/ui";
import { WorkoutEditor, WorkoutLog, draftFromRoutine, type WorkoutDraft } from "../components/WorkoutLog";
import type { Units } from "../health";
import {
  EXERCISES,
  GOAL_LABELS,
  ROUTINES,
  exerciseById,
  videoUrl,
  type Exercise,
  type Goal,
  type Location,
  type Muscle,
} from "../data/workouts";
import { capitalize } from "../util";

/** The workout being recorded is kept on the device so it survives switching screens or closing the app. */
function loadDraft(key: string): WorkoutDraft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as WorkoutDraft) : null;
  } catch {
    return null;
  }
}

function storeDraft(key: string, draft: WorkoutDraft | null) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode): the workout just isn't kept between screens.
  }
}

const MUSCLES: Muscle[] = ["full body", "legs", "glutes", "chest", "back", "shoulders", "arms", "core", "cardio"];

export function WorkoutsPage() {
  const { user } = useApp();
  const draftKey = `workoutDraft:${user.id}`;
  const [draft, setDraftState] = useState<WorkoutDraft | null>(() => loadDraft(draftKey));
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [units, setUnits] = useState<Units>("imperial");
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [location, setLocation] = useState<Location>("gym");
  const [goal, setGoal] = useState<Goal>("general");
  const [tab, setTab] = useState<"log" | "plans" | "library">("log");
  const [openRoutine, setOpenRoutine] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<Muscle | "all">("all");
  const [search, setSearch] = useState("");

  const setDraft = (next: WorkoutDraft | null) => {
    setDraftState(next);
    storeDraft(draftKey, next);
  };

  const load = useCallback(() => {
    Promise.all([api.workouts(), api.profile()])
      .then(([w, p]) => {
        setWorkouts(w);
        if (p.profile) setUnits(p.profile.units);
      })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const start = (next: WorkoutDraft) => {
    setSavedNote(false);
    setDraft(next);
    window.scrollTo(0, 0);
  };

  if (draft) {
    return (
      <div className="page">
        <PageHeader title={draft.id ? "Edit workout" : "Record workout"} />
        <WorkoutEditor
          draft={draft}
          setDraft={setDraft}
          workouts={workouts}
          units={units}
          onDone={(saved) => {
            setDraft(null);
            setTab("log");
            setSavedNote(saved);
            if (saved) load();
            window.scrollTo(0, 0);
          }}
        />
      </div>
    );
  }

  const routines = ROUTINES.filter((r) => r.location === location).sort(
    (a, b) => Number(b.goals.includes(goal)) - Number(a.goals.includes(goal)),
  );
  const exercises = EXERCISES.filter(
    (e) =>
      e.locations.includes(location) &&
      (muscle === "all" || e.muscles.includes(muscle)) &&
      e.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="page">
      <PageHeader title="Workouts" />

      <div className="segmented">
        <button className={tab === "log" ? "selected" : ""} onClick={() => setTab("log")}>
          My log
        </button>
        <button className={tab === "plans" ? "selected" : ""} onClick={() => setTab("plans")}>
          Plans
        </button>
        <button className={tab === "library" ? "selected" : ""} onClick={() => setTab("library")}>
          Exercises
        </button>
      </div>
      <ErrorNote error={error} />

      {tab === "log" && (
        <>
          {savedNote && <p className="success">Workout saved. Nice work! 💪</p>}
          <WorkoutLog workouts={workouts} units={units} onStart={start} onChanged={load} />
        </>
      )}

      {tab !== "log" && (
        <div className="segmented">
          <button className={location === "gym" ? "selected" : ""} onClick={() => setLocation("gym")}>
            🏋️ At the gym
          </button>
          <button className={location === "home" ? "selected" : ""} onClick={() => setLocation("home")}>
            🏠 At home
          </button>
        </div>
      )}

      {tab === "plans" && (
        <>
          <div className="chips">
            <span className="muted small">My goal:</span>
            {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
              <button key={g} className={goal === g ? "chip selected" : "chip"} onClick={() => setGoal(g)}>
                {GOAL_LABELS[g]}
              </button>
            ))}
          </div>
          {routines.map((r) => {
            const recommended = r.goals.includes(goal);
            const open = openRoutine === r.id;
            return (
              <section key={r.id} className={recommended ? "card routine recommended" : "card routine"}>
                <button className="routine-header" onClick={() => setOpenRoutine(open ? null : r.id)} aria-expanded={open}>
                  <span className="grow">
                    {recommended && <span className="badge">Recommended</span>}
                    <strong className="block">{r.name}</strong>
                    <span className="muted small">
                      {r.duration} · {r.frequency}
                    </span>
                  </span>
                  <span aria-hidden>{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div className="stack">
                    <p>{r.description}</p>
                    <button className="primary" onClick={() => start(draftFromRoutine(r))}>
                      Start & record this workout
                    </button>
                    <ol className="routine-list">
                      {r.items.map((item) => {
                        const ex = exerciseById.get(item.id);
                        if (!ex) return null;
                        return (
                          <li key={item.id}>
                            <ExerciseCard exercise={ex} prescription={item.prescription} />
                          </li>
                        );
                      })}
                    </ol>
                    <p className="muted small">
                      Warm up for 5 minutes first (brisk walk, jumping jacks, arm circles). Stop if anything hurts — and check with
                      a doctor before starting if you have a health condition.
                    </p>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {tab === "library" && (
        <>
          <input placeholder="Search exercises" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="chips">
            <button className={muscle === "all" ? "chip selected" : "chip"} onClick={() => setMuscle("all")}>
              All
            </button>
            {MUSCLES.map((m) => (
              <button key={m} className={muscle === m ? "chip selected" : "chip"} onClick={() => setMuscle(m)}>
                {capitalize(m)}
              </button>
            ))}
          </div>
          {exercises.length === 0 && <p className="muted">No exercises match.</p>}
          <ul className="list">
            {exercises.map((e) => (
              <li key={e.id} className="card">
                <ExerciseCard exercise={e} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ExerciseCard({ exercise: e, prescription }: { exercise: Exercise; prescription?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="exercise">
      <button className="exercise-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grow">
          <strong>{e.name}</strong>
          {prescription && <span className="block prescription">{prescription}</span>}
          <span className="muted small block">
            {e.muscles.map(capitalize).join(", ")} · {e.equipment}
          </span>
        </span>
        <span aria-hidden className="muted">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="stack exercise-body">
          <ol>
            {e.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {e.tip && <p className="note">💡 {e.tip}</p>}
        </div>
      )}
      <a className="video-link" href={videoUrl(e)} target="_blank" rel="noopener noreferrer">
        ▶ Watch how to do it
      </a>
    </div>
  );
}
