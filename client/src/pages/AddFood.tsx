import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, MEALS, type FoodEntry, type FoodProduct, type FoodSource, type Meal } from "../api";
import { useApp } from "../App";
import { FoodForm, type FoodDraft } from "../components/FoodForm";
import { DatePicker, ErrorNote, MacroLine, PageHeader } from "../components/ui";
import { PHOTO_PROMPT, canShareFiles, claudeNutritionPrompt, copyText, openClaudeWeb, preparePhoto, scale, type PhotoData } from "../util";

type Mode = "search" | "scan" | "manual" | "recent";

interface Selection {
  draft: FoodDraft;
  source: FoodSource;
  product?: FoodProduct;
  /** The user went to claude.ai to ask about this food. */
  askedClaude?: boolean;
  /** Instructions shown above the form after handing off to Claude. */
  note?: string;
}

// The barcode library is large, so only load it when the Scan tab is opened.
const BarcodeScanner = lazy(() => import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })));

const emptyDraft: FoodDraft = { name: "", calories: 0, protein: 0, carbs: 0, fat: 0 };

export function AddFoodPage() {
  const { config } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mealParam = params.get("meal");
  const meal = MEALS.includes(mealParam as Meal) ? (mealParam as Meal) : undefined;

  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodProduct[] | null>(null);
  const [recent, setRecent] = useState<FoodEntry[] | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<PhotoData | null>(null);

  useEffect(() => {
    if (mode === "recent" && recent === null) {
      api.recentFood().then(setRecent).catch((err) => setError(err.message));
    }
  }, [mode, recent]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setError(null);
    setBusy(true);
    try {
      setResults(await api.searchFood(query.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onBarcode = useCallback(
    async (code: string) => {
      setError(null);
      setBusy(true);
      try {
        const product = await api.lookupBarcode(code);
        setSelection({ draft: productDraft(product, meal), source: "barcode", product });
      } catch (err) {
        setError(`${(err as Error).message} (barcode ${code})`);
      } finally {
        setBusy(false);
      }
    },
    [meal],
  );

  const askClaude = () => {
    const food = query.trim();
    // With an API key on the server, chat inside the app; otherwise use the person's own claude.ai account.
    if (config.claudeEnabled) {
      navigate(`/chat${food ? `?food=${encodeURIComponent(food)}` : ""}${meal ? `${food ? "&" : "?"}meal=${meal}` : ""}`);
      return;
    }
    if (!food) {
      setMode("search");
      setError("Type the food you want to ask about first, then tap Ask Claude.");
      return;
    }
    setError(null);
    openClaudeWeb(claudeNutritionPrompt(food));
    setSelection({ draft: { ...emptyDraft, name: food, meal }, source: "claude", askedClaude: true });
  };

  const claudeNote =
    "Claude opened in a new tab with your question. If the question isn't filled in there, paste it: it's been copied. " +
    "When Claude answers, come back here and type in the numbers, or paste Claude's answer to fill them in.";

  // Photo → Claude. With an API key the photo goes straight to the in-app chat. Without one, the phone's share
  // sheet sends it to the Claude app (HTTPS only); otherwise Claude opens and the photo is taken there.
  const shareSupported = !config.claudeEnabled && canShareFiles();

  const onPhotoTaken = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      if (config.claudeEnabled) {
        navigate(`/chat${meal ? `?meal=${meal}` : ""}`, { state: { photo: { data: prepared.data, mediaType: prepared.mediaType, dataUrl: prepared.dataUrl } } });
      } else {
        setPhoto(prepared);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sharePhoto = async () => {
    if (!photo) return;
    copyText(PHOTO_PROMPT);
    try {
      await navigator.share({ files: [photo.file], text: PHOTO_PROMPT });
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // The user closed the share sheet.
      setError("Couldn't open the share sheet. Open Claude yourself and attach the photo; the question has been copied.");
    }
    setPhoto(null);
    setSelection({
      draft: { ...emptyDraft, meal },
      source: "claude",
      askedClaude: true,
      note: "Pick Claude in the share sheet and send the photo (the question is included, and also copied in case you need to paste it). When Claude answers, paste its answer here to fill in the numbers.",
    });
  };

  const photoInClaude = () => {
    openClaudeWeb(PHOTO_PROMPT);
    setSelection({
      draft: { ...emptyDraft, meal },
      source: "claude",
      askedClaude: true,
      note: "Claude opened with the question ready (it's also copied). In Claude, tap the + or camera button, take a photo of your food and send it. When Claude answers, come back and paste its answer here to fill in the numbers.",
    });
  };

  const done = () => navigate("/");

  if (selection) {
    return (
      <div className="page">
        <PageHeader title="Add food" />
        <DatePicker />
        {selection.askedClaude && <p className="note">{selection.note ?? claudeNote}</p>}
        <div className="card">
          <FoodForm
            draft={selection.draft}
            source={selection.source}
            product={selection.product}
            pasteFromClaude={selection.askedClaude}
            onSaved={done}
            onCancel={() => setSelection(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Add food" />
      <DatePicker />

      <div className="segmented">
        {(
          [
            ["search", "🔎 Search"],
            ["scan", "📷 Scan"],
            ["manual", "✏️ Manual"],
            ["recent", "🕘 Recent"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? "selected" : ""} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>

      <div className="row claude-row">
        <button className="claude-button grow" onClick={askClaude}>
          ✨ Ask Claude{query.trim() ? ` about “${query.trim()}”` : ""}
        </button>
        {config.claudeEnabled || shareSupported ? (
          <label className="claude-button photo-button">
            📸 Photo
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhotoTaken(e.target.files?.[0])} />
          </label>
        ) : (
          <button className="claude-button photo-button" onClick={photoInClaude}>
            📸 Photo
          </button>
        )}
      </div>

      {photo && (
        <div className="card stack">
          <img src={photo.dataUrl} alt="Your food" className="photo-preview" />
          <button className="primary" onClick={sharePhoto}>
            Send to Claude
          </button>
          <button className="secondary" onClick={() => setPhoto(null)}>
            Cancel
          </button>
        </div>
      )}

      <ErrorNote error={error} />

      {mode === "search" && (
        <div className="card stack">
          <form className="row" onSubmit={search}>
            <input
              className="grow"
              placeholder="Type a food, e.g. greek yogurt"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button className="primary" disabled={busy}>
              {busy ? "…" : "Search"}
            </button>
          </form>
          {results && results.length === 0 && (
            <p className="muted">No matches. Try different words, enter it manually, or ask Claude.</p>
          )}
          {results && results.length > 0 && (
            <ul className="list">
              {results.map((p, i) => {
                const n = p.perServing ?? p.per100g;
                return (
                  <li key={`${p.barcode}-${i}`}>
                    <button className="list-item" onClick={() => setSelection({ draft: productDraft(p, meal), source: "search", product: p })}>
                      {p.image ? <img src={p.image} alt="" className="thumb" /> : <span className="thumb" />}
                      <span className="grow">
                        <strong>{p.name}</strong>
                        <span className="muted small block">
                          {p.brand ?? ""} {p.perServing ? `per serving${p.servingSize ? ` (${p.servingSize})` : ""}` : "per 100 g"}
                        </span>
                        {n && <MacroLine {...n} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small">Food data from Open Food Facts. Packaged foods match best; for meals, ask Claude.</p>
        </div>
      )}

      {mode === "scan" && (
        <div className="card">
          {busy ? (
            <p>Looking up…</p>
          ) : (
            <Suspense fallback={<p className="muted">Starting scanner…</p>}>
              <BarcodeScanner onDetected={onBarcode} />
            </Suspense>
          )}
        </div>
      )}

      {mode === "manual" && (
        <div className="card">
          <FoodForm draft={{ ...emptyDraft, name: query, meal }} source="manual" onSaved={done} />
        </div>
      )}

      {mode === "recent" && (
        <div className="card">
          {recent === null && <p className="muted">Loading…</p>}
          {recent?.length === 0 && <p className="muted">Foods you log will show up here for quick re-adding.</p>}
          <ul className="list">
            {recent?.map((f) => (
              <li key={f.id}>
                <button
                  className="list-item"
                  onClick={() =>
                    setSelection({
                      draft: { name: f.name, brand: f.brand, barcode: f.barcode, amount: f.amount, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat, meal },
                      source: "recent",
                    })
                  }
                >
                  <span className="grow">
                    <strong>{f.name}</strong>
                    {f.amount && <span className="muted small"> · {f.amount}</span>}
                    <MacroLine {...f} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function productDraft(p: FoodProduct, meal?: Meal): FoodDraft {
  const n = p.perServing ?? (p.per100g ? scale(p.per100g, 1) : { calories: 0, protein: 0, carbs: 0, fat: 0 });
  return { name: p.name, brand: p.brand, barcode: p.barcode || null, meal, ...n };
}
