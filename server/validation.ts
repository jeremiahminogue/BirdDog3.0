/**
 * S-13 / Q-01 FIX: Request validation schemas + body sanitizer middleware.
 *
 * Approach:
 * 1. Global middleware caps all text fields at 10,000 chars (catches abuse)
 * 2. Zod schemas on critical endpoints enforce specific types & lengths
 * 3. Schemas use .passthrough() so the frontend can send extra fields
 * 4. ALL fields use coercion — frontend sends strings from forms,
 *    empty strings for null, "5" for numbers, etc. We handle it all.
 */
import { z } from "zod";
import type { Context, Next } from "hono";

// ── Generic body sanitizer middleware ──────────────────────────────
const MAX_TEXT_LEN = 10_000;
const MAX_BODY_KEYS = 100;

export async function sanitizeBody(c: Context, next: Next) {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || method === "DELETE") {
    return next();
  }

  const ct = c.req.header("content-type") || "";
  if (!ct.includes("application/json")) {
    return next();
  }

  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null) return next();

    const keys = Object.keys(body);
    if (keys.length > MAX_BODY_KEYS) {
      return c.json({ error: "Request body has too many fields" }, 400);
    }

    for (const key of keys) {
      const val = body[key];
      if (typeof val === "string" && val.length > MAX_TEXT_LEN) {
        return c.json({ error: `Field '${key}' exceeds maximum length (${MAX_TEXT_LEN} chars)` }, 400);
      }
    }
  } catch {
    // If JSON parsing fails, let the route handler deal with it
  }

  return next();
}

// ── Validation helper ─────────────────────────────────────────────
export function validate<T>(schema: z.ZodType<T>) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const result = schema.safeParse(body);
      if (!result.success) {
        const fieldErrors = result.error.issues.map(i => ({
          field: i.path.join("."),
          message: i.message,
        }));
        console.warn("Validation failed:", JSON.stringify(fieldErrors));
        return c.json({ error: "Validation failed", fields: fieldErrors }, 400);
      }
      c.set("validatedBody", result.data);
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    await next();
  };
}

// ── Reusable field helpers (frontend-friendly with coercion) ──────
// Strings: accept string, coerce null/undefined to undefined, cap length
const str = (max = 200) => z.string().min(1).max(max);

// Optional strings: accept string, null, undefined, empty string → all OK
const optStr = (max = 200) => z.preprocess(
  (v) => (v === "" || v === null || v === undefined) ? undefined : v,
  z.string().max(max).optional()
);

// Numbers: coerce from string ("5" → 5), accept null/undefined
const optNum = () => z.preprocess(
  (v) => (v === "" || v === null || v === undefined) ? undefined : Number(v),
  z.number().optional()
);

// Required positive integer IDs: coerce from string
const id = () => z.preprocess(
  (v) => (v === "" || v === null || v === undefined) ? undefined : Number(v),
  z.number().int().positive()
);

// Optional IDs: coerce, allow null/empty
const optId = () => z.preprocess(
  (v) => (v === "" || v === null || v === undefined || v === 0 || v === "0") ? undefined : Number(v),
  z.number().int().positive().optional()
);

// Booleans: accept true/false, 0/1, "true"/"false"
const optBool = () => z.preprocess(
  (v) => {
    if (v === null || v === undefined || v === "") return undefined;
    if (v === 1 || v === "1" || v === "true" || v === true) return true;
    if (v === 0 || v === "0" || v === "false" || v === false) return false;
    return v;
  },
  z.boolean().optional()
);

// Dates: accept valid date strings, empty string → undefined
const optDate = () => z.preprocess(
  (v) => (v === "" || v === null || v === undefined) ? undefined : v,
  z.string().optional()
);

// ── Schemas ───────────────────────────────────────────────────────

export const ClassificationSchema = z.object({
  name: str(100),
  department: optStr(100),
  classificationGroup: optStr(100),
  hasLicense: optBool(),
  color: optStr(20),
}).passthrough();

export const EmployeeSchema = z.object({
  employeeNumber: str(50),
  firstName: str(100),
  lastName: str(100),
  classificationId: optId(),
  status: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["active", "inactive"]).optional()
  ),
  phone: optStr(30),
  pePhone: optStr(30),
  personalEmail: optStr(200),
  workEmail: optStr(200),
  address: optStr(500),
  emergencyContactName: optStr(200),
  emergencyContactPhone: optStr(30),
  dateOfHire: optDate(),
  dateOfBirth: optDate(),
  placeOfBirth: optStr(200),
  shirtSize: optStr(20),
  jacketSize: optStr(20),
  elecLicense: optStr(100),
  dlNumber: optStr(50),
  dlState: optStr(10),
  dlExpiration: optDate(),
  backgroundCheck: optStr(100),
  backgroundCheckDate: optDate(),
  reasonForLeaving: optStr(500),
  notes: optStr(5000),
}).passthrough();

export const JobSchema = z.object({
  jobNumber: str(50),
  name: str(200),
  address: optStr(500),
  jurisdictionId: optId(),
  gcContact: optStr(200),
  status: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["planning", "active", "completed", "closed"]).optional()
  ),
  startDate: optDate(),
  endDate: optDate(),
  scopeOfWork: optStr(5000),
  originalContract: optNum(),
  currentContract: optNum(),
  showOnBoard: optBool(),
}).passthrough();

export const AssignmentSchema = z.object({
  jobId: id(),
  employeeId: id(),
  role: optStr(100),
  billRate: optNum(),
}).passthrough();

export const CostSchema = z.object({
  category: z.enum(["labor", "material", "equipment", "general", "subcontract"]),
  amount: z.preprocess((v) => Number(v), z.number()),
  costCode: optStr(50),
  description: optStr(500),
  dateRecorded: optDate(),
  weekEnding: optDate(),
  notes: optStr(2000),
}).passthrough();

export const BudgetSchema = z.object({
  originalBudget: optNum(),
  currentBudget: optNum(),
}).passthrough();

export const AssetSchema = z.object({
  type: z.enum(["vehicle", "tool", "equipment"]),
  description: str(500),
  category: optStr(100),
  manufacturer: optStr(200),
  model: optStr(200),
  serialNumber: optStr(100),
  identifier: optStr(100),
  assignedToEmployee: optId(),
  assignedToJob: optId(),
  status: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["available", "assigned", "maintenance", "retired"]).optional()
  ),
  condition: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["new", "good", "fair", "poor"]).optional()
  ),
  purchaseDate: optDate(),
  purchaseCost: optNum(),
  warrantyExpires: optDate(),
  notes: optStr(5000),
}).passthrough();

export const JurisdictionSchema = z.object({
  name: str(200),
  description: optStr(1000),
}).passthrough();

export const RateSchema = z.object({
  classificationId: id(),
  hourlyRate: z.preprocess((v) => Number(v), z.number().min(0)),
  totalCostRate: z.preprocess((v) => Number(v), z.number().min(0)),
  effectiveDate: optDate(),
  expirationDate: optDate(),
}).passthrough();

export const UserSchema = z.object({
  username: z.string().min(2).max(50),
  displayName: str(100),
  role: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["super_admin", "admin", "pm", "readonly"]).optional()
  ),
  password: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.string().min(6).max(200).optional()
  ),
}).passthrough();

export const LoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
