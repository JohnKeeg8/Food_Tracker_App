import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, MEALS, type ChatMessage, type Meal } from "../api";
import { useApp } from "../App";
import { FoodForm } from "../components/FoodForm";
import { ErrorNote, MacroLine, PageHeader } from "../components/ui";
import { PHOTO_PROMPT, parseClaudeReply, type ClaudeNutrition } from "../util";

const QUESTION_PREFIX = "What is the nutrition information for ";

/** The predetermined first message sent when the user asks Claude about a food. */
function nutritionQuestion(food: string) {
  return `${QUESTION_PREFIX}${food}? Please give the calories, protein, carbs and fat for a typical serving, and tell me what serving size you assumed.`;
}

export function ChatPage() {
  const { config } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A food photo handed over from Add food.
  const photo = (useLocation().state as { photo?: { data: string; mediaType: "image/jpeg" } } | null)?.photo;
  const food = params.get("food")?.trim() ?? "";
  const mealParam = params.get("meal");
  const meal = MEALS.includes(mealParam as Meal) ? (mealParam as Meal) : undefined;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(food || params.get("ask") || photo ? "" : QUESTION_PREFIX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ClaudeNutrition | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const startedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async (text: string, history: ChatMessage[], image?: ChatMessage["image"]) => {
    const next: ChatMessage[] = [...history, { role: "user", content: text, ...(image && { image }) }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const { text: reply } = await api.chat(next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A full question passed in by another screen (e.g. meal ideas from Today).
  const ask = params.get("ask")?.trim() ?? "";

  // Open the chat with the predetermined question when arriving from "Ask Claude about …".
  useEffect(() => {
    const first = photo ? PHOTO_PROMPT : ask || (food ? nutritionQuestion(food) : "");
    if (first && config.claudeEnabled && !startedRef.current) {
      startedRef.current = true;
      send(first, [], photo ? { data: photo.data, mediaType: photo.mediaType } : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, food, photo, config.claudeEnabled]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    send(text, messages);
  };

  if (!config.claudeEnabled) {
    return (
      <div className="page">
        <PageHeader title="Ask Claude" />
        <div className="card">
          <p>Ask Claude isn't set up on this server yet.</p>
          <p className="muted">Add your Anthropic API key as ANTHROPIC_API_KEY in the server's .env file and restart the app.</p>
        </div>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="page">
        <PageHeader title="Add to log" />
        <div className="card">
          <FoodForm
            draft={{ ...adding, meal }}
            source="claude"
            onSaved={() => {
              setAdded(adding.name);
              setAdding(null);
            }}
            onCancel={() => setAdding(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page chat-page">
      <PageHeader
        title="Ask Claude"
        right={
          messages.length > 0 && (
            <button className="link-button" onClick={() => setMessages([])}>
              New chat
            </button>
          )
        }
      />
      {added && (
        <p className="success">
          Added “{added}” to your log.{" "}
          <button className="link-button" onClick={() => navigate("/")}>
            View today
          </button>
        </p>
      )}
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="card muted">
            Ask about the nutrition of any food or meal, e.g. “a chicken burrito bowl from Chipotle” or “2 scrambled eggs with
            cheese”. Claude will estimate it and you can add it to your log in one tap.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="bubble user">
              {m.image && <img className="bubble-photo" src={`data:${m.image.mediaType};base64,${m.image.data}`} alt="Your food" />}
              {m.content}
            </div>
          ) : (
            <AssistantBubble key={i} text={m.content} onAdd={setAdding} />
          ),
        )}
        {busy && <div className="bubble assistant typing">Claude is thinking…</div>}
        <ErrorNote error={error} />
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          placeholder="Ask about a food…"
        />
        <button className="primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function AssistantBubble({ text, onAdd }: { text: string; onAdd: (n: ClaudeNutrition) => void }) {
  const { display, nutrition } = parseClaudeReply(text);
  return (
    <div className="bubble assistant">
      <FormattedText text={display} />
      {nutrition && (
        <div className="nutrition-card">
          <div>
            <strong>{nutrition.name}</strong>
            {nutrition.amount && <span className="muted small"> · {nutrition.amount}</span>}
            <MacroLine {...nutrition} />
          </div>
          <button className="primary small-button" onClick={() => onAdd(nutrition)}>
            ➕ Add to log
          </button>
        </div>
      )}
    </div>
  );
}

/** Renders the small subset of Markdown Claude tends to use: **bold**, headings and "- " bullets. */
function FormattedText({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    );
  return (
    <div className="formatted">
      {text.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="spacer" />;
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) return <div key={i} className="bullet">• {inline(bullet[1])}</div>;
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) return <strong key={i} className="block">{heading[1]}</strong>;
        return <div key={i}>{inline(line)}</div>;
      })}
    </div>
  );
}
