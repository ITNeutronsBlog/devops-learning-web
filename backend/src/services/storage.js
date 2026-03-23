const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Initialize R2 client
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'devops-videos';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

let s3Client = null;

function getClient() {
  if (!s3Client && R2_ACCOUNT_ID) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return s3Client;
}

/**
 * Check if R2 storage is configured
 */
function isConfigured() {
  return !!(R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

/**
 * Upload a file to R2
 * @param {string} filePath - Local file path
 * @param {string} key - S3 key (e.g., "videos/uuid.mp4")
 * @returns {Promise<{key: string, url: string, size: number}>}
 */
async function uploadToR2(filePath, key) {
  const client = getClient();
  if (!client) throw new Error('R2 storage is not configured');

  const fileStream = fs.createReadStream(filePath);
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Determine content type
  const contentTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime'
  };

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fileStream,
    ContentType: contentTypes[ext] || 'video/mp4',
    ContentLength: stat.size
  });

  await client.send(command);
  console.log(`☁️  Uploaded to R2: ${key} (${(stat.size / 1048576).toFixed(1)} MB)`);

  return {
    key,
    url: `${R2_PUBLIC_URL}/${key}`,
    size: stat.size
  };
}

/**
 * Delete a file from R2
 * @param {string} key - S3 key to delete
 */
async function deleteFromR2(key) {
  const client = getClient();
  if (!client) return;

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key
    }));
    console.log(`🗑️  Deleted from R2: ${key}`);
  } catch (err) {
    console.warn(`⚠️  Failed to delete from R2: ${key}`, err.message);
  }
}

/**
 * Get the public URL for a key
 */
function getPublicUrl(key) {
  return `${R2_PUBLIC_URL}/${key}`;
}

module.exports = { uploadToR2, deleteFromR2, getPublicUrl, isConfigured };
