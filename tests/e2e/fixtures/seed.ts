import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import type { APIRequestContext } from "@playwright/test";

const TEST_DB = resolve(__dirname, "../.test.db");
const LINKEDIN_PROFILE = join(homedir(), ".jobbot-chrome");
const LINKEDIN_COOKIES = join(LINKEDIN_PROFILE, "Default", "Cookies");
const FIXTURE_RESUME = resolve(__dirname, "./fixture-resume.txt");

function openDb(): Database.Database {
  mkdirSync(dirname(TEST_DB), { recursive: true });
  console.log(`[seed] opening ${TEST_DB}`);
  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  return db;
}

function applySchema(db: Database.Database): void {
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
      model_used TEXT,
      fit_score INTEGER,
      keyword_score INTEGER,
      hardreq_score INTEGER,
      parseability_score INTEGER,
      requirements_json TEXT
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

function writeFixtureResume(): string {
  mkdirSync(dirname(FIXTURE_RESUME), { recursive: true });
  writeFileSync(
    FIXTURE_RESUME,
    `Alex Smith
alex.smith@example.com • +1 555 000 1212 • linkedin.com/in/alexsmith

PROFESSIONAL EXPERIENCE
Acme Corp | Remote | Jan 2020 – Dec 2024
Senior Engineer
• Led backend services in Python and TypeScript
• Shipped AWS-based infra with Terraform

EDUCATION
MIT | Cambridge | 2014 – 2018
BSc Computer Science

SKILLS
Python, TypeScript, AWS, React

CERTIFICATES
AWS Solutions Architect

LANGUAGES
English – Native
`,
    "utf-8"
  );
  return FIXTURE_RESUME;
}

export interface SeedOptions {
  withApplications?: boolean;
  linkedinConnected?: boolean;
  setupComplete?: boolean;
}

export function reset(): void {
  rmSync(TEST_DB, { force: true });
  rmSync(TEST_DB + "-shm", { force: true });
  rmSync(TEST_DB + "-wal", { force: true });
}

// Tell the running dev server to close its cached SQLite connection. The next
// request will reopen against whatever file currently lives at TEST_DB.
export async function dropServerConnection(request: APIRequestContext): Promise<void> {
  try {
    await request.post(`/api/test-reset`);
  } catch {
    // server may not be reachable yet on the very first call — ignore
  }
}

// Convenience: do the whole cycle (drop server connection → reset → seed →
// drop again). The trailing drop guarantees the server reopens against the
// freshly seeded file on its next read.
export async function prepare(
  request: APIRequestContext,
  opts: SeedOptions = {}
): Promise<void> {
  await dropServerConnection(request);
  reset();
  seed(opts);
  await dropServerConnection(request);
}

export function disconnectLinkedinFixture(): void {
  rmSync(LINKEDIN_PROFILE, { recursive: true, force: true });
}

export function connectLinkedinFixture(): void {
  mkdirSync(join(LINKEDIN_PROFILE, "Default"), { recursive: true });
  writeFileSync(LINKEDIN_COOKIES, "fake-cookies-for-tests", "utf-8");
}

export function seed(opts: SeedOptions = {}): { db: Database.Database; resumePath: string } {
  const db = openDb();
  applySchema(db);
  const resumePath = writeFixtureResume();

  if (opts.setupComplete !== false) {
    const cfg = db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );
    cfg.run("name", "Alex Smith");
    cfg.run("email", "alex.smith@example.com");
    cfg.run("phone", "+1 5550001212");
    cfg.run("master_resume_path", resumePath);
    cfg.run("active_provider", "groq");
    const count = (db.prepare("SELECT COUNT(*) AS n FROM config").get() as { n: number }).n;
    console.log(`[seed] wrote config rows: ${count}`);
  } else {
    console.log(`[seed] setupComplete:false — no config written`);
  }

  if (opts.withApplications) {
    const camp = db
      .prepare(
        "INSERT INTO campaigns (name, titles, locations, status, started_at) VALUES (?,?,?,'running',?)"
      )
      .run("Backend Engineer", "Backend Engineer", "Remote", new Date().toISOString());
    const campId = Number(camp.lastInsertRowid);

    const insertApp = db.prepare(
      `INSERT INTO applications
        (campaign_id, company, title, location, url, status, easy_apply, created_at,
         job_description, fit_score, keyword_score, hardreq_score, parseability_score,
         fit_summary, jd_summary, requirements_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const reqJson = JSON.stringify({
      required_keywords: ["Python", "AWS"],
      preferred_keywords: ["Terraform"],
      hard_requirements: [
        { text: "5+ years backend engineering", met: true, evidence: "Senior Engineer 2020-2024" },
        { text: "BSc in CS or related", met: true, evidence: "BSc Computer Science, MIT" },
      ],
    });

    const fitSummary =
      "JD_SUMMARY: Backend engineering role focused on Python services on AWS.\n" +
      "STRENGTHS: Python, AWS\nGAPS: Kubernetes\nVERDICT: Strong match — recommend applying.";

    // High-fit easy apply
    insertApp.run(
      campId,
      "Acme",
      "Backend Engineer",
      "Remote",
      "https://example.com/test/jobs/easy-high",
      "reviewed",
      1,
      new Date().toISOString(),
      "Backend engineer role. Python required. AWS required. Terraform preferred. 5+ years experience. BSc required.",
      82,
      78,
      100,
      90,
      fitSummary,
      "Backend engineering role focused on Python services on AWS.",
      reqJson
    );

    // Low-fit easy apply (to test the warning)
    insertApp.run(
      campId,
      "Globex",
      "Rust Systems Engineer",
      "Berlin",
      "https://example.com/test/jobs/easy-low",
      "reviewed",
      1,
      new Date().toISOString(),
      "Senior systems role. Rust required. C++ required. Linux kernel required.",
      35,
      0,
      50,
      90,
      fitSummary.replace("Strong match", "Likely a stretch"),
      "Systems role requiring Rust and kernel expertise.",
      JSON.stringify({
        required_keywords: ["Rust", "C++", "Linux kernel"],
        preferred_keywords: ["eBPF"],
        hard_requirements: [
          { text: "Rust production experience", met: false, evidence: "" },
          { text: "C++ production experience", met: false, evidence: "" },
        ],
      })
    );

    // Manual apply (no easy)
    insertApp.run(
      campId,
      "Initech",
      "Product Manager",
      "London",
      "https://example.com/test/jobs/manual",
      "reviewed",
      0,
      new Date().toISOString(),
      "PM role — apply via our careers site.",
      55,
      40,
      100,
      90,
      fitSummary,
      "Product Manager role.",
      reqJson
    );
  }

  if (opts.linkedinConnected) connectLinkedinFixture();
  else disconnectLinkedinFixture();

  db.close();
  return { db, resumePath };
}
