const express = require('express');
const router = express.Router();
const os = require('os');
const { getDiskUsage } = require('../utils/fileUtils');
const { execSync } = require('child_process');

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const DATA_DIR = req.app.locals.DATA_DIR;

  // Check FFmpeg
  let ffmpegVersion = 'not found';
  try {
    ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf-8' })
      .split('\n')[0];
  } catch (_e) {
    // FFmpeg not available
  }

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
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'transcoding' THEN 1 ELSE 0 END) as transcoding,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errored
    FROM videos
  `).get();

  const diskUsage = getDiskUsage(DATA_DIR);

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
      ffmpeg: ffmpegVersion,
      ytdlp: ytdlpVersion
    },
    storage: {
      path: DATA_DIR,
      used: diskUsage.formatted,
      files: diskUsage.fileCount
    },
    videos: stats
  });
});

module.exports = router;
