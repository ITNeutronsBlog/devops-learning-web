const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

createApp()
  .then(app => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DevOps Learning Server running on port ${PORT}`);
      console.log(`📁 Data directory: ${process.env.DATA_DIR || './data/videos'}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🐘 Database: PostgreSQL (pool connected)`);
    });

    // Graceful shutdown — close pool and server on termination signals
    const shutdown = async (signal) => {
      console.log(`\n⏹️  ${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        try {
          await app.locals.pool.end();
          console.log('📦 PostgreSQL pool closed');
        } catch (err) {
          console.error('Error closing pool:', err);
        }
        process.exit(0);
      });

      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.error('Forced exit after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
