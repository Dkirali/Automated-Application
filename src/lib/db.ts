import Database from "better-sqlite3";

// Next.js dev mode re-evaluates modules across HMR boundaries, which creates
// multiple module instances each with their own `_db`. Stashing on globalThis
// guarantees a single shared singleton for the process lifetime — required
// so that `/api/test-reset` actually closes the same connection that page
// renders are reading from.
interface DbGlobals {
  __jobbot_db: Database.Database | null;
  __jobbot_db_initialized: boolean;
}
const g = globalThis as unknown as DbGlobals;
if (g.__jobbot_db === undefined) g.__jobbot_db = null;
if (g.__jobbot_db_initialized === undefined) g.__jobbot_db_initialized = false;

export function getConn(): Database.Database {
  if (!g.__jobbot_db) {
    const dbPath = process.env.JOBBOT_DB || "jobbot.db";
    if (process.env.JOBBOT_TEST_MODE === "1") {
      console.log(`[db] OPEN ${dbPath}`);
    }
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    g.__jobbot_db = db;
    if (!g.__jobbot_db_initialized) {
      g.__jobbot_db_initialized = true;
      initDb();
    }
  }
  return g.__jobbot_db;
}

export function closeConn(): void {
  if (g.__jobbot_db) {
    g.__jobbot_db.close();
    g.__jobbot_db = null;
    g.__jobbot_db_initialized = false;
  }
}

export function initDb(): void {
  const db = getConn();
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      titles TEXT NOT NULL,
      locations TEXT NOT NULL,
      status TEXT DEFAULT 'idle',
      started_at TEXT,
      stopped_at TEXT,
      stop_reason TEXT,
      preferred_model TEXT DEFAULT 'auto'
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      company TEXT,
      title TEXT,
      location TEXT,
      url TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      ats_score INTEGER,
      resume_path TEXT,
      job_description TEXT,
      fit_summary TEXT,
      easy_apply INTEGER DEFAULT 1,
      applied_at TEXT,
      created_at TEXT,
      original_ats_score INTEGER,
      keywords TEXT,
      jd_summary TEXT,
      model_used TEXT
    );
    CREATE TABLE IF NOT EXISTS manual_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      company TEXT,
      title TEXT,
      location TEXT,
      url TEXT UNIQUE,
      reason TEXT,
      added_at TEXT
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_key TEXT NOT NULL,
      call_date TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      tokens INTEGER DEFAULT 0,
      UNIQUE(provider, model_key, call_date)
    );
  `);

  // Idempotent ALTERs for fit-scoring v2 columns added 2026-05-31
  const newCols: Array<[string, string]> = [
    ["fit_score", "INTEGER"],
    ["keyword_score", "INTEGER"],
    ["hardreq_score", "INTEGER"],
    ["parseability_score", "INTEGER"],
    ["requirements_json", "TEXT"],
  ];
  const existing = db
    .prepare("PRAGMA table_info(applications)")
    .all() as Array<{ name: string }>;
  const have = new Set(existing.map((c) => c.name));
  for (const [name, type] of newCols) {
    if (!have.has(name)) {
      db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${type}`);
    }
  }

  // api_usage gained a token counter on 2026-06-01.
  const usageCols = db
    .prepare("PRAGMA table_info(api_usage)")
    .all() as Array<{ name: string }>;
  if (!usageCols.some((c) => c.name === "tokens")) {
    db.exec("ALTER TABLE api_usage ADD COLUMN tokens INTEGER DEFAULT 0");
  }
}

// ── Config ──────────────────────────────────────────────────────────────

export function setConfig(key: string, value: string): void {
  getConn()
    .prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )
    .run(key, value);
}

export function getConfig(key: string): string | null {
  const row = getConn()
    .prepare("SELECT value FROM config WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function isSetupComplete(): boolean {
  const required = ["name", "email", "phone", "master_resume_path"];
  const result = required.every((k) => getConfig(k) !== null);
  if (process.env.JOBBOT_TEST_MODE === "1") {
    const vals = required.map((k) => `${k}=${getConfig(k) ? "✓" : "∅"}`);
    console.log(`[db] isSetupComplete=${result} (${vals.join(", ")})`);
  }
  return result;
}

// ── Campaigns ───────────────────────────────────────────────────────────

export function createCampaign(
  params: {
    name: string;
    titles: string;
    locations: string;
  }
): number {
  const result = getConn()
    .prepare(
      "INSERT INTO campaigns (name, titles, locations, status) VALUES (?,?,?,'running')"
    )
    .run(params.name, params.titles, params.locations);
  return Number(result.lastInsertRowid);
}

export function updateCampaignStatus(
  campaignId: number,
  status: string,
  stopReason?: string
): void {
  getConn()
    .prepare(
      "UPDATE campaigns SET status=?, stopped_at=?, stop_reason=? WHERE id=?"
    )
    .run(status, new Date().toISOString(), stopReason ?? null, campaignId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getActiveCampaign(): Record<string, any> | null {
  const row = getConn()
    .prepare(
      "SELECT * FROM campaigns WHERE status='running' ORDER BY started_at DESC LIMIT 1"
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .get() as Record<string, any> | undefined;
  return row ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllCampaigns(): Record<string, any>[] {
  return getConn()
    .prepare(
      `SELECT c.*,
        COUNT(a.id) AS total_count,
        SUM(CASE WHEN a.status='applied'   THEN 1 ELSE 0 END) AS applied_count,
        SUM(CASE WHEN a.status='pending'   THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN a.status='discarded' THEN 1 ELSE 0 END) AS discarded_count
      FROM campaigns c
      LEFT JOIN applications a ON a.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.started_at DESC
      LIMIT 20`
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all() as Record<string, any>[];
}

// ── Applications ────────────────────────────────────────────────────────

export function insertApplication(params: {
  campaignId: number;
  company: string;
  title: string;
  location: string;
  url: string;
  jobDescription: string;
  easyApply?: boolean;
}): number | null {
  try {
    const result = getConn()
      .prepare(
        "INSERT INTO applications (campaign_id,company,title,location,url,job_description,easy_apply,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?)"
      )
      .run(
        params.campaignId,
        params.company,
        params.title,
        params.location,
        params.url,
        params.jobDescription,
        params.easyApply !== false ? 1 : 0,
        new Date().toISOString()
      );
    return Number(result.lastInsertRowid);
  } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") return null;
    throw e;
  }
}

export function updateApplication(
  appId: number,
  status: string,
  opts: {
    atsScore?: number;
    resumePath?: string;
    fitSummary?: string;
    originalAtsScore?: number;
    keywords?: string;
    jdSummary?: string;
    modelUsed?: string;
    fitScore?: number;
    keywordScore?: number;
    hardreqScore?: number;
    parseabilityScore?: number;
    requirementsJson?: string;
  } = {}
): void {
  getConn()
    .prepare(
      `UPDATE applications SET status=?,
        ats_score=COALESCE(?,ats_score),
        resume_path=COALESCE(?,resume_path),
        fit_summary=COALESCE(?,fit_summary),
        original_ats_score=COALESCE(?,original_ats_score),
        keywords=COALESCE(?,keywords),
        jd_summary=COALESCE(?,jd_summary),
        model_used=COALESCE(?,model_used),
        fit_score=COALESCE(?,fit_score),
        keyword_score=COALESCE(?,keyword_score),
        hardreq_score=COALESCE(?,hardreq_score),
        parseability_score=COALESCE(?,parseability_score),
        requirements_json=COALESCE(?,requirements_json)
      WHERE id=?`
    )
    .run(
      status,
      opts.atsScore ?? null,
      opts.resumePath ?? null,
      opts.fitSummary ?? null,
      opts.originalAtsScore ?? null,
      opts.keywords ?? null,
      opts.jdSummary ?? null,
      opts.modelUsed ?? null,
      opts.fitScore ?? null,
      opts.keywordScore ?? null,
      opts.hardreqScore ?? null,
      opts.parseabilityScore ?? null,
      opts.requirementsJson ?? null,
      appId
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getApplication(appId: number): Record<string, any> | null {
  const row = getConn()
    .prepare("SELECT * FROM applications WHERE id=?")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .get(appId) as Record<string, any> | undefined;
  return row ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPendingJobs(): Record<string, any>[] {
  return getConn()
    .prepare(
      "SELECT * FROM applications WHERE status IN ('pending','tailoring','reviewed') ORDER BY created_at DESC"
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all() as Record<string, any>[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllApplications(): Record<string, any>[] {
  return getConn()
    .prepare(
      "SELECT * FROM applications WHERE status IN ('applied','failed','discarded') ORDER BY COALESCE(created_at, applied_at) DESC"
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all() as Record<string, any>[];
}

export function markApplied(appId: number): void {
  getConn()
    .prepare(
      "UPDATE applications SET status='applied', applied_at=? WHERE id=?"
    )
    .run(new Date().toISOString(), appId);
}

// ── Manual Queue ────────────────────────────────────────────────────────

export function insertManual(
  campaignId: number,
  company: string,
  title: string,
  location: string,
  url: string,
  reason: string
): void {
  try {
    getConn()
      .prepare(
        "INSERT INTO manual_queue (campaign_id,company,title,location,url,reason,added_at) VALUES (?,?,?,?,?,?,?)"
      )
      .run(
        campaignId,
        company,
        title,
        location,
        url,
        reason,
        new Date().toISOString()
      );
  } catch {
    // duplicate URL — ignore
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getManualQueue(): Record<string, any>[] {
  return getConn()
    .prepare("SELECT * FROM manual_queue ORDER BY added_at DESC")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all() as Record<string, any>[];
}

// ── Seen URLs ───────────────────────────────────────────────────────────

export function getSeenUrls(): Set<string> {
  const db = getConn();
  const apps = db
    .prepare("SELECT url FROM applications")
    .all() as { url: string }[];
  const manual = db
    .prepare("SELECT url FROM manual_queue")
    .all() as { url: string }[];
  const set = new Set<string>();
  for (const r of apps) set.add(r.url);
  for (const r of manual) set.add(r.url);
  return set;
}

// ── API Usage ───────────────────────────────────────────────────────────

export function incrementApiUsage(modelKey: string, tokens: number = 0): void {
  const today = new Date().toISOString().split("T")[0];
  const provider = modelKey.includes("/") ? modelKey.split("/")[0] : modelKey;
  getConn()
    .prepare(
      "INSERT INTO api_usage (provider, model_key, call_date, call_count, tokens) VALUES (?,?,?,1,?) ON CONFLICT(provider, model_key, call_date) DO UPDATE SET call_count = call_count + 1, tokens = tokens + excluded.tokens"
    )
    .run(provider, modelKey, today, tokens);
}

export interface ApiUsageToday {
  counts: Record<string, number>;
  tokensByModel: Record<string, number>;
}

export function getApiUsageToday(): ApiUsageToday {
  const today = new Date().toISOString().split("T")[0];
  const rows = getConn()
    .prepare("SELECT model_key, call_count, tokens FROM api_usage WHERE call_date=?")
    .all(today) as { model_key: string; call_count: number; tokens: number }[];
  const counts: Record<string, number> = {};
  const tokensByModel: Record<string, number> = {};
  for (const r of rows) {
    counts[r.model_key] = r.call_count;
    tokensByModel[r.model_key] = r.tokens;
  }
  return { counts, tokensByModel };
}

// Aggregate today's usage across every model. The dashboard gauge shows total
// daily spend, since fit scoring runs on the fast model while tailoring runs on
// the flagship — reporting a single model would leave the gauge stuck at 0.
export function getApiUsageTotalsToday(): { tokens: number; calls: number } {
  const usage = getApiUsageToday();
  let tokens = 0;
  let calls = 0;
  for (const t of Object.values(usage.tokensByModel)) tokens += t;
  for (const c of Object.values(usage.counts)) calls += c;
  return { tokens, calls };
}
