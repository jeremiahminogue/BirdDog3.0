"""
Seed opportunities from Projects Bidding.xlsx into SQLite.
Run: python3 server/seed-opportunities.py [path-to-xlsx] [path-to-db]
"""
import sys, re, json, sqlite3
import pandas as pd
from collections import Counter
from pathlib import Path

XLSX = sys.argv[1] if len(sys.argv) > 1 else "Projects Bidding.xlsx"
DB   = sys.argv[2] if len(sys.argv) > 2 else "data/pe-mgmt.db"

# ─── GC COMPANY NAME NORMALIZATION ───────────────────────────────────────────

GC_MERGE = {
    "B&M": "B&M Construction",
    "B&M Construction Barbara Myrick": "B&M Construction",
    "B&M Construction, Inc": "B&M Construction",
    "B & M Construction": "B&M Construction",
    "Houston": "HW Houston",
    "HW Houston Construction": "HW Houston",
    "Houston Nunn": "HW Houston / Nunn Construction",
    "NUNN": "Nunn Construction",
    "Nunn": "Nunn Construction",
    "Nunn Construction,Inc": "Nunn Construction",
    "IS West": "IS West Inc.",
    "IS West Inc": "IS West Inc.",
    "iicon": "iicon Construction",
    "Vision": "Vision Mechanical",
    "HE Whitlock": "Whitlock",
    "HE Whitlock Construction": "Whitlock",
    "Rocky Mnt. ATS": "ATS Rocky Mountain",
    "Rocky Mtn. ATS": "ATS Rocky Mountain",
    "Happel Associates": "Happel Associates Commercial Builders",
    "GH Phipps Construction": "GH Phipps",
    "Pueblo School District #60": "Pueblo School District 60",
    "Deployed Global Solutions": "Deployed Global Solutions LLC",
    "Arc Valley Construction": "Arc Valley",
    "Bassett": "Bassett Construction",
    "EVRAZ North America": "EVRAZ",
    "Johnson Controls": "JCI",
    "Adolph & Peterson": "A&P Construction",
    "A&P": "A&P Construction",
    "Meridian FA": "Meridian Fire & Security",
    "Caisson": "Caisson Co.",
    "Caisson Company": "Caisson Co.",
}

def normalize_gc_name(raw_part):
    s = str(raw_part).strip()
    s = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '', s)
    s = re.sub(r'\(?\d{3}\)?[\s\-\.]*\d{3}[\s\-\.]*\d{4}', '', s)
    s = re.sub(r'\d{1,2}/\d{1,2}\s*@\s*\d{1,2}:\d{2}', '', s)
    s = re.sub(r'\d{1,2}-\d{1,2}:\d{2}', '', s)
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'\s+', ' ', s).strip().rstrip(',').rstrip('.').strip()
    if s.lower() in ('inc', 'inc.', 'llc', 'llc.', '') or len(s) < 2:
        return None
    s = re.sub(r',?\s*(Inc\.?|LLC\.?)$', '', s).strip()
    return GC_MERGE.get(s, s)

def extract_contact(raw_part):
    m = re.search(r'\(([^)]+)\)', str(raw_part))
    if m:
        contact = m.group(1).strip()
        if '@' in contact or re.search(r'\d{3}', contact):
            return None
        if re.search(r'\d+/\d+|am|pm|noon', contact, re.I):
            return None
        return contact
    return None

def extract_email(raw_part):
    m = re.search(r'([\w\.-]+@[\w\.-]+\.\w+)', str(raw_part))
    return m.group(1) if m else None

def extract_phone(raw_part):
    m = re.search(r'\(?\d{3}\)?[\s\-\.]*\d{3}[\s\-\.]*\d{4}', str(raw_part))
    return m.group(0) if m else None

def split_gc_field(raw):
    """Split on comma outside parentheses."""
    s = str(raw).strip()
    parts, depth, current = [], 0, ''
    for ch in s:
        if ch == '(': depth += 1; current += ch
        elif ch == ')': depth -= 1; current += ch
        elif ch == ',' and depth == 0:
            parts.append(current.strip()); current = ''
        else: current += ch
    if current.strip(): parts.append(current.strip())
    return parts

# ─── SUPPLIER NORMALIZATION ──────────────────────────────────────────────────

SUPPLIER_MERGE = {
    "Am.": "American",
    "Am": "American",
    "America": "American",
    "Amerian": "American",
    "Rex.": "Rexel",
    "Special Sys.": "Special Systems",
    "Spec. Sys.": "Special Systems",
    "Blz.": "Blazer",
    "Blazer WSFP": None,  # will be split
    "Pwr. Sys. West": "Power Systems West",
    "Power Sys. West": "Power Systems West",
    "Colo. Security": "Colorado Security",
    "Dynamic": "Dynamic Power",
    "WSFP. Spec. Sys.": None,
    "WSFP. Special Systems": None,
    "Nate Caisson Co.": None,
    "Nate Downey": None,
    "Stan": None,
    "Nate": None,
    "Jason Hill": None,
    "Jason Hill Spec. Sys.": None,
    "Mike Martinez": None,
    "Lane Baker": None,
    "Nikki Blum": None,
}

SUPPLIER_JUNK = re.compile(
    r'(Job Walk|Questions Due|Tax Exempt|Mandatory|Pre-Bid|Site Walk|Site Visit|'
    r'Project is|Scope|Sealed Bid|Deliver proposal|Print Pros|Setting up|'
    r'Antonio is|Waiting on|Medium Voltage|This is Davis|Bronco Fire|F/A\?|'
    r'Sign Survey|Check in at|Kevin Rabideau|Beacon \(Phil|American Marca)', re.I
)

def parse_suppliers(raw):
    """Return list of normalized supplier names from the Vendors field."""
    if pd.isna(raw): return []
    s = str(raw).strip()
    if not s: return []
    if SUPPLIER_JUNK.search(s): return []
    if re.match(r'^Walk\s', s, re.I): return []

    parts = [p.strip() for p in s.split(',')]
    result = []
    for p in parts:
        name = re.sub(r'\([^)]*\)', '', p).strip()
        name = re.sub(r'\s+', ' ', name).strip()
        if not name or len(name) < 2 or re.match(r'^\d', name): continue
        merged = SUPPLIER_MERGE.get(name, name)
        if merged is None: continue
        if merged not in result:
            result.append(merged)
    return result

# ─── STATUS MAPPING ──────────────────────────────────────────────────────────

def map_status(row):
    active = str(row.get('Active', '')).strip().lower()
    bidding = str(row.get('Bidding', '')).strip().lower()
    awarded = str(row.get('Job Awarded to PE', '')).strip().lower()
    stage = str(row.get('Stage', '')).strip()

    if awarded == 'yes':
        return 'won'
    if bidding == 'no':
        return 'no_bid'
    if active == 'yes':
        return 'open'
    if stage and stage.lower() in ('no-bid', 'no bid'):
        return 'no_bid'
    if stage and stage.lower() == 'awarded':
        return 'won'
    # Default: Active=No, Bidding=Yes, Awarded=No → submitted (they bid but didn't win)
    if bidding == 'yes' and awarded == 'no':
        return 'lost'
    return 'lost'

def map_stage(row):
    stage = str(row.get('Stage', '')).strip() if pd.notna(row.get('Stage')) else None
    if not stage or stage == 'nan':
        return None
    # Map to our 22 stages
    STAGE_MAP = {
        'Bid Submitted': 'Bid Submitted',
        'Go / No-Go': 'Go/No-Go',
        'Takeoff': 'Takeoff',
        'Awarded': 'Awarded',
        'No-Bid': 'No-Bid',
        'Final Pricing': 'Final Pricing',
        'Estimate Review': 'Estimate Review',
        'GC Outreach': 'GC Outreach',
        'Site Walk Required': 'Site Walk Required',
        'Initial Review': 'Initial Review',
    }
    return STAGE_MAP.get(stage, stage)

def parse_date(val):
    if pd.isna(val): return None
    s = str(val).strip()
    if not s or s == 'nan' or s == 'NaT': return None
    try:
        dt = pd.to_datetime(val)
        return dt.strftime('%Y-%m-%d')
    except: return None

def parse_time(val):
    if pd.isna(val): return None
    s = str(val).strip()
    if not s or s == 'nan': return None
    # Might be a datetime or just a time string
    try:
        dt = pd.to_datetime(val)
        return dt.strftime('%H:%M')
    except:
        m = re.search(r'(\d{1,2}:\d{2})', s)
        return m.group(1) if m else None

def parse_bid_value(val):
    if pd.isna(val): return None
    try:
        v = float(val)
        return v if v > 0 else None
    except:
        return None

# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    print(f"Reading {XLSX}...")
    df = pd.read_excel(XLSX, sheet_name='Project Bidding List')
    print(f"  {len(df)} rows loaded")

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    # Get company_id (Pueblo Electrics = id 1)
    cur.execute("SELECT id FROM companies WHERE name LIKE '%Pueblo%' LIMIT 1")
    row = cur.fetchone()
    if not row:
        print("ERROR: No Pueblo Electrics company found in DB!")
        sys.exit(1)
    company_id = row[0]
    print(f"  Company ID: {company_id}")

    # Get employee map for estimators
    cur.execute("SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ?", (company_id,))
    emp_map = {}
    for eid, ename in cur.fetchall():
        emp_map[ename.strip().lower()] = eid
    print(f"  {len(emp_map)} employees loaded")

    # Map estimator names from spreadsheet to DB
    ESTIMATOR_MAP = {}
    for est_name in df['Estimator'].dropna().unique():
        key = str(est_name).strip().lower()
        if key in emp_map:
            ESTIMATOR_MAP[str(est_name).strip()] = emp_map[key]
        else:
            # Try partial match
            found = False
            for db_name, db_id in emp_map.items():
                if key.split()[-1] in db_name:  # match last name
                    ESTIMATOR_MAP[str(est_name).strip()] = db_id
                    found = True
                    break
            if not found:
                print(f"  WARNING: Estimator '{est_name}' not found in DB")

    print(f"  Estimator mappings: {ESTIMATOR_MAP}")

    # ── PHASE 1: Collect all unique GC companies and suppliers ──────────────

    print("\nPhase 1: Extracting GC companies and suppliers...")

    gc_names = set()
    for raw_gc in df['General Contractors'].dropna():
        for part in split_gc_field(raw_gc):
            name = normalize_gc_name(part)
            if name: gc_names.add(name)

    supplier_names = set()
    for raw_v in df['Vendors'].dropna():
        for s in parse_suppliers(raw_v):
            supplier_names.add(s)

    print(f"  {len(gc_names)} unique GC companies")
    print(f"  {len(supplier_names)} unique suppliers")

    # ── PHASE 2: Insert GC companies ────────────────────────────────────────

    print("\nPhase 2: Inserting GC companies...")

    # Clear existing (fresh seed)
    cur.execute("DELETE FROM opportunity_suppliers WHERE company_id = ?", (company_id,))
    cur.execute("DELETE FROM opportunity_gcs WHERE company_id = ?", (company_id,))
    cur.execute("DELETE FROM opportunities WHERE company_id = ?", (company_id,))
    cur.execute("DELETE FROM gc_companies WHERE company_id = ?", (company_id,))
    cur.execute("DELETE FROM suppliers WHERE company_id = ?", (company_id,))
    conn.commit()

    gc_id_map = {}
    for name in sorted(gc_names):
        cur.execute("INSERT INTO gc_companies (company_id, name) VALUES (?, ?)", (company_id, name))
        gc_id_map[name] = cur.lastrowid
    conn.commit()
    print(f"  Inserted {len(gc_id_map)} GC companies")

    # ── PHASE 3: Insert suppliers ───────────────────────────────────────────

    print("\nPhase 3: Inserting suppliers...")
    supplier_id_map = {}
    for name in sorted(supplier_names):
        cur.execute("INSERT INTO suppliers (company_id, name) VALUES (?, ?)", (company_id, name))
        supplier_id_map[name] = cur.lastrowid
    conn.commit()
    print(f"  Inserted {len(supplier_id_map)} suppliers")

    # ── PHASE 4: Insert opportunities with GC bids and suppliers ────────────

    print("\nPhase 4: Inserting opportunities...")
    stats = Counter()

    for idx, row in df.iterrows():
        job_name = str(row.get('Job Name', '')).strip()
        if not job_name or job_name == 'nan':
            stats['skipped_no_name'] += 1
            continue

        status = map_status(row)
        stage = map_stage(row)
        system_type = str(row['System Type']).strip() if pd.notna(row.get('System Type')) else None
        estimator_name = str(row['Estimator']).strip() if pd.notna(row.get('Estimator')) else None
        estimator_id = ESTIMATOR_MAP.get(estimator_name) if estimator_name else None

        bid_date = parse_date(row.get('Bid Date'))
        bid_time = parse_time(row.get('Bid Time'))
        dwgs = 1 if str(row.get('Dwgs/Specs', '')).strip().upper() == 'X' else 0
        pre_bid = str(row.get('Pre-Bid Meeting', '')).strip() if pd.notna(row.get('Pre-Bid Meeting')) else None
        if pre_bid == 'nan': pre_bid = None
        addenda = int(row['Adden.']) if pd.notna(row.get('Adden.')) else 0
        proj_start = parse_date(row.get('Project Start Date'))
        proj_end = parse_date(row.get('Project End Date '))
        notes = str(row.get('Notes', '')).strip() if pd.notna(row.get('Notes')) else None
        if notes == 'nan': notes = None
        follow_up = parse_date(row.get('Last Follow up Date'))
        collab_letter = 1 if pd.notna(row.get('Send Collaboration Opportunity Letter')) else 0
        bid_value = parse_bid_value(row.get('Final Bid Value'))
        sent_dwgs_to_gc = str(row.get('Sent Dwgs. To Vendors ', '')).strip().lower()
        sent_dwgs_flag = 1 if sent_dwgs_to_gc in ('yes', 'y') else 0

        # Insert opportunity
        cur.execute("""
            INSERT INTO opportunities (
                company_id, name, system_type, status, stage, estimator_id,
                bid_date, bid_time, dwgs_specs_received, pre_bid_meeting,
                addenda_count, project_start_date, project_end_date,
                notes, follow_up_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            company_id, job_name, system_type, status, stage, estimator_id,
            bid_date, bid_time, dwgs, pre_bid, addenda, proj_start, proj_end,
            notes, follow_up
        ))
        opp_id = cur.lastrowid
        stats[f'status_{status}'] += 1

        # Parse and insert GC bids
        raw_gc = row.get('General Contractors')
        if pd.notna(raw_gc):
            parts = split_gc_field(raw_gc)
            for i, part in enumerate(parts):
                gc_name = normalize_gc_name(part)
                if not gc_name or gc_name not in gc_id_map:
                    continue
                contact = extract_contact(part)
                email = extract_email(part)
                phone = extract_phone(part)
                is_primary = 1 if i == 0 else 0

                # Determine GC bid outcome from opportunity status
                if status == 'won' and is_primary:
                    outcome = 'won'
                elif status == 'lost':
                    outcome = 'lost'
                elif status == 'no_bid':
                    outcome = 'no_bid'
                else:
                    outcome = 'pending'

                cur.execute("""
                    INSERT INTO opportunity_gcs (
                        company_id, opportunity_id, gc_company_id,
                        contact_name, contact_email, contact_phone,
                        bid_value, is_primary, collaboration_letter_sent,
                        sent_drawings_to_gc, outcome
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    company_id, opp_id, gc_id_map[gc_name],
                    contact, email, phone,
                    bid_value if is_primary else None,
                    is_primary, collab_letter if is_primary else 0,
                    sent_dwgs_flag if is_primary else 0, outcome
                ))
                stats['gc_bids'] += 1

        # Parse and insert supplier checkboxes
        suppliers = parse_suppliers(row.get('Vendors'))
        for sup_name in suppliers:
            if sup_name in supplier_id_map:
                cur.execute("""
                    INSERT INTO opportunity_suppliers (company_id, opportunity_id, supplier_id, sent_drawings)
                    VALUES (?, ?, ?, 1)
                """, (company_id, opp_id, supplier_id_map[sup_name]))
                stats['supplier_links'] += 1

        stats['opportunities'] += 1

    conn.commit()

    # ── SUMMARY ─────────────────────────────────────────────────────────────

    print(f"\n{'='*50}")
    print(f"IMPORT COMPLETE")
    print(f"{'='*50}")
    print(f"  Opportunities: {stats['opportunities']}")
    print(f"  GC Companies:  {len(gc_id_map)}")
    print(f"  Suppliers:     {len(supplier_id_map)}")
    print(f"  GC Bids:       {stats['gc_bids']}")
    print(f"  Supplier Links:{stats['supplier_links']}")
    print(f"  Skipped (no name): {stats.get('skipped_no_name', 0)}")
    print(f"\n  Status breakdown:")
    for k, v in sorted(stats.items()):
        if k.startswith('status_'):
            print(f"    {k[7:]:12s} {v}")

    # Verify
    cur.execute("SELECT COUNT(*) FROM opportunities WHERE company_id = ?", (company_id,))
    print(f"\n  DB verify - opportunities: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM gc_companies WHERE company_id = ?", (company_id,))
    print(f"  DB verify - gc_companies:  {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM suppliers WHERE company_id = ?", (company_id,))
    print(f"  DB verify - suppliers:     {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM opportunity_gcs WHERE company_id = ?", (company_id,))
    print(f"  DB verify - opportunity_gcs: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM opportunity_suppliers WHERE company_id = ?", (company_id,))
    print(f"  DB verify - opp_suppliers: {cur.fetchone()[0]}")

    conn.close()
    print("\nDone!")

if __name__ == '__main__':
    main()
