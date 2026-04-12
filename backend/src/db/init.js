const { Pool } = require('pg');

/**
 * Initialize PostgreSQL connection pool and ensure schema exists.
 * Returns a pg.Pool instance for use throughout the application.
 */
async function initDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Verify connectivity
  const client = await pool.connect();
  try {
    // Create videos table with PostgreSQL-native types
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        description   TEXT DEFAULT '',
        filename      TEXT NOT NULL,
        original_path TEXT DEFAULT '',
        file_size     BIGINT,
        status        TEXT DEFAULT 'ready',
        category      TEXT DEFAULT 'uncategorized',
        tags          JSONB DEFAULT '[]'::jsonb,
        s3_key        TEXT,
        s3_url        TEXT,
        source_url    TEXT,
        duration      DOUBLE PRECISION,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Create indexes for common queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
      CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category);
      CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
    `);

    console.log('📦 PostgreSQL database initialized');
  } finally {
    client.release();
  }

  return pool;
}

module.exports = { initDatabase };
