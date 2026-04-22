import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

let db: Database.Database | null = null

function getDataDir(): string {
  const dir = join(app.getPath('home'), '.iap-manager')
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700, recursive: true })
  }
  return dir
}

export function getDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(getDataDir(), 'data.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  )

  const migrations: { name: string; sql: string }[] = [
    {
      name: '001-init',
      sql: `
        CREATE TABLE projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          created_at  TEXT DEFAULT (datetime('now')),
          updated_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE project_credentials (
          project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          has_apple   INTEGER NOT NULL DEFAULT 0,
          has_google  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE apple_products (
          id              TEXT PRIMARY KEY,
          project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          product_id      TEXT,
          reference_name  TEXT,
          product_type    TEXT,
          state           TEXT,
          synced_at       TEXT
        );

        CREATE TABLE google_products (
          id              TEXT PRIMARY KEY,
          project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          product_id      TEXT,
          name            TEXT,
          description     TEXT,
          status          TEXT,
          synced_at       TEXT
        );
      `
    },
    {
      name: '002-apple-available',
      sql: `
        ALTER TABLE apple_products ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
      `
    },
    {
      name: '003-apple-territory-count',
      sql: `
        ALTER TABLE apple_products ADD COLUMN territory_count INTEGER NOT NULL DEFAULT 0;
      `
    },
    {
      name: '004-sort-order',
      sql: `
        ALTER TABLE apple_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE google_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      `
    },
    {
      name: '005-google-purchase-option-id',
      sql: `
        ALTER TABLE google_products ADD COLUMN purchase_option_id TEXT;
      `
    },
    {
      name: '006-project-sort-order',
      sql: `
        ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        UPDATE projects SET sort_order = rowid;
      `
    },
    {
      name: '007-apple-base-price',
      sql: `
        ALTER TABLE apple_products ADD COLUMN base_price TEXT;
        ALTER TABLE apple_products ADD COLUMN base_currency TEXT;
      `
    },
    {
      name: '008-google-default-language',
      sql: `
        ALTER TABLE project_credentials ADD COLUMN google_default_language TEXT;
      `
    }
  ]

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      db.exec(migration.sql)
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name)
    }
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
