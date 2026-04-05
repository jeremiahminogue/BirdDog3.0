#!/usr/bin/env python3
"""
A-Systems Comprehensive Job Summary PDF Parser
Reads a multi-page job summary report (one job per page) and outputs JSON.

Only extracts HARD ACTUALS — calculated/projected values are left for
BirdDog to compute dynamically from the imported data.

Report structure per page:
  - Header: job number + job name
  - Profitability section  → revised contract price, percent complete
  - Cost vs Billed section → billed to date, cost to date
  - Earned vs Billed       → earned to date
  - Cash Position          → received to date, paid out to date
  - Job Break Down table   → per-category: pct complete, orig budget, curr budget, cost to date

Usage: python3 parse-summary.py <path-to-pdf>
Output: JSON array of job records
"""

import sys
import re
import json
import logging

logging.getLogger("pdfplumber.page").setLevel(logging.ERROR)

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed. Run: pip install pdfplumber"}), file=sys.stdout)
    sys.exit(1)

if len(sys.argv) < 2:
    print(json.dumps({"error": "Usage: python3 parse-summary.py <pdf-path>"}), file=sys.stdout)
    sys.exit(1)

pdf_path = sys.argv[1]
debug_mode = "--debug" in sys.argv


def parse_number(s):
    """Parse a number string, handling commas, negatives, percentages."""
    if s is None:
        return None
    s = s.strip()
    if s in ("", "—", "-", "N/A"):
        return None
    s = s.replace("%", "")
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    s = s.replace(",", "").replace("$", "").replace(" ", "")
    try:
        return float(s)
    except ValueError:
        return None


def extract_all_numbers(line):
    """Extract all numbers from a line (handles negatives and commas)."""
    nums = re.findall(r'-?\d[\d,]*\.?\d*', line)
    return [parse_number(n) for n in nums]


def parse_job_page(text):
    """Parse a single job's page text into a record dict (actuals only)."""
    lines = text.splitlines()
    record = {}

    # ── Find job number and name ──
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r'^\d{3,6}$', stripped):
            record["jobNumber"] = stripped
            if i + 1 < len(lines):
                record["jobName"] = lines[i + 1].strip()
            break

    if "jobNumber" not in record:
        return None

    # ── All section parsing uses case-insensitive matching ──
    for line in lines:
        low = line.lower()

        # Profitability
        if "revised contract price" in low:
            nums = extract_all_numbers(line)
            if nums:
                record["revisedContractPrice"] = nums[-1]
        # Percent Complete — PDF shows "Times 98.72% Yields" (not "percent complete")
        if "times" in low and "yields" in low:
            m = re.search(r'times\s+([\d,.]+)%', low)
            if m:
                val = parse_number(m.group(1))
                if val is not None and 0 <= abs(val) <= 100:
                    record["percentComplete"] = val
        # Fallback: "Percent Complete" or "% Complete" (some report versions)
        elif ("percent" in low and "complete" in low) or ("% complete" in low):
            nums = extract_all_numbers(line)
            for n in nums:
                if n is not None and 0 <= abs(n) <= 100:
                    record["percentComplete"] = n
                    break

        # Cost vs Billed — PDF puts both on one line:
        #   "Billed to Date: 8,207,560.28 Cost to Date: 8,947,645.27"
        # Use regex to extract number immediately after each label
        if "billed to date" in low:
            m = re.search(r'billed to date:\s*([\d,.$()-]+)', line, re.IGNORECASE)
            if m:
                val = parse_number(m.group(1))
                if val is not None:
                    record["billedToDate"] = val
        if "cost to date" in low and "subtract" not in low:
            # Only from Cost vs Billed section, not category breakdown or subtract lines
            m = re.search(r'cost to date:\s*([\d,.$()-]+)', line, re.IGNORECASE)
            if m:
                val = parse_number(m.group(1))
                if val is not None and "costToDate" not in record:
                    record["costToDate"] = val

        # Earned vs Billed
        if "earned to date" in low:
            m = re.search(r'earned to date:\s*([\d,.$()-]+)', line, re.IGNORECASE)
            if m:
                val = parse_number(m.group(1))
                if val is not None:
                    record["earnedToDate"] = val

        # Cash Position
        # PDF layout:
        #   "Received to Date: 8,177,100.24 Paid Out to Date:"        ← paid out may be EMPTY here
        #   "(Subtract) Paid Out to Date: (Subtract) Received to Date: 8,177,100.24"  ← wrong line
        #   "Positive Cash Flow: 8,177,100.24 Negative Cash Flow: 0.00"
        # Strategy: extract received and paid-out via regex after the label colon
        if "received to date" in low and "subtract" not in low:
            m = re.search(r'received to date:\s*([\d,.$()-]+)', line, re.IGNORECASE)
            if m:
                val = parse_number(m.group(1))
                if val is not None:
                    record["receivedToDate"] = val
        if ("paid out to date" in low or "paid-out to date" in low or "paidout to date" in low) and "subtract" not in low:
            m = re.search(r'paid[- ]?out to date:\s*([\d,.$()-]+)', line, re.IGNORECASE)
            if m:
                val = parse_number(m.group(1))
                if val is not None:
                    record["paidOutToDate"] = val

    # ── Job Break Down table (actuals only — no projected/variance) ──
    categories = {
        "Labor": "labor",
        "Material": "material",
        "Subcontract": "subcontract",
        "Equipment": "equipment",
        "General": "general",
    }

    for line in lines:
        stripped = line.strip()
        for cat_name, cat_key in categories.items():
            if stripped.startswith(cat_name) and not stripped.startswith(cat_name + "s"):
                nums = extract_all_numbers(stripped[len(cat_name):])
                if len(nums) >= 5:
                    # Columns: pct_complete, budget_pct, original, current, to_date, ...
                    record[f"{cat_key}PctComplete"] = nums[0]
                    record[f"{cat_key}OrigBudget"] = nums[2]  # skip budget%
                    record[f"{cat_key}CurrBudget"] = nums[3]
                    record[f"{cat_key}CostToDate"] = nums[4]
                break

    return record


# ── Main ──
records = []

try:
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            if "Comprehensive Job Summary" not in text and "Job Break Down" not in text:
                continue
            if debug_mode:
                # Dump raw text for first page to stderr so we can see what pdfplumber extracts
                print(f"=== PAGE {page.page_number} RAW TEXT ===", file=sys.stderr)
                print(text, file=sys.stderr)
                print("=== END PAGE ===", file=sys.stderr)
            result = parse_job_page(text)
            if result and "jobNumber" in result:
                records.append(result)

except Exception as e:
    print(json.dumps({"error": f"Failed to parse PDF: {str(e)}"}), file=sys.stdout)
    sys.exit(1)

print(json.dumps(records))
