import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, type AppConfig, type User } from "./api";
import { today } from "./util";
import { LoginPage } from "./pages/Login";
import { TodayPage } from "./pages/Today";
import { AddFoodPage } from "./pages/AddFood";
import { ChatPage } from "./pages/Chat";
import { WaterPage } from "./pages/Water";
import { RecipesPage } from "./pages/Recipes";
import { WorkoutsPage } from "./pages/Workouts";
import { SettingsPage } from "./pages/Settings";

interface AppState {
  user: User;
  config: AppConfig;
  /** The day being viewed/logged to (YYYY-MM-DD). */
  date: string;
  setDate: (date: string) => void;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside App");
  return ctx;
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [date, setDate] = useState(today);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.me()])
      .then(([cfg, me]) => {
        setConfig(cfg);
        setUser(me.user);
      })
      .catch(() => setLoadError("Can't reach the server. Check that it's running and refresh."));
  }, []);

  if (loadError) return <div className="center-screen">{loadError}</div>;
  if (!config || user === undefined) return <div className="center-screen">Loading…</div>;
  if (!user) return <LoginPage config={config} onSignedIn={setUser} />;

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  };

  return (
    <AppContext.Provider value={{ user, config, date, setDate, signOut }}>
      <div className="app">
        <main className="content">
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/add" element={<AddFoodPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/water" element={<WaterPage />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/workouts" element={<WorkoutsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <nav className="tabbar">
          <Tab to="/" icon="🏠" label="Today" />
          <Tab to="/add" icon="➕" label="Add food" />
          <Tab to="/water" icon="💧" label="Water" />
          <Tab to="/recipes" icon="📖" label="Recipes" />
          <Tab to="/workouts" icon="🏋️" label="Workouts" />
        </nav>
      </div>
    </AppContext.Provider>
  );
}

function Tab({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink to={to} end className={({ isActive }) => (isActive ? "tab active" : "tab")}>
      <span className="tab-icon" aria-hidden>
        {icon}
      </span>
      <span className="tab-label">{label}</span>
    </NavLink>
  );
}
