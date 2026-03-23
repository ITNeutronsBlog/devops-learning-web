const express = require('express');
const router = express.Router();
const os = require('os');
const { execSync } = require('child_process');
const { isConfigured } = require('../services/storage');

router.get('/', (req, res) => {
  const db = req.app.locals.db;

  // Check yt-dlp
  let ytdlpVersion = 'not found';
  try {
    ytdlpVersion = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
  } catch (_e) {
    // yt-dlp not available
  }

  // Video stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready
    FROM videos
  `).get();

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
