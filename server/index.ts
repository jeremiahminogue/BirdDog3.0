import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { dirname, resolve } from "path";
import { initDb } from "./db.js";
import { auth } from "./auth.js";
import { api } from "./routes.js";
import { reports } from "./reports.js";
import { chat } from "./chat.js";
import { schedule } from "./schedule.js";
import { meeting } from "./meeting.js";
import { seedTemplates } from "./seed-templates.js";
import { importRoutes } from "./import.js";
import { opportunities } from "./opportunities.js";
import { importOpportunities } from "./import-opportunities.js";
import { dailyReportRoutes } from "./daily-reports.js";
import { toolboxTalkRoutes } from "./toolbox-talks.js";
import { changeOrderRoutes } from "./change-orders.js";
import { timeTrackingRoutes } from "./time-tracking.js";
import { mapsRoutes } from "./maps.js";
import { seedTimeTrackingRoutes } from "./seed-time-tracking.js";
import { seedComprehensiveRoutes } from "./seed-comprehensive.js";
import { fieldRoutes } from "./routes-field.js";
import announceRoutes from "./announcements.js";
import { toolMgmtRoutes } from "./tool-management.js";
import { sanitizeBody } from "./validation.js";
import { startNotificationScheduler, runDailyIssueNotifications } from "./notifications.js";

// Initialize database
try {
  initDb();
  console.log("✓ Database initialized");
} catch (e) {
  console.error("✗ Database init failed:", e);
  process.exit(1);
}

// Seed default data (templates, etc.) — safe to call every boot
seedTemplates().then(() => {
  console.log("✓ Seed check complete");
}).catch((e) => {
  console.warn("⚠ Template seeding failed (non-fatal):", e.message);
});

const app = new Hono();

// Global error handler — return JSON instead of plain text (Q-02: don't leak details)
app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: "Internal server error" }, 500);
});

// ── S-12 FIX: Simple in-memory rate limiter (no extra deps) ─────
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(windowMs: number, maxRequests: number) {
  return async (c: any, next: any) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      || c.req.header("fly-client-ip")
      || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      return c.json({ error: "Too many requests — try again later" }, 429);
    }
    await next();
  };
}
// Clean up stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 5 * 60 * 1000);

// Middleware
app.use("*", logger());
app.use("/api/*", cors({
  origin: (origin) => origin || "*",
  credentials: true,
}));

// CSRF protection: require X-Requested-With header on all mutating requests
// Browsers won't send custom headers cross-origin without CORS preflight
// Skip for mobile app requests (identified by Bearer token in Authorization header)
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  // Mobile app uses Bearer token — skip CSRF check (token itself is the auth proof)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return next();
  }
  const xrw = c.req.header("X-Requested-With");
  if (!xrw) {
    return c.json({ error: "Missing required header" }, 403);
  }
  return next();
});

// Health check (no auth required)
app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

// S-13: Global body sanitizer — caps text fields at 10k chars
app.use("/api/*", sanitizeBody);

// S-12: Rate limits — strict on login, generous on general API
app.use("/api/auth/login", rateLimit(15 * 60 * 1000, 5));  // 5 attempts per 15 min
app.use("/api/*", rateLimit(60 * 1000, 100));               // 100 req/min per IP

// API Routes
app.route("/api/auth", auth);
app.route("/api", api);
app.route("/api/reports", reports);
app.route("/api/chat", chat);
app.route("/api/schedule", schedule);
app.route("/api/meeting", meeting);
app.route("/api/import", importRoutes);
app.route("/api/opportunities", opportunities);
app.route("/api/import/opportunities", importOpportunities);
app.route("/api/daily-reports", dailyReportRoutes);
app.route("/api/toolbox-talks", toolboxTalkRoutes);
app.route("/api/change-orders", changeOrderRoutes);
app.route("/api/time-tracking", timeTrackingRoutes);
app.route("/api/maps", mapsRoutes);
app.route("/api/field", fieldRoutes);
app.route("/api/announcements", announceRoutes);
app.route("/api/tool-management", toolMgmtRoutes);
app.route("/api/seed", seedTimeTrackingRoutes);
app.route("/api/seed", seedComprehensiveRoutes);

// Serve employee photos from persistent data volume
app.get("/api/photos/:filename", async (c) => {
  const filename = c.req.param("filename");
  // Sanitize: block path separators, dotfiles, and non-alphanumeric chars (except dash, dot, underscore)
  if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.startsWith(".")) {
    return c.text("Not found", 404);
  }
  const dataDir = process.env.DB_PATH ? dirname(process.env.DB_PATH) : "./data";
  const photosDir = resolve(`${dataDir}/photos`);
  const filepath = resolve(photosDir, filename);
  // Ensure resolved path stays inside photos directory (blocks symlink escape)
  if (!filepath.startsWith(photosDir + "/")) {
    return c.text("Not found", 404);
  }
  const file = Bun.file(filepath);
  if (await file.exists()) {
    const ext = filename.split(".").pop() || "jpg";
    const mimeTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml" };
    return new Response(file, { headers: { "Content-Type": mimeTypes[ext] || "image/jpeg", "Cache-Control": "public, max-age=86400" } });
  }
  return c.text("Not found", 404);
});

// Serve time tracking photos from persistent volume
app.get("/api/photos/time-tracking/:filename", async (c) => {
  const filename = c.req.param("filename");
  const file = Bun.file(`/app/data/photos/time-tracking/${filename}`);
  if (await file.exists()) {
    const ext = filename.split(".").pop() || "jpg";
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    return new Response(file, { headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" } });
  }
  return c.text("Not found", 404);
});

// Serve built assets (JS/CSS bundles)
app.use("/assets/*", serveStatic({ root: "./dist/client" }));

// SPA fallback — check public folder first, then serve index.html
app.get("*", async (c) => {
  const urlPath = new URL(c.req.url).pathname;

  // Try serving from public folder (for logo, favicon, etc.)
  if (urlPath !== "/" && urlPath.includes(".")) {
    const publicFile = Bun.file(`./public${urlPath}`);
    if (await publicFile.exists()) {
      const ext = urlPath.split(".").pop() || "";
      const mimeTypes: Record<string, string> = {
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        ico: "image/x-icon",
        json: "application/json",
        webp: "image/webp",
      };
      return new Response(publicFile, {
        headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
      });
    }
  }

  // SPA fallback
  const indexFile = Bun.file("./dist/client/index.html");
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return c.text("Not found", 404);
});

const port = parseInt(process.env.PORT || "3000");
console.log(`⚡ PE Management running on http://localhost:${port}`);

// Start daily notification scheduler (7:30 AM push notifications for clock issues)
startNotificationScheduler();

export default {
  port,
  fetch: app.fetch,
};
