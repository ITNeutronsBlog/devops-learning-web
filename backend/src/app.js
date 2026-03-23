const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/init');
const videoRoutes = require('./routes/videos');
const healthRoutes = require('./routes/health');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Data directory setup
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data', 'videos');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STREAMS_DIR = path.join(DATA_DIR, 'streams');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');

[DATA_DIR, UPLOADS_DIR, STREAMS_DIR, THUMBNAILS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize database
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'database.sqlite');
const db = initDatabase(DB_PATH);

// Make db and paths available to routes
app.locals.db = db;
app.locals.DATA_DIR = DATA_DIR;
app.locals.UPLOADS_DIR = UPLOADS_DIR;
app.locals.STREAMS_DIR = STREAMS_DIR;
app.locals.THUMBNAILS_DIR = THUMBNAILS_DIR;

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080,http://localhost:3000').split(',');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Serve frontend static files
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
}

// Serve HLS streams
app.use('/streams', express.static(STREAMS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
}));

// Serve thumbnails
app.use('/thumbnails', express.static(THUMBNAILS_DIR));

// API routes
app.use('/api/health', healthRoutes);
app.use('/api', videoRoutes);

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/streams') && !req.path.startsWith('/thumbnails')) {
    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
