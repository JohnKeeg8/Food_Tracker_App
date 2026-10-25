import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { config } from "./config.js";

const SESSION_COOKIE = "ft_session";
const SESSION_DAYS = 60;

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
}

function toPublicUser(row: { id: number; username: string; display_name: string }): PublicUser {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

function createSession(res: Response, req: Request, userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    expires: new Date(expiresAt),
  });
}

/** Attaches req.userId when a valid session cookie is present. */
export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") {
    const row = db
      .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
      .get(token) as { user_id: number; expires_at: number } | undefined;
    if (row && row.expires_at > Date.now()) req.userId = row.user_id;
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (req.userId === undefined) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  next();
}

// Simple in-memory brute-force protection for the login endpoint.
const failedLogins = new Map<string, { count: number; until: number }>();
function isLockedOut(key: string) {
  const entry = failedLogins.get(key);
  return entry !== undefined && entry.count >= 5 && entry.until > Date.now();
}
function recordFailure(key: string) {
  const entry = failedLogins.get(key);
  const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
  failedLogins.set(key, { count, until: Date.now() + 15 * 60 * 1000 });
}

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, . _ or -"),
  password: z.string().min(8).max(200),
});

export const authRouter = Router();

authRouter.post("/register", (req, res) => {
  if (!config.allowSignup) {
    res.status(403).json({ error: "New sign-ups are turned off on this server." });
    return;
  }
  const parsed = credentialsSchema
    .extend({
      displayName: z.string().trim().min(1).max(50),
      signupCode: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { username, password, displayName, signupCode } = parsed.data;
  if (config.signupCode && signupCode !== config.signupCode) {
    res.status(403).json({ error: "Invalid sign-up code." });
    return;
  }
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
  if (exists) {
    res.status(409).json({ error: "That username is taken." });
    return;
  }
  const hash = bcrypt.hashSync(password, 12);
  const result = db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)")
    .run(username, displayName, hash);
  const userId = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO goals (user_id) VALUES (?)").run(userId);
  createSession(res, req, userId);
  res.status(201).json({ user: { id: userId, username, displayName } });
});

authRouter.post("/login", (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid username or password." });
    return;
  }
  const { username, password } = parsed.data;
  const key = `${req.ip}:${username.toLowerCase()}`;
  if (isLockedOut(key)) {
    res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    return;
  }
  const row = db
    .prepare("SELECT id, username, display_name, password_hash FROM users WHERE username = ?")
    .get(username) as { id: number; username: string; display_name: string; password_hash: string } | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    recordFailure(key);
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  failedLogins.delete(key);
  createSession(res, req, row.id);
  res.json({ user: toPublicUser(row) });
});

authRouter.post("/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  if (req.userId === undefined) {
    res.json({ user: null });
    return;
  }
  const row = db
    .prepare("SELECT id, username, display_name FROM users WHERE id = ?")
    .get(req.userId) as { id: number; username: string; display_name: string } | undefined;
  res.json({ user: row ? toPublicUser(row) : null });
});

authRouter.post("/password", requireUser, (req, res) => {
  const parsed = z
    .object({ currentPassword: z.string(), newPassword: z.string().min(8).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.userId!) as
    | { password_hash: string }
    | undefined;
  if (!row || !bcrypt.compareSync(parsed.data.currentPassword, row.password_hash)) {
    res.status(401).json({ error: "Current password is wrong." });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(parsed.data.newPassword, 12),
    req.userId!,
  );
  res.json({ ok: true });
});

/** Remove expired sessions; called periodically. */
export function pruneSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}
