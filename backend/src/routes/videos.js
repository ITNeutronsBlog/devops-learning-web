const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const VideoManager = require('../services/videoManager');
const { downloadVideo, isYtdlpAvailable } = require('../services/ytdlp');

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    cb(null, req.app.locals.UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /video\/(mp4|webm|mkv|avi|mov|x-matroska|quicktime)/;
    const allowedExts = /\.(mp4|webm|mkv|avi|mov)$/i;
    if (allowedTypes.test(file.mimetype) || allowedExts.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  }
});

// Helper to get VideoManager instance
function getManager(req) {
  if (!req.app.locals._videoManager) {
    req.app.locals._videoManager = new VideoManager(req.app.locals.db, {
      UPLOADS_DIR: req.app.locals.UPLOADS_DIR,
      STREAMS_DIR: req.app.locals.STREAMS_DIR,
      THUMBNAILS_DIR: req.app.locals.THUMBNAILS_DIR
    });
  }
  return req.app.locals._videoManager;
}

// ———————————————————————————————————————
// GET /api/videos — List all videos
// ———————————————————————————————————————
router.get('/videos', (req, res) => {
  const manager = getManager(req);
  const { search, category, status, sort, order, page, limit } = req.query;

  const result = manager.listVideos({
    search,
    category,
    status,
    sort,
    order,
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20
  });

  res.json(result);
});

// ———————————————————————————————————————
// GET /api/categories — List categories
// ———————————————————————————————————————
router.get('/categories', (req, res) => {
  const manager = getManager(req);
  res.json(manager.getCategories());
});

// ———————————————————————————————————————
// GET /api/videos/:id — Get video details
// ———————————————————————————————————————
router.get('/videos/:id', (req, res) => {
  const manager = getManager(req);
  const video = manager.getVideo(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json(video);
});

// ———————————————————————————————————————
// POST /api/videos/upload — Upload a video
// ———————————————————————————————————————
router.post('/videos/upload', upload.single('video'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const manager = getManager(req);
    const metadata = {
      title: req.body.title || req.file.originalname,
      description: req.body.description || '',
      category: req.body.category || 'uncategorized',
      tags: req.body.tags ? JSON.parse(req.body.tags) : []
    };

    const video = manager.createVideo(req.file, metadata);

    // Auto-start transcoding
    manager.startTranscode(video.id).catch(err => {
      console.error('Background transcode error:', err.message);
    });

    res.status(201).json(video);
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// POST /api/videos/download — Download from YouTube
// ———————————————————————————————————————
router.post('/videos/download', async (req, res, next) => {
  try {
    const { url, category = 'uncategorized', tags = [] } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (!isYtdlpAvailable()) {
      return res.status(503).json({ error: 'yt-dlp is not installed on the server' });
    }

    const manager = getManager(req);

    // Download
    const result = await downloadVideo(url, req.app.locals.UPLOADS_DIR);

    // Register in database
    const video = manager.createVideo(
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
    req.app.locals.db.prepare('UPDATE videos SET source_url = ? WHERE id = ?').run(url, video.id);

    // Auto-start transcoding
    manager.startTranscode(video.id).catch(err => {
      console.error('Background transcode error:', err.message);
    });

    res.status(201).json({ ...video, source_url: url });
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// PUT /api/videos/:id — Update metadata
// ———————————————————————————————————————
router.put('/videos/:id', (req, res) => {
  const manager = getManager(req);
  const video = manager.updateVideo(req.params.id, req.body);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json(video);
});

// ———————————————————————————————————————
// DELETE /api/videos/:id — Delete video
// ———————————————————————————————————————
router.delete('/videos/:id', (req, res) => {
  const manager = getManager(req);
  const deleted = manager.deleteVideo(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Video not found' });
  res.json({ message: 'Video deleted successfully' });
});

// ———————————————————————————————————————
// POST /api/videos/:id/transcode — Trigger transcode
// ———————————————————————————————————————
router.post('/videos/:id/transcode', async (req, res, next) => {
  try {
    const manager = getManager(req);
    const video = manager.getVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    manager.startTranscode(req.params.id).catch(err => {
      console.error('Background transcode error:', err.message);
    });

    res.json({ message: 'Transcoding started', id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ———————————————————————————————————————
// GET /api/videos/:id/status — Get transcode status
// ———————————————————————————————————————
router.get('/videos/:id/status', (req, res) => {
  const manager = getManager(req);
  const status = manager.getTranscodeStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'Video not found' });
  res.json(status);
});

module.exports = router;
