const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/init');
const videoRoutes = require('./routes/videos');
const healthRoutes = require('./routes/health');
const { errorHandler } = require('./middleware/errorHandler');

/**
 * Create and configure the Express application.
 * Returns a Promise that resolves to the app instance once the
 * PostgreSQL pool is initialized and schema is verified.
 */
async function createApp() {
  const app = express();

  // Data directory setup
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data', 'videos');
  const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

  [DATA_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Initialize PostgreSQL pool
  const pool = await initDatabase();

  // Make pool and paths available to routes
  app.locals.pool = pool;
  app.locals.DATA_DIR = DATA_DIR;
  app.locals.UPLOADS_DIR = UPLOADS_DIR;

  // Middleware
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080,http://localhost:3005').split(',');
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Serve frontend static files
  const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend');
  if (fs.existsSync(FRONTEND_DIR)) {
    app.use(express.static(FRONTEND_DIR));
  }

  // API routes
  app.use('/api/health', healthRoutes);
  app.use('/api', videoRoutes);

  // Serve local videos backward compatibility
  app.use('/videos', express.static(UPLOADS_DIR));

  // SPA fallback — serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      const indexPath = path.join(FRONTEND_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
    }
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
