#!/usr/bin/env python3
"""
A-Systems Job Report PDF Parser
Reads an A-Systems job report PDF and outputs JSON to stdout.
Called by the BirdDog server as a subprocess.

Usage: python3 parse-asystems.py <path-to-pdf>
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
    print(json.dumps({"error": "Usage: python3 parse-asystems.py <pdf-path>"}), file=sys.stdout)
    sys.exit(1)

pdf_path = sys.argv[1]

# --- INIT ---
records = []
current_job = None
current_job_name = None
total_job_budget = None

labor_subtotal_re = re.compile(r"LABOR Subtotal:(.*)Hours", re.IGNORECASE)
material_subtotal_re = re.compile(r"MATERIALS Subtotal:(.*)Hours", re.IGNORECASE)
general_subtotal_re = re.compile(r"GENERAL Subtotal:(.*)Hours", re.IGNORECASE)

# --- PDF PARSE ---
try:
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue

            lines = text.splitlines()
            current_job = None
            current_job_name = None
            total_job_budget = None

            for line in lines:
                if "Contract:" in line:
                    job_match = re.search(r"(\d{3,6})", line)
                    current_job = int(job_match.group(1)) if job_match else None
                    current_job_name = line.split("Contract:")[0].strip()

                    after_contract = line.split("Contract:")[-1]
                    numbers = re.findall(r"[-+]?\d[\d,]*\.?\d*", after_contract)
                    try:
                        total_job_budget = float(numbers[1].replace(",", ""))
                    except (IndexError, ValueError):
                        total_job_budget = None
                    continue

                # LABOR
                labor_match = labor_subtotal_re.search(line)
                if labor_match and current_job:
                    pre_hours = labor_match.group(1).strip()
                    post_hours = line.split("Hours")[-1]

                    hour_vals = [float(x.replace(",", "")) for x in re.findall(r"-?\d[\d,]*\.?\d*", pre_hours)]
                    hour_budget, hour_used = (hour_vals + [0, 0])[:2]

                    dollar_vals = [float(x.replace(",", "")) for x in re.findall(r"-?\d[\d,]*\.?\d*", post_hours)]

                    labor_budget = dollar_vals[2] if len(dollar_vals) >= 3 else None
                    labor_cost = dollar_vals[5] if len(dollar_vals) >= 6 else None

                    records.append({
                        "jobNumber": str(current_job),
                        "jobName": current_job_name,
                        "hourBudget": hour_budget,
                        "hoursUsed": hour_used,
                        "laborBudget": labor_budget,
                        "laborCost": labor_cost,
                        "materialBudget": None,
                        "materialCost": None,
                        "generalBudget": None,
                        "generalCost": None,
                        "totalContract": total_job_budget,
                    })

                # MATERIALS
                material_match = material_subtotal_re.search(line)
                if material_match and current_job:
                    post_hours = line.split("Hours")[-1]
                    vals = [float(x.replace(",", "")) for x in re.findall(r"-?\d[\d,]*\.?\d*", post_hours)]
                    for r in reversed(records):
                        if r["jobNumber"] == str(current_job):
                            r["materialBudget"] = vals[2] if len(vals) >= 3 else None
                            r["materialCost"] = vals[5] if len(vals) >= 6 else None
                            break

                # GENERAL
                general_match = general_subtotal_re.search(line)
                if general_match and current_job:
                    post_hours = line.split("Hours")[-1]
                    vals = [float(x.replace(",", "")) for x in re.findall(r"-?\d[\d,]*\.?\d*", post_hours)]
                    for r in reversed(records):
                        if r["jobNumber"] == str(current_job):
                            r["generalBudget"] = vals[2] if len(vals) >= 3 else None
                            r["generalCost"] = vals[5] if len(vals) >= 6 else None
                            break

except Exception as e:
    print(json.dumps({"error": f"Failed to parse PDF: {str(e)}"}), file=sys.stdout)
    sys.exit(1)

# Output clean JSON
print(json.dumps(records))
