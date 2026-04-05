/**
 * Convert Milwaukee OneKey XLSX export to JSON for seeding.
 * Run at build time: bun server/convert-onekey.ts
 *
 * Reads: server/onekey-export.xlsx
 * Writes: data/onekey-tools.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const xlsxPath = join(__dirname, "onekey-export.xlsx");
const dataDir = process.env.DB_PATH ? dirname(process.env.DB_PATH) : join(__dirname, "..", "data");
const outPath = join(dataDir, "onekey-tools.json");

if (!existsSync(xlsxPath)) {
  console.log("No onekey-export.xlsx found, skipping conversion.");
  process.exit(0);
}

mkdirSync(dataDir, { recursive: true });

// Use Bun's built-in XLSX reading via SheetJS (bundled with Bun)
// We'll parse the file manually since Bun doesn't bundle SheetJS.
// Instead, parse the XLSX using a minimal approach with the xlsx npm package.

let XLSX: any;
try {
  XLSX = require("xlsx");
} catch {
  console.log("xlsx package not available, trying alternative...");
  process.exit(0);
}

const workbook = XLSX.readFile(xlsxPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// Find header row (first row with "Manufacturer*")
let headerIdx = 0;
for (let i = 0; i < Math.min(5, raw.length); i++) {
  if (raw[i]?.some((cell: any) => String(cell).includes("Manufacturer"))) {
    headerIdx = i;
    break;
  }
}

const headers = raw[headerIdx].map((h: any) => String(h || "").trim());
const rows = raw.slice(headerIdx + 1);

const tools = rows
  .filter((row: any[]) => row[0] || row[1]) // skip empty rows
  .map((row: any[]) => {
    const get = (name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 && row[idx] != null ? String(row[idx]).trim() : null;
    };
    const getNum = (name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 && row[idx] != null ? Number(row[idx]) || null : null;
    };

    return {
      manufacturer: get("Manufacturer*"),
      description: get("Description*"),
      model: get("Model #*"),
      category: get("Category"),
      person: get("Person"),
      toolNumber: get("Tool number"),
      serialNumber: get("Serial #"),
      purchaseDate: get("Purchase date"),
      value: getNum("Value"),
      notes: get("Notes"),
      barcode: get("Barcode"),
      place: get("Place"),
      status: get("Status"),
    };
  });

writeFileSync(outPath, JSON.stringify(tools, null, 2));
console.log(`✓ Converted ${tools.length} tools from OneKey export to ${outPath}`);
