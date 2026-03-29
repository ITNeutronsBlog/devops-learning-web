const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');

// Initialize R2 client
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'devops-videos';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

let s3Client = null;

function getClient() {
  if (!s3Client && R2_ACCOUNT_ID) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      },
      // Disable automatic checksum — R2 doesn't support it and it breaks CORS
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
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
 * Generate a presigned PUT URL for direct browser → R2 upload
 * @param {string} key - S3 key (e.g., "videos/uuid.mp4")
 * @param {string} contentType - MIME type
 * @param {number} expiresIn - URL validity in seconds (default 1 hour)
 * @returns {Promise<{uploadUrl: string, key: string, publicUrl: string}>}
 */
async function getPresignedUploadUrl(key, contentType = 'video/mp4', expiresIn = 3600) {
  const client = getClient();
  if (!client) throw new Error('R2 storage is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to environment.');

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  return {
    uploadUrl,
    key,
    publicUrl: `${R2_PUBLIC_URL}/${key}`
  };
}

/**
 * Upload a file from disk to R2 (used for yt-dlp downloads)
 */
async function uploadToR2(filePath, key) {
  const client = getClient();
  if (!client) throw new Error('R2 storage is not configured');

  const fileStream = fs.createReadStream(filePath);
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

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

module.exports = { uploadToR2, deleteFromR2, getPublicUrl, isConfigured, getPresignedUploadUrl };
