import Database from "better-sqlite3";

let _db: Database.Database | null = null;
let _initialized = false;

export function getConn(): Database.Database {
  if (!_db) {
    const dbPath = process.env.JOBBOT_DB || "jobbot.db";
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("busy_timeout = 5000");
    if (!_initialized) {
      _initialized = true;
      initDb();
    }
  }
  return _db;
}

export function closeConn(): void {
  if (_db) {
    _db.close();
    _db = null;
    _initialized = false;
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
      UNIQUE(provider, model_key, call_date)
    );
  `);
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
  return required.every((k) => getConfig(k) !== null);
}

// ── Campaigns ───────────────────────────────────────────────────────────

export function createCampaign(
  params: {
    name: string;
    titles: string;
    locations: string;
    preferredModel?: string;
  }
): number {
  const preferredModel = params.preferredModel ?? "auto";
  const result = getConn()
    .prepare(
      "INSERT INTO campaigns (name, titles, locations, status, preferred_model) VALUES (?,?,?,'running',?)"
    )
    .run(params.name, params.titles, params.locations, preferredModel);
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

export function getActiveCampaign(): Record<string, any> | null {
  const row = getConn()
    .prepare(
      "SELECT * FROM campaigns WHERE status='running' ORDER BY started_at DESC LIMIT 1"
    )
    .get() as Record<string, any> | undefined;
  return row ?? null;
}

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
  } catch (e: any) {
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
        model_used=COALESCE(?,model_used)
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
      appId
    );
}

export function getApplication(appId: number): Record<string, any> | null {
  const row = getConn()
    .prepare("SELECT * FROM applications WHERE id=?")
    .get(appId) as Record<string, any> | undefined;
  return row ?? null;
}

export function getPendingJobs(): Record<string, any>[] {
  return getConn()
    .prepare(
      "SELECT * FROM applications WHERE status IN ('pending','reviewed') ORDER BY created_at DESC"
    )
    .all() as Record<string, any>[];
}

export function getAllApplications(): Record<string, any>[] {
  return getConn()
    .prepare(
      "SELECT * FROM applications WHERE status IN ('applied','failed','discarded') ORDER BY COALESCE(created_at, applied_at) DESC"
    )
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

export function getManualQueue(): Record<string, any>[] {
  return getConn()
    .prepare("SELECT * FROM manual_queue ORDER BY added_at DESC")
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

export function incrementApiUsage(modelKey: string): void {
  const today = new Date().toISOString().split("T")[0];
  const provider = modelKey.includes("/")
    ? modelKey.split("/")[0]
    : modelKey;
  getConn()
    .prepare(
      "INSERT INTO api_usage (provider, model_key, call_date, call_count) VALUES (?,?,?,1) ON CONFLICT(provider, model_key, call_date) DO UPDATE SET call_count = call_count + 1"
    )
    .run(provider, modelKey, today);
}

export function getApiUsageToday(): Record<string, number> {
  const today = new Date().toISOString().split("T")[0];
  const rows = getConn()
    .prepare("SELECT model_key, call_count FROM api_usage WHERE call_date=?")
    .all(today) as { model_key: string; call_count: number }[];
  const result: Record<string, number> = {};
  for (const r of rows) result[r.model_key] = r.call_count;
  return result;
}
