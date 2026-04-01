import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../../../data");
const dbPath = resolve(dataDir, "cache.db");

let db: SqlJsDatabase;

async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  const SQL = await initSqlJs();
  mkdirSync(dataDir, { recursive: true });

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS taste_analysis (
      spotify_user_id TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  saveDb();
  return db;
}

function saveDb(): void {
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

const CACHE_DAYS = 5;

export async function getCachedAnalysis(userId: string): Promise<any | null> {
  const database = await getDb();
  const result = database.exec(
    `SELECT result_json FROM taste_analysis
     WHERE spotify_user_id = ?
     AND datetime(created_at, '+${CACHE_DAYS} days') > datetime('now')`,
    [userId]
  );

  if (result.length === 0 || result[0].values.length === 0) return null;
  return JSON.parse(result[0].values[0][0] as string);
}

export async function setCachedAnalysis(userId: string, data: any): Promise<void> {
  const database = await getDb();
  database.run(
    `INSERT INTO taste_analysis (spotify_user_id, result_json, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(spotify_user_id)
     DO UPDATE SET result_json = excluded.result_json, created_at = datetime('now')`,
    [userId, JSON.stringify(data)]
  );
  saveDb();
}
