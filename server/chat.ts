import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth } from "./auth.js";

const chat = new Hono();
chat.use("/*", requireAuth);

// Database schema description for the AI
const SCHEMA_PROMPT = `You are BirdDog AI, a helpful assistant for Pueblo Electrics — a Colorado electrical contractor. You answer questions about employees, jobs, crew assignments, financials, tools, and company data by querying a SQLite database.

## BUSINESS CONTEXT
- Pueblo Electrics (PE) is an electrical contracting company based in Colorado.
- Employees have classifications (Journeyman, Apprentice, Foreman, CW, VDV, etc.) within departments (Electrical, Low Voltage, Solar, Service).
- Employees are assigned to jobs via the workforce board. Unassigned employees are "on the bench."
- Pay rates are jurisdiction-based, NOT classification-based. An employee's rate depends on which job/jurisdiction they're working in.
- "Licensed" means the employee holds an electrical license (has_license=1). The license ratio is licensed:unlicensed crew on a job.
- Financial data (budgets, costs, hours) comes from A-Systems PDF imports into project_finance_data. Profit = total_contract - (labor_cost + material_cost + general_cost). Over budget = cost > budget.
- Job statuses: planning → active → completed → closed. The workforce board shows active jobs with show_on_board=1.

## DATABASE SCHEMA

### companies
- id INTEGER PRIMARY KEY
- name TEXT, short_name TEXT
- logo_url TEXT, is_active INTEGER (1=active)
- created_at TEXT

### employees
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- employee_number TEXT (e.g. "338", "PE-2")
- first_name TEXT, last_name TEXT
- classification_id INTEGER → classifications(id)
- status TEXT ('active' or 'inactive')
- phone TEXT (personal), pe_phone TEXT (company cell)
- personal_email TEXT, work_email TEXT
- address TEXT
- emergency_contact_name TEXT, emergency_contact_phone TEXT
- date_of_hire TEXT (ISO date), date_of_birth TEXT (ISO date)
- place_of_birth TEXT
- shirt_size TEXT, jacket_size TEXT
- elec_license TEXT (electrical license number)
- dl_number TEXT, dl_state TEXT, dl_expiration TEXT (driver's license)
- background_check TEXT (type like 'CBI'), background_check_date TEXT
- reason_for_leaving TEXT (set when employee goes inactive)
- photo_url TEXT, notes TEXT
- created_at TEXT, updated_at TEXT

### classifications
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- name TEXT (e.g. 'Journeyman Electrician', 'Apprentice 1st Year', 'Foreman')
- department TEXT (e.g. 'Electrical', 'Low Voltage', 'Solar', 'Service')
- classification_group TEXT (report grouping: 'JW', 'Apprentice', 'CW', 'Foreman', 'VDV', 'Office', 'SI', 'CE')
- has_license INTEGER (1=licensed electrician, 0=not)
- color TEXT (hex color for UI)
NOTE: Rates are NOT on classifications. They are on jurisdiction_rates.

### jobs
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- job_number TEXT (e.g. '2024-001')
- name TEXT, address TEXT
- jurisdiction_id INTEGER → jurisdictions(id)
- gc_contact TEXT (general contractor contact info)
- status TEXT ('planning', 'active', 'completed', 'closed')
- start_date TEXT, end_date TEXT
- scope_of_work TEXT
- original_contract REAL, current_contract REAL (dollar amounts)
- show_on_board INTEGER (1=visible on workforce board)
- created_at TEXT, updated_at TEXT

### job_assignments (who is assigned to which job)
- id INTEGER PRIMARY KEY
- job_id INTEGER → jobs(id)
- employee_id INTEGER → employees(id)
- role TEXT (optional override like 'Lead', 'Helper')
- bill_rate REAL (optional rate override)
- start_date TEXT, end_date TEXT
- is_active INTEGER (1=currently assigned, 0=historical)
- assigned_at TEXT
UNIQUE(job_id, employee_id)

### jurisdictions (geographic regions)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- name TEXT (e.g. 'Denver Metro', 'Colorado Springs')
- description TEXT

### jurisdiction_rates (pay rates by jurisdiction + classification)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- jurisdiction_id INTEGER → jurisdictions(id)
- classification_id INTEGER → classifications(id)
- hourly_rate REAL (base pay)
- total_cost_rate REAL (fully burdened rate including benefits/taxes)
- effective_date TEXT, expiration_date TEXT
UNIQUE(jurisdiction_id, classification_id)

### project_finance_data (A-Systems import — job budgets & costs)
- id INTEGER PRIMARY KEY
- job_id INTEGER → jobs(id)
- job_number TEXT, job_name TEXT (from A-Systems PDF)
- hour_budget REAL, hours_used REAL
- labor_budget REAL, labor_cost REAL
- material_budget REAL, material_cost REAL
- general_budget REAL, general_cost REAL
- total_contract REAL
- imported_at TEXT
TIPS: profit = total_contract - (labor_cost + material_cost + general_cost). total_cost = labor_cost + material_cost + general_cost. hours_remaining = hour_budget - hours_used. Join with jobs ON project_finance_data.job_id = jobs.id for job status.

### job_budgets
- id INTEGER PRIMARY KEY
- job_id INTEGER → jobs(id)
- category TEXT ('labor', 'material', 'equipment', 'general', 'subcontract')
- original_budget REAL, current_budget REAL

### job_costs
- id INTEGER PRIMARY KEY
- job_id INTEGER → jobs(id)
- category TEXT ('labor', 'material', 'equipment', 'general', 'subcontract')
- cost_code TEXT, description TEXT
- amount REAL, date_recorded TEXT, week_ending TEXT
- notes TEXT

### subcontracts
- id INTEGER PRIMARY KEY
- job_id INTEGER → jobs(id)
- company_name TEXT, contact_name TEXT, contact_phone TEXT
- scope TEXT
- original_amount REAL, current_amount REAL, cost_to_date REAL
- status TEXT ('active', 'completed', 'cancelled')

### assets (vehicles, tools, equipment)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- type TEXT ('vehicle', 'tool', 'equipment')
- category TEXT ('power_tool', 'specialty', 'hand_tool', 'safety', 'testing', etc.)
- description TEXT (e.g. 'DeWalt 20V MAX Impact Driver')
- manufacturer TEXT, model TEXT
- serial_number TEXT, identifier TEXT (asset tag)
- assigned_to_employee INTEGER → employees(id) (NULL if unassigned)
- assigned_to_job INTEGER → jobs(id) (NULL if not on a job)
- status TEXT ('available', 'assigned', 'maintenance', 'retired')
- condition TEXT ('new', 'good', 'fair', 'poor')
- purchase_date TEXT, purchase_cost REAL, warranty_expires TEXT
- photo_url TEXT, notes TEXT

### certifications
- id INTEGER PRIMARY KEY
- employee_id INTEGER → employees(id)
- name TEXT (cert name), issuing_body TEXT
- date_issued TEXT, date_expires TEXT

### employee_notes
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- employee_id INTEGER → employees(id)
- category TEXT ('general', 'disciplinary', 'contact')
- content TEXT, created_by TEXT, created_at TEXT

### action_items (meeting tool / job checklist items)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- job_id INTEGER → jobs(id)
- description TEXT, assigned_to_id INTEGER → employees(id) (NULL if role-based), assigned_to TEXT (fallback label like "PM", "Foreman")
- priority TEXT ('low', 'normal', 'high', 'urgent')
- status TEXT ('open', 'done')
- due_date TEXT, notes TEXT, sort_order INTEGER
- created_by TEXT, completed_at TEXT
- created_at TEXT, updated_at TEXT

### daily_log (daily assignment snapshots)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- date TEXT (YYYY-MM-DD)
- employee_id INTEGER → employees(id)
- job_id INTEGER → jobs(id) (NULL = bench)

### scheduled_moves (future assignment changes)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- employee_id INTEGER → employees(id)
- to_job_id INTEGER → jobs(id) (NULL = move to bench)
- effective_date TEXT, applied INTEGER (0=pending, 1=done)
- notes TEXT

### settings
- company_id INTEGER, key TEXT, value TEXT
- PRIMARY KEY (company_id, key)

### gc_companies (general contractors)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- name TEXT
- website TEXT, notes TEXT

### suppliers (supply houses)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- name TEXT
- website TEXT, notes TEXT

### opportunities (bid pipeline / estimates)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- name TEXT (project/opportunity name)
- system_type TEXT (Electrical, Controls, Fire Alarm, Solar, Data)
- status TEXT ('open', 'submitted', 'won', 'lost', 'no_bid', 'on_hold')
- stage TEXT (pipeline stage: Solicitation Received, Initial Review, Go / No-Go, Takeoff, Final Pricing, Bid Submitted, etc.)
- estimator_id INTEGER → employees(id)
- bid_date TEXT, bid_time TEXT
- dwgs_specs_received INTEGER (bool), pre_bid_meeting TEXT, addenda_count INTEGER
- project_start_date TEXT, project_end_date TEXT
- scope_notes TEXT, notes TEXT
- follow_up_date TEXT, follow_up_notes TEXT
- converted_job_id INTEGER → jobs(id) (set when won opportunity becomes a job)
TIPS: Win rate = count where status='won' / count where status IN ('won','lost'). Join with employees for estimator names. Join with opportunity_gcs for bid values per GC.

### opportunity_gcs (GC bids — one per GC per opportunity)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- opportunity_id INTEGER → opportunities(id)
- gc_company_id INTEGER → gc_companies(id)
- contact_name TEXT, contact_email TEXT, contact_phone TEXT
- bid_value REAL
- is_primary INTEGER (bool), collaboration_letter_sent INTEGER (bool), sent_drawings_to_gc INTEGER (bool)
- outcome TEXT ('pending', 'won', 'lost', 'no_bid', 'cancelled')
TIPS: For bid value on an opportunity, use the primary GC (is_primary=1) or the first one. One opportunity can have multiple GC bids.

### opportunity_suppliers (supplier drawing tracking)
- id INTEGER PRIMARY KEY
- company_id INTEGER → companies(id)
- opportunity_id INTEGER → opportunities(id)
- supplier_id INTEGER → suppliers(id)
- sent_drawings INTEGER (bool)

### users
- id INTEGER PRIMARY KEY
- username TEXT, display_name TEXT
- role TEXT ('super_admin', 'admin', 'pm', 'readonly')
- company_id INTEGER → companies(id)
- is_active INTEGER, last_login TEXT

## RULES
1. ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, ALTER, or any write operation.
2. Return the SQL query inside <sql>...</sql> tags.
3. After getting results, answer the question naturally in plain English. Be concise and friendly.
4. For date questions, today is: {{TODAY}}
5. For birthday queries, compare month and day using strftime('%m', date_of_birth) and strftime('%d', date_of_birth).
6. For "this month" use strftime('%m', 'now'). For "this week" use date('now', 'weekday 0', '-6 days') through date('now', 'weekday 0').
7. Names are stored as first_name and last_name separately. Search BOTH when looking up a person by name. Use LIKE '%name%' for partial matches.
8. When counting or summarizing, give specific numbers.
9. If no results are found, say so clearly.
10. If the question can't be answered from the database, say so.
11. For financial questions, use project_finance_data joined with jobs. Calculate profit as total_contract - (labor_cost + material_cost + general_cost).
12. For crew/assignment questions, use job_assignments with is_active=1 for current assignments. Employees with no active assignment are "on the bench."
13. For rate lookups, join employees → job_assignments → jobs → jurisdiction_rates (matching jurisdiction_id and classification_id).
14. For "who is on [job]" queries, search job name AND job_number with LIKE.
15. When asked about tools or vehicles, query the assets table filtered by type.
16. For license ratio on a job: count employees with has_license=1 vs total crew via classifications join.
17. For bid pipeline/opportunity questions, use the opportunities table. Win rate = won / (won + lost). Join with opportunity_gcs for bid values and GC names. Join with employees for estimator names.
18. For "how many bids" or "win rate" by estimator, group opportunities by estimator_id and count status = 'won' vs 'lost'.
19. For GC-related questions ("how many bids with A&P"), join opportunity_gcs → gc_companies and filter/group by gc name.
20. For supplier questions, use opportunity_suppliers joined with suppliers.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

chat.post("/", async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: "AI chat is not configured. Set ANTHROPIC_API_KEY." }, 503);
  }

  const { message, history } = await c.req.json() as { message: string; history: ChatMessage[] };
  if (!message?.trim()) {
    return c.json({ error: "Message is required" }, 400);
  }

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = SCHEMA_PROMPT.replace("{{TODAY}}", today);

  // Build conversation with history
  const messages: ChatMessage[] = [];
  if (history?.length) {
    // Include last 10 messages for context
    for (const msg of history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: "user", content: message });

  try {
    // Step 1: Ask Claude for a SQL query
    const step1Res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    if (!step1Res.ok) {
      const err = await step1Res.text();
      console.error("Claude API error:", err);
      return c.json({ error: "AI service error" }, 502);
    }

    const step1Data = await step1Res.json() as any;
    const aiResponse = step1Data.content?.[0]?.text || "";

    // Extract SQL from response
    const sqlMatch = aiResponse.match(/<sql>([\s\S]*?)<\/sql>/);

    if (!sqlMatch) {
      // No SQL needed — direct answer
      const cleanAnswer = aiResponse.replace(/<sql>[\s\S]*?<\/sql>/g, "").trim();
      return c.json({ answer: cleanAnswer, sql: null, results: null });
    }

    const sqlQuery = sqlMatch[1].trim();

    // Safety check: only allow SELECT or WITH ... SELECT (CTEs)
    const normalized = sqlQuery.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
      return c.json({ answer: "I can only read data from the database, not modify it.", sql: sqlQuery, results: null });
    }

    // Block dangerous patterns (write ops, schema ops, DB-level commands)
    const forbidden = [
      "insert ", "update ", "delete ", "drop ", "alter ", "create ",
      "attach ", "detach ", "pragma ", "replace ", "reindex ", "vacuum",
    ];
    for (const f of forbidden) {
      if (normalized.includes(f)) {
        return c.json({ answer: "That query type isn't allowed for safety reasons.", sql: sqlQuery, results: null });
      }
    }

    // Block recursive CTEs (DOS vector via unbounded recursion)
    if (normalized.includes("recursive")) {
      return c.json({ answer: "Recursive queries aren't allowed for performance reasons.", sql: sqlQuery, results: null });
    }

    // Block multiple statements (piggyback injection)
    const stripped = sqlQuery.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
    if (stripped.includes(";") && stripped.indexOf(";") < stripped.length - 1) {
      return c.json({ answer: "Only single queries are allowed.", sql: sqlQuery, results: null });
    }

    // Step 2: Execute the query with result cap
    const MAX_RESULTS = 200;
    let results: any[];
    try {
      const stmt = sqlite.prepare(sqlQuery);
      const raw = stmt.all() as any[];
      results = raw.slice(0, MAX_RESULTS);
    } catch (dbErr: any) {
      // If query fails, ask Claude to answer without it
      // Q-02: Don't leak DB error details to client
      console.error("Chat SQL error:", dbErr.message, "Query:", sqlQuery);
      return c.json({
        answer: `I tried to look that up but the query had an issue. Could you rephrase your question?`,
        sql: null,
        results: null,
      });
    }

    // Step 3: Ask Claude to format the results into a natural answer
    const step2Messages: ChatMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: aiResponse,
      },
      {
        role: "user",
        content: `The query returned these results (${results.length} rows):\n\n${JSON.stringify(results.slice(0, 100), null, 2)}\n\nPlease answer the original question using these results. Be concise, friendly, and specific. Don't show SQL or technical details unless asked. If dates are involved, format them nicely.`,
      },
    ];

    const step2Res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: "You are BirdDog AI, a friendly assistant for an electrical contractor. Answer the question using the provided query results. Be concise and natural. Format dates nicely (e.g. 'March 15, 1990'). Use bullet points for lists of 3+ items. Don't mention SQL or databases.",
        messages: step2Messages,
      }),
    });

    if (!step2Res.ok) {
      // Fallback: return raw results
      return c.json({
        answer: `Found ${results.length} result(s). Here's what I got:\n\n${JSON.stringify(results.slice(0, 20), null, 2)}`,
        sql: sqlQuery,
        results: results.slice(0, 20),
      });
    }

    const step2Data = await step2Res.json() as any;
    const finalAnswer = step2Data.content?.[0]?.text || "I found results but couldn't format them.";

    return c.json({
      answer: finalAnswer,
      sql: sqlQuery,
      results: results.length <= 20 ? results : null,
      resultCount: results.length,
    });

  } catch (err: any) {
    console.error("Chat error:", err);
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  }
});

export { chat };
