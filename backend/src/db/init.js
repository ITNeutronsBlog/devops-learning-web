const Database = require('better-sqlite3');

function initDatabase(dbPath) {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create videos table (includes original_path for backward compat)
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT DEFAULT '',
      filename      TEXT NOT NULL,
      original_path TEXT DEFAULT '',
      file_size     INTEGER,
      status        TEXT DEFAULT 'ready',
      category      TEXT DEFAULT 'uncategorized',
      tags          TEXT DEFAULT '[]',
      s3_key        TEXT,
      s3_url        TEXT,
      source_url    TEXT,
      duration      REAL,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create index for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category);
    CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
  `);

  // Migrate: add any missing columns for existing databases
  const columns = db.prepare('PRAGMA table_info(videos)').all().map(c => c.name);
  const migrations = [
    { col: 's3_key', sql: 'ALTER TABLE videos ADD COLUMN s3_key TEXT' },
    { col: 's3_url', sql: 'ALTER TABLE videos ADD COLUMN s3_url TEXT' },
    { col: 'source_url', sql: 'ALTER TABLE videos ADD COLUMN source_url TEXT' }
  ];
  for (const m of migrations) {
    if (!columns.includes(m.col)) {
      db.exec(m.sql);
      console.log(`📦 Migrated: added ${m.col} column`);
    }
  }

  console.log('📦 Database initialized at:', dbPath);
  return db;
}

module.exports = { initDatabase };
