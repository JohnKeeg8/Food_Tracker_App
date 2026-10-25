import { useState, type FormEvent } from "react";
import { api, type AppConfig, type User } from "../api";
import { ErrorNote } from "../components/ui";

export function LoginPage({ config, onSignedIn }: { config: AppConfig; onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } =
        mode === "login"
          ? await api.login(username, password)
          : await api.register({ username, password, displayName: displayName || username, signupCode: signupCode || undefined });
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="card login-card">
        <div className="login-logo" aria-hidden>
          💚
        </div>
        <h1>Health Tracker</h1>
        <p className="muted">{mode === "login" ? "Sign in to your account" : "Create your own account"}</p>
        <form onSubmit={submit} className="stack">
          {mode === "register" && (
            <label>
              Your name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. John" />
            </label>
          )}
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {mode === "register" && config.signupCodeRequired && (
            <label>
              Sign-up code
              <input value={signupCode} onChange={(e) => setSignupCode(e.target.value)} required />
            </label>
          )}
          <ErrorNote error={error} />
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        {config.signupEnabled && (
          <button
            className="link-button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        )}
      </div>
    </div>
  );
}
