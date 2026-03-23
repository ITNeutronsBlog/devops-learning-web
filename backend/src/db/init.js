const Database = require('better-sqlite3');
const path = require('path');

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
      original_path TEXT NOT NULL,
      hls_path      TEXT,
      thumbnail     TEXT,
      duration      REAL,
      file_size     INTEGER,
      status        TEXT DEFAULT 'uploaded',
      category      TEXT DEFAULT 'uncategorized',
      tags          TEXT DEFAULT '[]',
      source_url    TEXT,
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

  console.log('📦 Database initialized at:', dbPath);
  return db;
}

module.exports = { initDatabase };
