const path = require('path');
const fs = require('fs');

/**
 * Get human-readable file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Get disk usage stats for a directory
 */
function getDiskUsage(dirPath) {
  let totalSize = 0;
  let fileCount = 0;

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stat = fs.statSync(fullPath);
        totalSize += stat.size;
        fileCount++;
      }
    }
  }

  walkDir(dirPath);
  return { totalSize, fileCount, formatted: formatFileSize(totalSize) };
}

/**
 * Delete a directory recursively
 */
function deleteDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Generate a safe filename from a title
 */
function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\-_. ]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

module.exports = { formatFileSize, getDiskUsage, deleteDirectory, sanitizeFilename };
