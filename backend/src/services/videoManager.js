const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { uploadToR2, deleteFromR2, isConfigured } = require('./storage');

class VideoManager {
  constructor(pool, dirs) {
    this.pool = pool;
    this.uploadsDir = dirs.UPLOADS_DIR;
  }

  /**
   * List videos with filtering, search, sort, and pagination
   */
  async listVideos({ search, category, status, sort = 'created_at', order = 'desc', page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category && category !== 'all') {
      conditions.push(`category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }
    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Whitelist sort columns to prevent SQL injection
    const allowedSorts = ['created_at', 'title', 'duration', 'file_size'];
    const sortColumn = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * limit;

    // Count total
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM videos ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Fetch page — limit/offset appended as positional params
    const dataParams = [...params, limit, offset];
    const videos = await this.pool.query(
      `SELECT * FROM videos ${whereClause} ORDER BY ${sortColumn} ${sortOrder} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams
    );

    return {
      videos: videos.rows.map(v => ({
        ...v,
        tags: v.tags || [],                        // JSONB → already a JS array
        file_size: v.file_size ? Number(v.file_size) : null   // BIGINT → Number
      })),
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
  async getVideo(id) {
    const result = await this.pool.query('SELECT * FROM videos WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const video = result.rows[0];
    video.tags = video.tags || [];
    video.file_size = video.file_size ? Number(video.file_size) : null;
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

    await this.pool.query(`
      INSERT INTO videos (id, title, description, filename, original_path, file_size, category, tags, status, s3_key, s3_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      id,
      title,
      description,
      file.filename || file.originalname,
      file.path || '',
      file.size,
      category,
      JSON.stringify(tags),    // pg driver auto-converts to JSONB
      'ready',
      s3Key,
      s3Url
    ]);

    return this.getVideo(id);
  }

  /**
   * Update video metadata
   */
  async updateVideo(id, updates) {
    const allowed = ['title', 'description', 'category', 'tags'];
    const fields = [];
    const params = [id];      // $1 is always 'id'
    let paramIndex = 2;

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        if (key === 'tags') {
          fields.push(`${key} = $${paramIndex}`);
          params.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = $${paramIndex}`);
          params.push(updates[key]);
        }
        paramIndex++;
      }
    }

    if (fields.length === 0) return this.getVideo(id);

    fields.push('updated_at = NOW()');

    await this.pool.query(
      `UPDATE videos SET ${fields.join(', ')} WHERE id = $1`,
      params
    );
    return this.getVideo(id);
  }

  /**
   * Delete a video and its R2 object
   */
  async deleteVideo(id) {
    const video = await this.getVideo(id);
    if (!video) return false;

    // Delete from R2
    if (video.s3_key) {
      await deleteFromR2(video.s3_key);
    }

    // Delete DB record
    await this.pool.query('DELETE FROM videos WHERE id = $1', [id]);

    return true;
  }

  /**
   * Get all unique categories
   */
  async getCategories() {
    const result = await this.pool.query(
      'SELECT DISTINCT category, COUNT(*) as count FROM videos GROUP BY category ORDER BY count DESC'
    );
    return result.rows;
  }
}

module.exports = VideoManager;
