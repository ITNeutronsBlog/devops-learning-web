const express = require('express');
const router = express.Router();
const os = require('os');
const { execSync } = require('child_process');
const { isConfigured } = require('../services/storage');

router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;

  // Check yt-dlp
  let ytdlpVersion = 'not found';
  try {
    ytdlpVersion = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
  } catch (_e) {
    // yt-dlp not available
  }

  // Video stats (async PostgreSQL query)
  let stats = { total: 0, ready: 0 };
  let dbStatus = 'disconnected';
  let poolInfo = {};

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready
      FROM videos
    `);
    stats = {
      total: parseInt(result.rows[0].total, 10),
      ready: parseInt(result.rows[0].ready || 0, 10)
    };
    dbStatus = 'connected';
    poolInfo = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    system: {
      platform: os.platform(),
      memory: {
        total: `${(os.totalmem() / 1073741824).toFixed(1)} GB`,
        free: `${(os.freemem() / 1073741824).toFixed(1)} GB`,
        usage: `${((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)}%`
      },
      cpus: os.cpus().length
    },
    database: {
      type: 'PostgreSQL',
      status: dbStatus,
      pool: poolInfo
    },
    tools: {
      ytdlp: ytdlpVersion
    },
    storage: {
      type: isConfigured() ? 'Cloudflare R2' : 'local (R2 not configured)',
      bucket: process.env.R2_BUCKET_NAME || 'not set'
    },
    videos: stats
  });
});

module.exports = router;
