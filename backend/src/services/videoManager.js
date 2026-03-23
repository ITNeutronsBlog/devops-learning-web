const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { uploadToR2, deleteFromR2, isConfigured } = require('./storage');

class VideoManager {
  constructor(db, dirs) {
    this.db = db;
    this.uploadsDir = dirs.UPLOADS_DIR;
  }

  /**
   * List videos with filtering, search, sort, and pagination
   */
  listVideos({ search, category, status, sort = 'created_at', order = 'desc', page = 1, limit = 20 }) {
    let where = [];
    let params = {};

    if (search) {
      where.push('(title LIKE @search OR description LIKE @search)');
      params.search = `%${search}%`;
    }
    if (category && category !== 'all') {
      where.push('category = @category');
      params.category = category;
    }
    if (status) {
      where.push('status = @status');
      params.status = status;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const allowedSorts = ['created_at', 'title', 'duration', 'file_size'];
    const sortColumn = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * limit;

    const total = this.db.prepare(`SELECT COUNT(*) as count FROM videos ${whereClause}`).get(params).count;
    const videos = this.db.prepare(
      `SELECT * FROM videos ${whereClause} ORDER BY ${sortColumn} ${sortOrder} LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset });

    return {
      videos: videos.map(v => ({ ...v, tags: JSON.parse(v.tags || '[]') })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get a single video by ID
   */
  getVideo(id) {
    const video = this.db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) return null;
    video.tags = JSON.parse(video.tags || '[]');
    return video;
  }

  /**
   * Register a new video and upload to R2
   */
  async createVideo(file, metadata = {}) {
    const id = uuidv4();
    const { title = file.originalname, description = '', category = 'uncategorized', tags = [] } = metadata;

    const ext = path.extname(file.filename || file.originalname || '.mp4');
    const s3Key = `videos/${id}${ext}`;

    // Upload to R2
    let s3Url = '';
    if (isConfigured()) {
      const localPath = file.path || path.join(this.uploadsDir, file.filename);
      const result = await uploadToR2(localPath, s3Key);
      s3Url = result.url;

      // Delete local temp file after upload
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log('🧹 Cleaned up local temp file');
      }
    }

    this.db.prepare(`
      INSERT INTO videos (id, title, description, filename, original_path, file_size, category, tags, status, s3_key, s3_url)
      VALUES (@id, @title, @description, @filename, @original_path, @file_size, @category, @tags, @status, @s3_key, @s3_url)
    `).run({
      id,
      title,
      description,
      filename: file.filename || file.originalname,
      original_path: file.path || '',
      file_size: file.size,
      category,
      tags: JSON.stringify(tags),
      status: 'ready',
      s3_key: s3Key,
      s3_url: s3Url
    });

    return this.getVideo(id);
  }

  /**
   * Update video metadata
   */
  updateVideo(id, updates) {
    const allowed = ['title', 'description', 'category', 'tags'];
    const fields = [];
    const params = { id };

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        if (key === 'tags') {
          fields.push(`${key} = @${key}`);
          params[key] = JSON.stringify(updates[key]);
        } else {
          fields.push(`${key} = @${key}`);
          params[key] = updates[key];
        }
      }
    }

    if (fields.length === 0) return this.getVideo(id);

    fields.push("updated_at = datetime('now')");

    this.db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = @id`).run(params);
    return this.getVideo(id);
  }

  /**
   * Delete a video and its R2 object
   */
  async deleteVideo(id) {
    const video = this.getVideo(id);
    if (!video) return false;

    // Delete from R2
    if (video.s3_key) {
      await deleteFromR2(video.s3_key);
    }

    // Delete DB record
    this.db.prepare('DELETE FROM videos WHERE id = ?').run(id);

    return true;
  }

  /**
   * Get all unique categories
   */
  getCategories() {
    return this.db.prepare('SELECT DISTINCT category, COUNT(*) as count FROM videos GROUP BY category ORDER BY count DESC').all();
  }
}

module.exports = VideoManager;
