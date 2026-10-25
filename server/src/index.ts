import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import "./db.js";
import { authRouter, loadSession, pruneSessions, requireUser } from "./auth.js";
import { trackingRouter } from "./routes/tracking.js";
import { recipesRouter } from "./routes/recipes.js";
import { lookupRouter } from "./routes/lookup.js";
import { chatRouter } from "./routes/chat.js";

const app = express();
// Trust a reverse proxy (e.g. Caddy) on the local/private network so HTTPS cookies work behind it.
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(loadSession);

app.get("/api/config", (_req, res) => {
  res.json({ claudeEnabled: Boolean(config.anthropicApiKey), signupEnabled: config.allowSignup, signupCodeRequired: Boolean(config.signupCode) });
});
app.use("/api/auth", authRouter);
app.use("/api/recipes", requireUser, recipesRouter);
app.use("/api/lookup", requireUser, lookupRouter);
app.use("/api/chat", requireUser, chatRouter);
app.use("/api", requireUser, trackingRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serve the built web app.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.CLIENT_DIST ?? path.resolve(here, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

pruneSessions();
setInterval(pruneSessions, 6 * 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Health app listening on http://0.0.0.0:${config.port}`);
});
