import { db, sqlite } from "./db.js";
import { jobTemplates, templateItems, companies } from "../shared/schema.js";
import { eq, sql } from "drizzle-orm";

/**
 * Seed default job templates if none exist yet.
 * Safe to call on every boot — skips if templates are already present.
 */
export async function seedTemplates() {
  const existing = await db.select({ count: sql<number>`count(*)` }).from(jobTemplates);
  if (existing[0].count > 0) return; // already seeded

  // Get default company id
  const defaultCompany = sqlite.query("SELECT id FROM companies ORDER BY id LIMIT 1").get() as any;
  const companyId = defaultCompany?.id || 1;

  console.log("  Seeding default job templates…");

  // ── Template 1: New Commercial Job ──────────────────────────
  const [commercial] = await db.insert(jobTemplates).values({
    name: "New Commercial Job",
    description: "Standard checklist for new commercial electrical projects",
    companyId,
  }).returning();

  const commercialItems = [
    { description: "Contract execution & signed copies distributed",  priority: "urgent" as const,  assignedTo: "PM",    sortOrder: 1 },
    { description: "Certificate of Insurance (COI) submitted to GC",  priority: "urgent" as const,  assignedTo: "Admin",  sortOrder: 2 },
    { description: "Bond requirements reviewed & secured (if req'd)", priority: "high" as const,    assignedTo: "PM",    sortOrder: 3 },
    { description: "Building permit application submitted",           priority: "high" as const,    assignedTo: "PM",    sortOrder: 4 },
    { description: "Electrical permit application submitted",         priority: "high" as const,    assignedTo: "PM",    sortOrder: 5 },
    { description: "Submittal routing / shop drawings started",       priority: "high" as const,    assignedTo: "PM",    sortOrder: 6 },
    { description: "Site-specific safety plan created",               priority: "high" as const,    assignedTo: "Safety", sortOrder: 7 },
    { description: "Material procurement & lead-time tracking",       priority: "high" as const,    assignedTo: "PM",    sortOrder: 8 },
    { description: "Temporary power plan & service coordination",     priority: "normal" as const,  assignedTo: "Foreman", sortOrder: 9 },
    { description: "Pre-construction meeting scheduled",              priority: "normal" as const,  assignedTo: "PM",    sortOrder: 10 },
    { description: "Project schedule review with GC",                 priority: "normal" as const,  assignedTo: "PM",    sortOrder: 11 },
    { description: "As-built drawing tracking set up",                priority: "normal" as const,  assignedTo: "PM",    sortOrder: 12 },
    { description: "Job cost codes & budget loaded",                  priority: "normal" as const,  assignedTo: "PM",    sortOrder: 13 },
    { description: "Tooling & equipment needs assessed",              priority: "normal" as const,  assignedTo: "Foreman", sortOrder: 14 },
    { description: "Labor manpower plan / crew sizing",               priority: "normal" as const,  assignedTo: "PM",    sortOrder: 15 },
    { description: "Sub-contractor scope letters sent",               priority: "normal" as const,  assignedTo: "PM",    sortOrder: 16 },
    { description: "Utility coordination (power company, tel/data)",  priority: "normal" as const,  assignedTo: "PM",    sortOrder: 17 },
    { description: "Jobsite logistics & laydown area confirmed",      priority: "low" as const,     assignedTo: "Foreman", sortOrder: 18 },
    { description: "Owner / architect contact info logged",           priority: "low" as const,     assignedTo: "Admin",  sortOrder: 19 },
    { description: "Change order log initialized",                    priority: "low" as const,     assignedTo: "PM",    sortOrder: 20 },
  ];

  for (const item of commercialItems) {
    await db.insert(templateItems).values({ templateId: commercial.id, ...item });
  }

  // ── Template 2: Service / T&M Job ───────────────────────────
  const [service] = await db.insert(jobTemplates).values({
    name: "Service / T&M Job",
    description: "Quick-start checklist for service calls and time-and-material work",
    companyId,
  }).returning();

  const serviceItems = [
    { description: "Work authorization / PO received",        priority: "urgent" as const, assignedTo: "PM",     sortOrder: 1 },
    { description: "COI submitted to customer",               priority: "high" as const,   assignedTo: "Admin",  sortOrder: 2 },
    { description: "Scope of work documented",                priority: "high" as const,   assignedTo: "PM",     sortOrder: 3 },
    { description: "Material list & procurement",             priority: "normal" as const, assignedTo: "Foreman", sortOrder: 4 },
    { description: "Crew & schedule assigned",                priority: "normal" as const, assignedTo: "PM",     sortOrder: 5 },
    { description: "Daily T&M tickets / sign-off process set up", priority: "normal" as const, assignedTo: "Foreman", sortOrder: 6 },
    { description: "Billing rate sheet confirmed with customer",  priority: "normal" as const, assignedTo: "PM",     sortOrder: 7 },
  ];

  for (const item of serviceItems) {
    await db.insert(templateItems).values({ templateId: service.id, ...item });
  }

  // ── Template 3: Residential Job ─────────────────────────────
  const [residential] = await db.insert(jobTemplates).values({
    name: "Residential New Construction",
    description: "Checklist for residential new-build electrical work",
    companyId,
  }).returning();

  const residentialItems = [
    { description: "Contract / proposal signed",               priority: "urgent" as const, assignedTo: "PM",     sortOrder: 1 },
    { description: "Electrical permit pulled",                 priority: "high" as const,   assignedTo: "PM",     sortOrder: 2 },
    { description: "Panel schedule & load calc completed",     priority: "high" as const,   assignedTo: "PM",     sortOrder: 3 },
    { description: "Lighting plan & fixture selections confirmed", priority: "normal" as const, assignedTo: "PM", sortOrder: 4 },
    { description: "Rough-in material ordered",                priority: "normal" as const, assignedTo: "Foreman", sortOrder: 5 },
    { description: "Rough-in inspection scheduled",            priority: "normal" as const, assignedTo: "Foreman", sortOrder: 6 },
    { description: "Trim-out material ordered",                priority: "normal" as const, assignedTo: "Foreman", sortOrder: 7 },
    { description: "Final inspection scheduled",               priority: "normal" as const, assignedTo: "Foreman", sortOrder: 8 },
    { description: "Homeowner walk-through & panel labeling",  priority: "low" as const,    assignedTo: "Foreman", sortOrder: 9 },
  ];

  for (const item of residentialItems) {
    await db.insert(templateItems).values({ templateId: residential.id, ...item });
  }

  console.log("  ✓ Seeded 3 job templates with items");
}
