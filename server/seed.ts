import { initDb, db, sqlite } from "./db.js";
import { users, companies, classifications, employees, jobs, jobBudgets, jurisdictions, jurisdictionRates, settings, jobAssignments } from "../shared/schema.js";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log("Initializing database...");
initDb();

// Check if already seeded
const userCount = sqlite.query("SELECT COUNT(*) as cnt FROM users").get() as any;
if (userCount?.cnt > 0) {
  console.log("Database already seeded, skipping.");
  process.exit(0);
}

// Load real PE data
const dataPath = join(__dirname, "pe-data.json");
const peData = JSON.parse(readFileSync(dataPath, "utf-8"));

console.log("Seeding Pueblo Electrics data...");

// ── Company ─────────────────────────────────────────────────────
const [peCompany] = db.insert(companies).values({ name: "Pueblo Electrics", shortName: "PE" }).returning().all();
const peCompanyId = peCompany.id;
console.log("✓ Company created: Pueblo Electrics");

// ── Settings ────────────────────────────────────────────────────
db.insert(settings).values({ companyId: peCompanyId, key: "companyName", value: "Pueblo Electrics" }).run();
db.insert(settings).values({ companyId: peCompanyId, key: "companyShort", value: "PE" }).run();
console.log("✓ Default settings created");

// ── Users ───────────────────────────────────────────────────────
const adminHash = bcrypt.hashSync("admin123", 10);
const jeremiahHash = bcrypt.hashSync("pueblo2026", 10);
const pmHash = bcrypt.hashSync("pm2026", 10);
const tiffanyHash = bcrypt.hashSync("pueblo2026", 10);

db.insert(users).values({ username: "admin", passwordHash: adminHash, displayName: "Admin", role: "admin", companyId: peCompanyId }).run();
db.insert(users).values({ username: "jeremiah", passwordHash: jeremiahHash, displayName: "Jeremiah", role: "super_admin", companyId: peCompanyId }).run();
db.insert(users).values({ username: "pm", passwordHash: pmHash, displayName: "Project Manager", role: "pm", companyId: peCompanyId }).run();
db.insert(users).values({ username: "tiffanytrice", passwordHash: tiffanyHash, displayName: "Tiffany Trice", role: "pm", companyId: peCompanyId }).run();
console.log("✓ 4 users created (jeremiah = super_admin)");

// ── Classifications ─────────────────────────────────────────────
const classMap = new Map<string, number>();
const colors: Record<string, string> = {
  'Electrical': '#2563eb',
  'Low Voltage': '#7c3aed',
  'Solar': '#f59e0b',
  'Office': '#6b7280',
  'General': '#059669',
};

// Auto-assign classification groups based on name prefix
function inferGroup(name: string): string | null {
  const n = name.toLowerCase();
  if (n.startsWith("ap-") || n.startsWith("ap ")) return "Apprentice";
  if (n.startsWith("ce-") || n.startsWith("ce ")) return "CE";
  if (n.startsWith("cw-") || n.startsWith("cw ")) return "CW";
  if (n.startsWith("si-") || n.startsWith("si ")) return "SI";
  if (n === "jw") return "JW";
  if (n === "f" || n === "gf") return "Foreman";
  if (n.startsWith("vdv")) return "VDV";
  if (n.startsWith("off")) return "Office";
  return null;
}

for (const c of peData.classifications) {
  const [row] = db.insert(classifications).values({
    companyId: peCompanyId,
    name: c.name,
    department: c.department,
    classificationGroup: inferGroup(c.name),
    hasLicense: c.hasLicense,
    color: colors[c.department] || '#3b82f6',
  }).returning().all();
  classMap.set(c.name, row.id);
}
console.log(`✓ ${classMap.size} classifications created`);

// ── Jurisdictions ───────────────────────────────────────────────
const jurMap = new Map<number, number>(); // localNum → db id

for (const j of peData.jurisdictions) {
  const [row] = db.insert(jurisdictions).values({
    companyId: peCompanyId,
    name: j.name,
    description: `IBEW Local ${j.localNum} jurisdiction rates`,
  }).returning().all();
  jurMap.set(j.localNum, row.id);
}
console.log(`✓ ${jurMap.size} jurisdictions created`);

// ── Jurisdiction Rates ──────────────────────────────────────────
let rateCount = 0;
for (const r of peData.jurisdictionRates) {
  const classId = classMap.get(r.classificationName);
  const jurId = jurMap.get(r.localNum);
  if (!classId || !jurId) continue;

  db.insert(jurisdictionRates).values({
    companyId: peCompanyId,
    jurisdictionId: jurId,
    classificationId: classId,
    hourlyRate: r.hourlyRate,
    totalCostRate: r.totalCostRate,
  }).run();
  rateCount++;
}
console.log(`✓ ${rateCount} jurisdiction rates created`);

// ── Employees ───────────────────────────────────────────────────
const empMap = new Map<string, number>(); // employeeNumber → db id
let empCount = 0;
for (const e of peData.employees) {
  const classId = e.classificationName ? classMap.get(e.classificationName) : null;

  const [row] = db.insert(employees).values({
    companyId: peCompanyId,
    employeeNumber: e.employeeNumber,
    firstName: e.firstName || "Unknown",
    lastName: e.lastName || "Unknown",
    classificationId: classId || null,
    status: e.status,
    phone: e.phone,
    pePhone: e.pePhone || null,
    personalEmail: e.personalEmail || null,
    workEmail: e.workEmail || null,
    address: e.address,
    dateOfHire: e.dateOfHire,
    dateOfBirth: e.dateOfBirth,
    placeOfBirth: e.placeOfBirth || null,
    shirtSize: e.shirtSize,
    jacketSize: e.jacketSize || null,
    elecLicense: e.elecLicense || null,
    dlNumber: e.dlNumber,
    backgroundCheck: e.backgroundCheck || null,
    backgroundCheckDate: e.backgroundCheckDate || null,
    reasonForLeaving: e.reasonForLeaving || null,
  }).returning().all();
  empMap.set(e.employeeNumber, row.id);
  empCount++;
}
console.log(`✓ ${empCount} employees created`);

// ── Jobs ────────────────────────────────────────────────────────
const jobMap = new Map<string, number>(); // jobNumber → db id
let jobCount = 0;
for (const j of peData.jobs) {
  const jurId = j.localNum ? jurMap.get(j.localNum) : null;
  const addr = [j.address, j.city, j.state].filter(Boolean).join(", ") || null;

  const [row] = db.insert(jobs).values({
    companyId: peCompanyId,
    jobNumber: j.jobNumber,
    name: j.name,
    address: addr,
    jurisdictionId: jurId || null,
    status: j.status,
  }).returning().all();
  jobMap.set(j.jobNumber, row.id);

  // Create budget categories for each job
  const categories = ["labor", "material", "equipment", "general", "subcontract"] as const;
  for (const cat of categories) {
    db.insert(jobBudgets).values({ jobId: row.id, category: cat }).run();
  }
  jobCount++;
}
console.log(`✓ ${jobCount} jobs created`);

// ── Job Assignments ─────────────────────────────────────────────
let assignCount = 0;
if (peData.assignments) {
  for (const a of peData.assignments) {
    const empId = empMap.get(a.employeeNumber);
    const jobId = jobMap.get(a.jobNumber);
    if (empId && jobId) {
      db.insert(jobAssignments).values({
        jobId,
        employeeId: empId,
        isActive: true,
      }).run();
      assignCount++;
    }
  }
}
console.log(`✓ ${assignCount} job assignments created`);

console.log("\n🐕 Pueblo Electrics data seeded successfully!");
console.log(`   ${classMap.size} classifications | ${jurMap.size} jurisdictions | ${rateCount} rates`);
console.log(`   ${empCount} employees | ${jobCount} jobs | ${assignCount} assignments`);
