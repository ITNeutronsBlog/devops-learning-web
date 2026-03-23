const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { transcodeToHLS, getVideoInfo, generateThumbnail } = require('./transcoder');
const { deleteDirectory } = require('../utils/fileUtils');

class VideoManager {
  constructor(db, dirs) {
    this.db = db;
    this.uploadsDir = dirs.UPLOADS_DIR;
    this.streamsDir = dirs.STREAMS_DIR;
    this.thumbnailsDir = dirs.THUMBNAILS_DIR;

    // Track active transcode jobs
    this.activeJobs = new Map();
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

    // Include transcode progress if active
    if (this.activeJobs.has(id)) {
      video.transcodeProgress = this.activeJobs.get(id).progress;
    }
    return video;
  }

  /**
   * Register a new video from an uploaded file
   */
  createVideo(file, metadata = {}) {
    const id = uuidv4();
    const { title = file.originalname, description = '', category = 'uncategorized', tags = [] } = metadata;

    this.db.prepare(`
      INSERT INTO videos (id, title, description, filename, original_path, file_size, category, tags)
      VALUES (@id, @title, @description, @filename, @original_path, @file_size, @category, @tags)
    `).run({
      id,
      title,
      description,
      filename: file.filename,
      original_path: file.path,
      file_size: file.size,
      category,
      tags: JSON.stringify(tags)
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
   * Delete a video and all associated files
   */
  deleteVideo(id) {
    const video = this.getVideo(id);
    if (!video) return false;

    // Delete original file
    if (video.original_path && fs.existsSync(video.original_path)) {
      fs.unlinkSync(video.original_path);
    }

    // Delete HLS directory
    const hlsDir = path.join(this.streamsDir, id);
    deleteDirectory(hlsDir);

    // Delete thumbnail
    const thumbPath = path.join(this.thumbnailsDir, `${id}.jpg`);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    // Delete DB record
    this.db.prepare('DELETE FROM videos WHERE id = ?').run(id);
    this.activeJobs.delete(id);

    return true;
  }

  /**
   * Start HLS transcoding for a video
   */
  async startTranscode(id) {
    const video = this.getVideo(id);
    if (!video) throw new Error('Video not found');
    if (video.status === 'transcoding') throw new Error('Already transcoding');

    // Update status
    this.db.prepare("UPDATE videos SET status = 'transcoding', updated_at = datetime('now') WHERE id = ?").run(id);
    this.activeJobs.set(id, { progress: 0, startedAt: Date.now() });

    const outputDir = path.join(this.streamsDir, id);
    const thumbnailPath = path.join(this.thumbnailsDir, `${id}.jpg`);

    // Run transcode asynchronously
    try {
      // Get video info
      const info = await getVideoInfo(video.original_path);

      // Generate thumbnail
      try {
        await generateThumbnail(video.original_path, thumbnailPath);
      } catch (e) {
        console.warn('⚠️ Thumbnail generation failed:', e.message);
      }

      // Transcode to HLS
      await transcodeToHLS(video.original_path, outputDir, (progress) => {
        this.activeJobs.set(id, { progress, startedAt: this.activeJobs.get(id)?.startedAt });
      });

      // Update DB with results
      this.db.prepare(`
        UPDATE videos SET
          status = 'ready',
          hls_path = @hlsPath,
          thumbnail = @thumbnail,
          duration = @duration,
          updated_at = datetime('now')
        WHERE id = @id
      `).run({
        id,
        hlsPath: `/streams/${id}/master.m3u8`,
        thumbnail: fs.existsSync(thumbnailPath) ? `/thumbnails/${id}.jpg` : null,
        duration: info.duration
      });

      this.activeJobs.delete(id);
      console.log(`✅ Video ${id} transcoded successfully`);
    } catch (error) {
      console.error(`❌ Transcode failed for ${id}:`, error.message);
      this.db.prepare("UPDATE videos SET status = 'error', updated_at = datetime('now') WHERE id = ?").run(id);
      this.activeJobs.delete(id);
      throw error;
    }
  }

  /**
   * Get all unique categories
   */
  getCategories() {
    return this.db.prepare('SELECT DISTINCT category, COUNT(*) as count FROM videos GROUP BY category ORDER BY count DESC').all();
  }

  /**
   * Get transcode status for a video
   */
  getTranscodeStatus(id) {
    const video = this.getVideo(id);
    if (!video) return null;

    const job = this.activeJobs.get(id);
    return {
      id,
      status: video.status,
      progress: job?.progress || (video.status === 'ready' ? 100 : 0),
      startedAt: job?.startedAt || null
    };
  }
}

module.exports = VideoManager;
