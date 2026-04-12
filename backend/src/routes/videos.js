const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const VideoManager = require('../services/videoManager');
const { getPresignedUploadUrl, isConfigured, streamFromR2 } = require('../services/storage');
const { downloadVideo, isYtdlpAvailable } = require('../services/ytdlp');

// Helper to get VideoManager instance (now uses pool instead of db)
function getManager(req) {
  if (!req.app.locals._videoManager) {
    req.app.locals._videoManager = new VideoManager(req.app.locals.pool, {
      UPLOADS_DIR: req.app.locals.UPLOADS_DIR
    });
  }
  return req.app.locals._videoManager;
}

// ———————————————————————————————————————
// GET /api/videos — List all videos
// ———————————————————————————————————————
router.get('/videos', async (req, res, next) => {
  try {
    const manager = getManager(req);
    const { search, category, status, sort, order, page, limit } = req.query;

    const result = await manager.listVideos({
      search,
      category,
      status,
      sort,
      order,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// GET /api/categories — List categories
// ———————————————————————————————————————
router.get('/categories', async (req, res, next) => {
  try {
    const manager = getManager(req);
    res.json(await manager.getCategories());
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// GET /api/videos/:id — Get video details
// ———————————————————————————————————————
router.get('/videos/:id', async (req, res, next) => {
  try {
    const manager = getManager(req);
    const video = await manager.getVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json(video);
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// GET /api/videos/:id/stream — Stream video via proxy (Bypass Office Firewall)
// ———————————————————————————————————————
router.get('/videos/:id/stream', async (req, res) => {
  try {
    const manager = getManager(req);
    const video = await manager.getVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    if (video.s3_key && isConfigured()) {
      // 1. Stream from R2
      try {
        const range = req.headers.range;
        const response = await streamFromR2(video.s3_key, range);

        // Forward R2 headers explicitly
        if (response.contentLength) res.setHeader('Content-Length', response.contentLength);
        if (response.contentType) res.setHeader('Content-Type', response.contentType);
        if (response.acceptRanges) res.setHeader('Accept-Ranges', response.acceptRanges);
        if (response.contentRange) res.setHeader('Content-Range', response.contentRange);

        res.status(response.status || (range ? 206 : 200));

        // Let Express pipe the S3 readStream to the browser
        response.body.pipe(res);
      } catch (err) {
        if (err.name === 'NoSuchKey') {
          return res.status(404).json({ error: 'Video file missing from cloud storage' });
        }
        throw err;
      }
    } else if (video.original_path || video.filename) {
      // 2. Fallback: Stream local legacy file
      const UPLOADS_DIR = req.app.locals.UPLOADS_DIR;
      const filePath = video.original_path || path.join(UPLOADS_DIR, video.filename);
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Local video file missing' });
      }

      const stat = fs.statSync(filePath);
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = (end - start) + 1;

        const file = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4'
        });
        file.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': 'video/mp4'
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } else {
      res.status(400).json({ error: 'Video source not available' });
    }
  } catch (err) {
    console.error('Streaming error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming proxy failed' });
    }
  }
});

// ———————————————————————————————————————
// POST /api/videos/presign — Get presigned URL for direct browser → R2 upload
// Browser uploads directly to R2, server never touches the video file
// ———————————————————————————————————————
router.post('/videos/presign', async (req, res, next) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'R2 storage is not configured' });
    }

    const { filename, contentType = 'video/mp4' } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const id = uuidv4();
    const ext = path.extname(filename) || '.mp4';
    const s3Key = `videos/${id}${ext}`;

    const { uploadUrl, publicUrl } = await getPresignedUploadUrl(s3Key, contentType);

    res.json({
      id,
      s3Key,
      uploadUrl,
      publicUrl
    });
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// POST /api/videos/register — Register video in DB after direct R2 upload
// Called by the browser after the file has been uploaded to R2
// ———————————————————————————————————————
router.post('/videos/register', async (req, res, next) => {
  try {
    const { id, s3Key, publicUrl, filename, fileSize, title, description, category, tags } = req.body;

    if (!id || !s3Key) {
      return res.status(400).json({ error: 'id and s3Key are required' });
    }

    const pool = req.app.locals.pool;

    await pool.query(`
      INSERT INTO videos (id, title, description, filename, original_path, file_size, category, tags, status, s3_key, s3_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      id,
      title || filename || 'Untitled',
      description || '',
      filename || `${id}.mp4`,
      '',
      fileSize || 0,
      category || 'uncategorized',
      JSON.stringify(tags || []),
      'ready',
      s3Key,
      publicUrl || ''
    ]);

    const manager = getManager(req);
    const video = await manager.getVideo(id);
    res.status(201).json(video);
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// POST /api/videos/download — YouTube → R2 (still goes through server)
// ———————————————————————————————————————
router.post('/videos/download', async (req, res, next) => {
  try {
    const { url, category = 'uncategorized', tags = [] } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (!isYtdlpAvailable()) {
      return res.status(503).json({ error: 'yt-dlp is not installed on the server' });
    }

    const manager = getManager(req);

    // Download to temp directory
    const result = await downloadVideo(url, req.app.locals.UPLOADS_DIR);

    // Upload to R2 and register in DB
    const video = await manager.createVideo(
      {
        originalname: result.metadata.title || result.filename,
        filename: result.filename,
        path: result.path,
        size: result.size
      },
      {
        title: result.metadata.title || result.filename,
        description: result.metadata.description || '',
        category,
        tags
      }
    );

    // Update source URL
    await req.app.locals.pool.query('UPDATE videos SET source_url = $1 WHERE id = $2', [url, video.id]);

    res.status(201).json({ ...video, source_url: url });
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// PUT /api/videos/:id — Update metadata
// ———————————————————————————————————————
router.put('/videos/:id', async (req, res, next) => {
  try {
    const manager = getManager(req);
    const video = await manager.updateVideo(req.params.id, req.body);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json(video);
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// DELETE /api/videos/:id — Delete video
// ———————————————————————————————————————
router.delete('/videos/:id', async (req, res, next) => {
  try {
    const manager = getManager(req);
    const deleted = await manager.deleteVideo(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Video not found' });
    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
