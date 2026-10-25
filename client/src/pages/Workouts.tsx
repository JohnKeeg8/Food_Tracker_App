import { useState } from "react";
import { PageHeader } from "../components/ui";
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

const MUSCLES: Muscle[] = ["full body", "legs", "glutes", "chest", "back", "shoulders", "arms", "core", "cardio"];

export function WorkoutsPage() {
  const [location, setLocation] = useState<Location>("home");
  const [goal, setGoal] = useState<Goal>("general");
  const [tab, setTab] = useState<"plans" | "library">("plans");
  const [openRoutine, setOpenRoutine] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<Muscle | "all">("all");
  const [search, setSearch] = useState("");

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
        <button className={location === "home" ? "selected" : ""} onClick={() => setLocation("home")}>
          🏠 At home
        </button>
        <button className={location === "gym" ? "selected" : ""} onClick={() => setLocation("gym")}>
          🏋️ At the gym
        </button>
      </div>
      <div className="segmented">
        <button className={tab === "plans" ? "selected" : ""} onClick={() => setTab("plans")}>
          Recommended plans
        </button>
        <button className={tab === "library" ? "selected" : ""} onClick={() => setTab("library")}>
          Exercise library
        </button>
      </div>

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
