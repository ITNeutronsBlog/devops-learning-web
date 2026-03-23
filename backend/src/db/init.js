const Database = require('better-sqlite3');

function initDatabase(dbPath) {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create videos table
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT DEFAULT '',
      filename      TEXT NOT NULL,
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

  // Migrate: add R2 columns if missing (for existing databases)
  const columns = db.prepare('PRAGMA table_info(videos)').all().map(c => c.name);
  if (!columns.includes('s3_key')) {
    db.exec('ALTER TABLE videos ADD COLUMN s3_key TEXT');
    db.exec('ALTER TABLE videos ADD COLUMN s3_url TEXT');
    console.log('📦 Migrated: added s3_key, s3_url columns');
  }

  console.log('📦 Database initialized at:', dbPath);
  return db;
}

module.exports = { initDatabase };
