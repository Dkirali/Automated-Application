import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = join(__dirname, "test.db");

function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

export function resetDb(): void {
  const db = getDb();
  db.exec("DELETE FROM applications");
  db.exec("DELETE FROM campaigns");
  db.exec("DELETE FROM manual_queue");
  db.exec("DELETE FROM config");
  db.exec("DELETE FROM api_usage");
  db.close();
}

export function seedSetupComplete(): void {
  const db = getDb();
  const ins = db.prepare(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)"
  );
  ins.run("name", "Test User");
  ins.run("email", "test@example.com");
  ins.run("phone", "+1234567890");
  ins.run("master_resume_path", "/tmp/master.docx");
  db.close();
}

export function seedCampaign(opts: {
  status?: string;
  titles?: string;
  locations?: string;
} = {}): number {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO campaigns (name, titles, locations, status, started_at) VALUES (?,?,?,?,?)"
    )
    .run(
      opts.titles || "Engineer",
      opts.titles || "Engineer",
      opts.locations || "NYC",
      opts.status || "stopped",
      new Date().toISOString()
    );
  db.close();
  return Number(result.lastInsertRowid);
}

export function seedJob(opts: {
  campaignId: number;
  status?: string;
  company?: string;
  title?: string;
  fitScore?: number;
  atsScore?: number;
  originalAtsScore?: number;
  resumePath?: string;
  modelUsed?: string;
  url?: string;
  jobDescription?: string;
  fitSummary?: string;
  keywords?: string;
  jdSummary?: string;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO applications
        (campaign_id, company, title, location, url, status, ats_score,
         original_ats_score, resume_path, job_description, fit_summary,
         model_used, keywords, jd_summary, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      opts.campaignId,
      opts.company || "TestCo",
      opts.title || "Software Engineer",
      "NYC",
      opts.url || `https://linkedin.com/jobs/${Date.now()}-${Math.random()}`,
      opts.status || "pending",
      opts.atsScore ?? null,
      opts.originalAtsScore ?? null,
      opts.resumePath ?? null,
      opts.jobDescription || "A job description.",
      opts.fitSummary ?? null,
      opts.modelUsed ?? null,
      opts.keywords ?? null,
      opts.jdSummary ?? null,
      new Date().toISOString()
    );
  db.close();
  return Number(result.lastInsertRowid);
}

export function seedManualJob(campaignId: number, opts: { company?: string; title?: string } = {}): number {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO manual_queue (campaign_id, company, title, location, url, reason, added_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(
      campaignId,
      opts.company || "ManualCo",
      opts.title || "Manual Role",
      "Remote",
      `https://linkedin.com/manual/${Date.now()}-${Math.random()}`,
      "not_easy_apply",
      new Date().toISOString()
    );
  db.close();
  return Number(result.lastInsertRowid);
}

export function makeFitSummary(score: number): string {
  return `SCORE: ${score}\nVERDICT: Good match for the role\nSTRENGTHS: TypeScript, React, Node.js\nGAPS: None`;
}

export async function resetServer(baseURL: string): Promise<void> {
  await fetch(`${baseURL}/api/test-reset`, { method: "POST" });
}
