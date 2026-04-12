#!/usr/bin/env node
/**
 * One-time data migration: SQLite → PostgreSQL
 *
 * Usage:
 *   DATABASE_URL=postgres://devops:pass@localhost:5432/devops_learning \
 *   SQLITE_PATH=/data/videos/database.sqlite \
 *   node migrate-sqlite-to-pg.js
 *
 * Prerequisites:
 *   npm install better-sqlite3 pg
 */

const Database = require('better-sqlite3');
const { Pool } = require('pg');

async function migrate() {
  const sqlitePath = process.env.SQLITE_PATH;
  const databaseUrl = process.env.DATABASE_URL;

  if (!sqlitePath || !databaseUrl) {
    console.error('Usage: SQLITE_PATH=... DATABASE_URL=... node migrate-sqlite-to-pg.js');
    process.exit(1);
  }

  console.log('🔄 Starting SQLite → PostgreSQL migration');
  console.log(`   SQLite: ${sqlitePath}`);
  console.log(`   PostgreSQL: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);

  // Open SQLite
  const sqlite = new Database(sqlitePath, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM videos').all();
  console.log(`📊 Found ${rows.length} videos in SQLite`);

  if (rows.length === 0) {
    console.log('✅ No data to migrate');
    sqlite.close();
    return;
  }

  // Connect to PostgreSQL
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Ensure table exists
    await pool.query(`
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

    // Migrate rows
    let migrated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        // Parse tags from JSON string to native JSONB
        let tags = '[]';
        try {
          tags = JSON.stringify(JSON.parse(row.tags || '[]'));
        } catch {
          tags = '[]';
        }

        await pool.query(`
          INSERT INTO videos (id, title, description, filename, original_path, file_size, status, category, tags, s3_key, s3_url, source_url, duration, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO NOTHING
        `, [
          row.id,
          row.title,
          row.description || '',
          row.filename,
          row.original_path || '',
          row.file_size,
          row.status || 'ready',
          row.category || 'uncategorized',
          tags,
          row.s3_key || null,
          row.s3_url || null,
          row.source_url || null,
          row.duration || null,
          row.created_at ? new Date(row.created_at) : new Date(),
          row.updated_at ? new Date(row.updated_at) : new Date()
        ]);
        migrated++;
      } catch (err) {
        console.error(`  ⚠️  Skipped row ${row.id}: ${err.message}`);
        skipped++;
      }
    }

    // Verify counts
    const pgCount = await pool.query('SELECT COUNT(*) as count FROM videos');
    const pgTotal = parseInt(pgCount.rows[0].count, 10);

    console.log('');
    console.log('═══════════════════════════════════');
    console.log(`✅ Migration complete`);
    console.log(`   SQLite rows:   ${rows.length}`);
    console.log(`   Migrated:      ${migrated}`);
    console.log(`   Skipped:       ${skipped}`);
    console.log(`   PG total rows: ${pgTotal}`);
    console.log('═══════════════════════════════════');
  } finally {
    sqlite.close();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
