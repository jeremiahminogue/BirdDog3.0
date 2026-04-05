import { sqlite } from "./db.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Seed tools from Milwaukee OneKey export (XLSX → JSON).
 * Run: bun server/seed-tools.ts
 *
 * Categorizes tools by DESCRIPTION (not OneKey department category).
 * Matches "Person" field to employees by first+last name with fuzzy matching.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundledPath = join(__dirname, "onekey-tools.json");

let tools: any[];
try {
  tools = JSON.parse(readFileSync(bundledPath, "utf-8"));
} catch {
  console.log("No onekey-tools.json found in server/, skipping tool seed.");
  process.exit(0);
}

// Check if already seeded — pass --reseed to clear and re-import
const reseed = process.argv.includes("--reseed");
const assetCount = sqlite.query("SELECT COUNT(*) as cnt FROM assets").get() as any;
if (assetCount?.cnt > 0) {
  if (reseed) {
    console.log(`  Clearing ${assetCount.cnt} existing assets for reseed...`);
    sqlite.run("DELETE FROM assets");
  } else {
    console.log(`Assets table already has ${assetCount.cnt} rows, skipping tool seed.`);
    process.exit(0);
  }
}

console.log(`Seeding ${tools.length} tools from OneKey export...`);

// Get default company id
const defaultCompany = sqlite.query("SELECT id FROM companies ORDER BY id LIMIT 1").get() as any;
const companyId = defaultCompany?.id || 1;

// Build employee lookup by name (lowercase "first last" → id)
// Prefer active employees when there are duplicates
const allEmployees = sqlite.query("SELECT id, first_name, last_name, status FROM employees").all() as any[];
const empLookup = new Map<string, number>();
const empStatus = new Map<string, string>();
for (const e of allEmployees) {
  const key = `${e.first_name} ${e.last_name}`.toLowerCase().trim();
  const existingStatus = empStatus.get(key);
  // If we haven't seen this name, or the new one is active and old one isn't, use the new one
  if (!empLookup.has(key) || (e.status === "active" && existingStatus !== "active")) {
    empLookup.set(key, e.id);
    empStatus.set(key, e.status);
  }
}
console.log(`  ${empLookup.size} employees available for matching`);

// ── DESCRIPTION-BASED CATEGORY MAPPING ──────────────────────────
// Instead of using the OneKey "department" category (e.g. "Electrical" for 551 tools),
// we categorize by what the tool actually IS based on the description.

function categorizeByDescription(desc: string, onekeyCategory: string | null): string {
  const d = (desc || "").toLowerCase();
  const cat = (onekeyCategory || "").toLowerCase().trim();

  // ── Testing / Measurement ──
  if (/\b(megger|insulation tester|circuit tracer|circuit seeker|circuit mapper|earth.*tester|ground.*tester|energy analyzer|recording meter|rotation meter|phase rotation|motor.*rotation|toner|ethernet.*tester|cable tester|trimble|gps equipment?)\b/.test(d)) return "testing";
  if (/\b(laser level|laser)\b/.test(d) && !/\bcutter\b/.test(d)) return "testing";
  if (/\btorque screwdriver\b/.test(d)) return "testing";
  if (cat === "leveling") return "testing";

  // ── Safety ──
  if (/\b(yo-?yo|lanyard|retractable|fall protection|harness)\b/.test(d)) return "safety";
  if (/\b(dust extractor|dust collection)\b/.test(d)) return "safety";
  if (cat === "fall protection" || cat === "containment") return "safety";

  // ── Specialty electrical tools ──
  // Tuggers, knockout sets, threading, bending, fish tape, pulling, press tools, fusion
  if (/\b(tugger|floor tugger|drill tugger)\b/.test(d)) return "specialty";
  if (/\b(knock\s?out|knockout)\b/.test(d)) return "specialty";
  if (/\b(threader|threading|pipe thread)\b/.test(d)) return "specialty";
  if (/\b(bender|bending|pvc.*heater)\b/.test(d)) return "specialty";
  if (/\b(fish\s?tape|fishing system|puller|pulling|angler)\b/.test(d)) return "specialty";
  if (/\b(press tool|press jaw|forcelogic|force logic)\b/.test(d)) return "specialty";
  if (/\b(fiber termination|opticam|unicam)\b/.test(d)) return "specialty";
  if (/\b(cable strip\w*|cable cutter|gator cutter|gator cable|crimper|dieless crimper|cable.*cutter)\b/.test(d)) return "specialty";
  if (/\b(shotgun|powder actuated|ramset|\.27\s*(cal|powder)|actuated tool)\b/.test(d)) return "specialty";
  if (/\b(smoke detector pole)\b/.test(d)) return "specialty";
  if (/\b(ground rod driver)\b/.test(d)) return "specialty";
  if (/\b(locator|wire.*locator)\b/.test(d)) return "specialty";
  if (/\b(ultrashot|fusion)\b/.test(d)) return "specialty";
  if (/\b(hv term prep|term prep kit)\b/.test(d)) return "specialty";
  if (/\b(water management)\b/.test(d)) return "specialty";
  if (/\b(vacuum pump.*coring)\b/.test(d)) return "specialty";
  if (/\b(crimp tool|ez-rj)\b/.test(d)) return "specialty";
  if (/\b(max-lok|maxlok)\b/.test(d)) return "specialty";
  if (/\b(welder|welding)\b/.test(d)) return "power_tool";
  if (cat === "knockout" || cat === "bending" || cat === "crimping" || cat === "fusion") return "specialty";

  // ── Rigging / Lifting → specialty ──
  if (/\b(chain hoist|lever hoist|hook sheave|sheave|swivel|rigging|pallet jack|pallet truck|all jack)\b/.test(d)) return "specialty";
  if (/\b(pulling rope|rope|chinese finger)\b/.test(d)) return "specialty";
  if (/\b(reel stand|screw.type reel)\b/.test(d)) return "specialty";
  if (cat === "rigging/lifting") return "specialty";

  // ── Power tools ── (battery/corded)
  if (/\b(impact driver|impact wrench|hammer\s?drill|hammerdrill|drill\/?driver|drill motor|hole.hawg|rotary hammer|sds\s?(plus|max))\b/.test(d)) return "power_tool";
  if (/\b(sawzall|hackzall|recip saw|band saw|bandsaw|circular saw|jig\s?saw|metal.*saw|cut.?off|metal cutting|compact band|deep cut)\b/.test(d)) return "power_tool";
  if (/\b(grinder|die grinder|braking grinder)\b/.test(d)) return "power_tool";
  if (/\b(core drill(?! stand))\b/.test(d)) return "power_tool";
  if (/\b(multi.tool|dremel|rotary tool)\b/.test(d)) return "power_tool";
  if (/\b(pvc shear|stapler|cable stapler|soldering iron|installation drill)\b/.test(d)) return "power_tool";
  if (/\b(chainsaw|demo saw)\b/.test(d)) return "power_tool";
  if (/\b(threaded rod cutter)\b/.test(d)) return "power_tool";
  if (/\b(heat gun)\b/.test(d)) return "power_tool";
  if (/\b(magnum drill)\b/.test(d)) return "power_tool";
  if (/\b(compact cut off)\b/.test(d)) return "power_tool";
  if (/\bm1[28]\b.*\b(fuel|brushless)?\b/.test(d) && /\b(drill|driver|saw|hammer|grinder|cutter|shear|stapler)\b/.test(d)) return "power_tool";
  if (cat === "drill/fastening" || cat === "cutting" || cat === "grinding" || cat === "torquing") return "power_tool";

  // ── Hand tools ──
  if (/\b(hand bender|mechanical bender|wiremold bender|chicago bender)\b/.test(d)) return "hand_tool";
  if (/\b(socket set|tap & die|tap and die|insul?ated tool set|insolated tool set)\b/.test(d)) return "hand_tool";
  if (/\b(tubing cutter|copper.*cutter|ratchet cable cutter\w*)\b/.test(d)) return "hand_tool";
  if (/\b(tri-?vice)\b/.test(d)) return "hand_tool";
  if (/\b(deck punch|punch & die|punch and die|2 1\/2.*punch|draw stud)\b/.test(d)) return "hand_tool";
  if (/\b(exact.*die|exact.*punch|exact.*stud|die set|k22.*die|adaptor.*punch|punch.*adaptor)\b/.test(d)) return "hand_tool";

  // ── Other (support equipment, accessories, storage, lighting, etc.) ──
  if (/\b(flood light|tower light|rocket.*light|rover)\b/.test(d)) return "other";
  if (/\b(generator|5\.?0kw|5k generator)\b/.test(d)) return "other";
  if (/\b(heater|torpedo heater|fan|jobsite fan)\b/.test(d)) return "other";
  if (/\b(vacuum|wet\/?dry)\b/.test(d) && !/\bfishing\b/.test(d)) return "other";
  if (/\b(charger|charge station|battery pack|battery$|batteries)\b/.test(d)) return "other";
  if (/\b(gang box|clam shell|storage|connex)\b/.test(d)) return "other";
  if (/\b(key$|keys)\b/.test(d)) return "other";
  if (/\b(labeler|label maker)\b/.test(d)) return "other";
  if (/\b(ladder|extension ladder|skyscraper)\b/.test(d)) return "other";
  if (/\b(grease gun|tire inflator|transfer pump)\b/.test(d)) return "other";
  if (/\b(hepa filter|blower(?!.*fish))\b/.test(d)) return "other";
  if (/\b(core drill stand)\b/.test(d)) return "other";
  if (cat === "lighting" || cat === "heating & cooling" || cat === "cleaning" || cat === "charging") return "other";
  if (cat === "storage" || cat === "transportation" || cat === "ladders" || cat === "keys") return "other";
  if (cat === "label making" || cat === "vacuum/blower") return "other";

  // ── Fallback: use OneKey category if description didn't match ──
  if (cat === "electrical" || cat === "data" || cat === "service" || cat === "fab") {
    // These are department names, not tool types. For remaining unmatched tools,
    // check if it looks like a power tool by model number pattern
    if (/\bm1[28]\b/.test(d)) return "power_tool";
    if (/\bgen 4\b/.test(d)) return "power_tool";
    return "other";
  }

  return "other";
}

// Parse date from "MM/DD/YYYY" to "YYYY-MM-DD"
function parseDate(d: string | null): string | null {
  if (!d) return null;
  const parts = d.split("/");
  if (parts.length !== 3) return null;
  const [m, day, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Levenshtein distance for fuzzy name matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Normalize a name by stripping all punctuation and spaces for deep comparison
function normalize(s: string): string {
  return s.replace(/[^a-z]/g, "");
}

// Match person name to employee — handles nicknames, typos, extra spaces, D'Angelo→DeAngelo
function matchEmployee(person: string | null): number | null {
  if (!person) return null;
  const cleaned = person.trim().toLowerCase().replace(/[\u2018\u2019'']/g, "'").replace(/\s+/g, " ");

  // Skip known non-person entries
  if (cleaned === "ark valley") return null;

  // Direct match
  if (empLookup.has(cleaned)) return empLookup.get(cleaned)!;

  const parts = cleaned.split(" ");
  if (parts.length < 2) return null;
  const pFirst = parts[0];
  const pLast = parts.slice(1).join(" ");

  // Common short name → full name mappings
  const nicknames: Record<string, string[]> = {
    "josh": ["joshua"], "ray": ["raymond"], "ben": ["benjamin"],
    "mike": ["michael"], "nick": ["nicholas"], "matt": ["matthew"],
    "nate": ["nathan", "nathaniel"], "gabe": ["gabriel"],
    "wes": ["wesley"], "jon": ["jonathan"], "gus": ["augustine", "gustavo"],
    "brad": ["bradley"], "colin": ["collin"],
  };

  // Normalize for deep matching (strips ALL non-alpha chars)
  const pNorm = normalize(pFirst + pLast);

  for (const [key, id] of empLookup.entries()) {
    const eParts = key.split(" ");
    if (eParts.length < 2) continue;
    const eFirst = eParts[0];
    const eLast = eParts.slice(1).join(" ");

    // ── Deep normalized match (catches D'Angelo→DeAngelo, O' Seasnain→O'Seasnain) ──
    const eNorm = normalize(eFirst + eLast);
    if (pNorm === eNorm) return id;

    // ── Exact last name + first name starts with or nickname ──
    if (eLast === pLast && eFirst.startsWith(pFirst)) return id;
    if (eLast === pLast && pFirst.startsWith(eFirst)) return id;

    // Nickname matching
    const pNicks = nicknames[pFirst] || [];
    const eNicks = nicknames[eFirst] || [];
    if (eLast === pLast && (pNicks.includes(eFirst) || eNicks.includes(pFirst))) return id;

    // ── Last name fuzzy via Levenshtein (catches Conteras→Contreras, Riffel→Riffle, Solice→Solis) ──
    if (eFirst[0] === pFirst[0] && eLast.length > 3 && pLast.length > 3) {
      const dist = levenshtein(eLast, pLast);
      if (dist <= 2) return id;
    }

    // Also try Levenshtein on full normalized names for broader catches
    if (eNorm.length > 6 && pNorm.length > 6) {
      const dist = levenshtein(eNorm, pNorm);
      if (dist <= 2) return id;
    }

    // Last name match + first initial
    if (eLast === pLast && eFirst[0] === pFirst[0]) return id;

    // ── Hyphenated / multi-part last name ──
    if (eLast.includes("-") && eLast.startsWith(pLast) && eFirst[0] === pFirst[0]) return id;
    if (pLast.includes("-") && pLast.startsWith(eLast) && eFirst[0] === pFirst[0]) return id;
    if (eLast.includes(" ") && eLast.startsWith(pLast) && eFirst === pFirst) return id;
    if (eFirst === pFirst && eLast.includes(pLast) && pLast.length > 3) return id;

    // Collapse spaces/punctuation in last name
    const eLnClean = eLast.replace(/[\s'\-]/g, "");
    const pLnClean = pLast.replace(/[\s'\-]/g, "");
    if (eLnClean === pLnClean && eFirst[0] === pFirst[0]) return id;
  }

  return null;
}

let inserted = 0;
let matched = 0;
let unmatched = new Set<string>();
const categoryCounts: Record<string, number> = {};

for (const t of tools) {
  const empId = matchEmployee(t.person);
  if (t.person && empId) matched++;
  if (t.person && !empId) unmatched.add(t.person);

  const status = empId ? "assigned" : "available";
  const category = categorizeByDescription(t.description || "", t.category);
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;

  sqlite.run(
    `INSERT INTO assets (type, category, description, manufacturer, model, serial_number, identifier, assigned_to_employee, status, condition, purchase_date, purchase_cost, notes, company_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      "tool",
      category,
      t.description ? t.description.replace(/\uFFFC/g, "").trim() : "Unknown Tool",
      t.manufacturer ? t.manufacturer.replace("®", "").replace("™", "").replace(/\uFFFC/g, "").trim() : null,
      t.model || null,
      t.serialNumber || null,
      t.toolNumber || t.barcode || null,
      empId,
      status,
      "good",
      parseDate(t.purchaseDate),
      t.value ? parseFloat(t.value) || null : null,
      t.notes || null,
      companyId,
    ]
  );
  inserted++;
}

console.log(`\n✓ ${inserted} tools seeded`);
console.log(`  ${matched} matched to employees`);
console.log(`\n  Category breakdown:`);
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${cat}: ${count}`);
}
if (unmatched.size > 0) {
  console.log(`\n  ${unmatched.size} people not matched:`);
  for (const name of [...unmatched].sort()) {
    console.log(`    - ${name}`);
  }
}
