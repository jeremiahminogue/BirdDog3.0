import { sqlite } from "./db.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Seed vehicles from Access DB export (XLSX → JSON).
 * Run: bun server/seed-vehicles.ts
 *
 * Maps Access employee IDs to BirdDog employee numbers.
 * Stores: description → description, VIN last 4 → serialNumber,
 *         license plate → identifier, vehicle# → model, comments → notes.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundledPath = join(__dirname, "vehicles.json");

let vehicles: any[];
try {
  vehicles = JSON.parse(readFileSync(bundledPath, "utf-8"));
} catch {
  console.log("No vehicles.json found in server/, skipping vehicle seed.");
  process.exit(0);
}

// Check if vehicles already exist
const vehicleCount = sqlite
  .query("SELECT COUNT(*) as cnt FROM assets WHERE type = 'vehicle'")
  .get() as any;

const reseed = process.argv.includes("--reseed");
if (vehicleCount?.cnt > 0) {
  if (reseed) {
    console.log(`  Clearing ${vehicleCount.cnt} existing vehicles for reseed...`);
    sqlite.run("DELETE FROM assets WHERE type = 'vehicle'");
  } else {
    console.log(
      `Vehicles already seeded (${vehicleCount.cnt} rows), skipping.`
    );
    process.exit(0);
  }
}

console.log(`Seeding ${vehicles.length} vehicles...`);

// Get default company id (Pueblo Electrics)
const defaultCompany = sqlite.query("SELECT id FROM companies ORDER BY id LIMIT 1").get() as any;
const companyId = defaultCompany?.id || 1;

// Build employee lookup by employeeNumber → db id
const allEmployees = sqlite
  .query("SELECT id, employee_number FROM employees")
  .all() as any[];
const empLookup = new Map<string, number>();
for (const e of allEmployees) {
  empLookup.set(e.employee_number, e.id);
}

let inserted = 0;
let matched = 0;

for (const v of vehicles) {
  if (!v.description) continue;

  // Match employee
  let empId: number | null = null;
  if (v.employeeNumber && empLookup.has(v.employeeNumber)) {
    empId = empLookup.get(v.employeeNumber)!;
    matched++;
  }

  const status = v.status === "retired" ? "retired" : empId ? "assigned" : "available";

  sqlite.run(
    `INSERT INTO assets (type, category, description, manufacturer, model, serial_number, identifier, assigned_to_employee, status, condition, notes, company_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      "vehicle",
      categorizeVehicle(v.description),
      v.description,
      extractMake(v.description),
      v.cardDescription || `Vehicle ${v.vehicleId}`, // "Vehicle 88" etc.
      v.vinLast4 || null, // VIN last 4 in serial_number field
      v.licensePlate || null, // license plate in identifier field
      empId,
      status,
      "good",
      v.comments || null,
      companyId,
    ]
  );
  inserted++;
}

console.log(`\n✓ ${inserted} vehicles seeded`);
console.log(`  ${matched} assigned to employees`);

// ── Helpers ──────────────────────────────────────────────────────

function categorizeVehicle(desc: string): string {
  const d = desc.toLowerCase();
  if (/\b(van|transit|savana|exprs|express|e250|e350)\b/.test(d)) return "van";
  if (/\b(truck|trk|sierra|silverado|f-?150|f-?250|f-?350|f-?450|super duty|ram|crew|flatbed)\b/.test(d)) return "truck";
  if (/\b(suv|4runner|explorer|cherokee|rdx|acura)\b/.test(d)) return "suv";
  if (/\b(trailer|lift)\b/.test(d)) return "trailer";
  return "other";
}

function extractMake(desc: string): string | null {
  const d = desc.toLowerCase();
  if (/\b(ford)\b/.test(d)) return "Ford";
  if (/\b(gmc)\b/.test(d)) return "GMC";
  if (/\b(chev|chevy)\b/.test(d)) return "Chevrolet";
  if (/\b(dodge|ram)\b/.test(d)) return "Dodge";
  if (/\b(toyota)\b/.test(d)) return "Toyota";
  if (/\b(jeep)\b/.test(d)) return "Jeep";
  if (/\b(acura|rdx)\b/.test(d)) return "Acura";
  return null;
}
