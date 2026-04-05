import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "./db.js";
import { users, sessions, companies } from "../shared/schema.js";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Context, Next } from "hono";

const SESSION_DAYS = 7;
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000; // refresh if session older than 1 day

// ── Auth middleware ──────────────────────────────────────────────
export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, "session");
  if (!token) return c.json({ error: "Not authenticated" }, 401);

  const now = new Date().toISOString();
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!session) {
    deleteCookie(c, "session");
    return c.json({ error: "Session expired" }, 401);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, session.userId), eq(users.isActive, true)))
    .limit(1);

  if (!user) return c.json({ error: "User not found" }, 401);

  c.set("user", user);

  // S-11: Sliding session window — extend if older than 1 day
  const sessionAge = Date.now() - new Date(session.createdAt || 0).getTime();
  if (sessionAge > SESSION_REFRESH_AFTER_MS) {
    const newExpiry = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.update(sessions).set({ expiresAt: newExpiry }).where(eq(sessions.id, token));
    setCookie(c, "session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
      path: "/",
    });
  }

  // Verify company is active
  if (user.companyId) {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, user.companyId), eq(companies.isActive, true)))
      .limit(1);
    if (!company) return c.json({ error: "Company is inactive" }, 403);
  }
  c.set("session", session);
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Insufficient permissions" }, 403);
    // super_admin has all permissions
    if (user.role === "super_admin" || roles.includes(user.role)) {
      await next();
      return;
    }
    return c.json({ error: "Insufficient permissions" }, 403);
  };
}

// Require specifically super_admin — no fallthrough
export function requireSuperAdmin() {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user || user.role !== "super_admin") {
      return c.json({ error: "Super admin access required" }, 403);
    }
    await next();
  };
}

// ── Auth routes ─────────────────────────────────────────────────
const auth = new Hono();

// Login
auth.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  if (!username || !password) {
    return c.json({ error: "Username and password required" }, 400);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username.toLowerCase().trim()), eq(users.isActive, true)))
    .limit(1);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Create session
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.insert(sessions).values({ id: token, userId: user.id, expiresAt });
  await db.update(users).set({ lastLogin: new Date().toISOString() }).where(eq(users.id, user.id));

  setCookie(c, "session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    companyId: user.companyId,
  });
});

// Logout
auth.post("/logout", async (c) => {
  const token = getCookie(c, "session");
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, token));
    deleteCookie(c, "session");
  }
  return c.json({ ok: true });
});

// Get current user
auth.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    companyId: user.companyId,
  });
});

// Change password (own)
auth.post("/change-password", requireAuth, async (c) => {
  const user = c.get("user");
  const { currentPassword, newPassword } = await c.req.json();

  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return c.json({ error: "Current password is incorrect" }, 400);
  }
  if (!newPassword || newPassword.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400);
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, user.id));

  return c.json({ ok: true });
});

export { auth };
