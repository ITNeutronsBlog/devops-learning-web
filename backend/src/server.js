const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DevOps Learning Server running on port ${PORT}`);
  console.log(`📁 Data directory: ${process.env.DATA_DIR || './data/videos'}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});
