/**
 * API Client — Centralized API communication
 */
const API = {
  baseUrl: window.location.origin,

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    };

    // Remove Content-Type for FormData
    if (options.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
      }
      return data;
    } catch (err) {
      if (err.name === 'TypeError') {
        throw new Error('Server is unreachable');
      }
      throw err;
    }
  },

  // Videos
  getVideos(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/videos${query ? '?' + query : ''}`);
  },

  getVideo(id) {
    return this.request(`/api/videos/${id}`);
  },

  updateVideo(id, data) {
    return this.request(`/api/videos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  deleteVideo(id) {
    return this.request(`/api/videos/${id}`, { method: 'DELETE' });
  },

  /**
   * Upload video directly to R2 via presigned URL (bypasses server)
   * Flow: 1) Get presigned URL from server  2) PUT file directly to R2  3) Register in DB
   */
  async uploadVideo(file, metadata, onProgress) {
    // Step 1: Get presigned URL from our server (tiny JSON request)
    const presign = await this.request('/api/videos/presign', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'video/mp4'
      })
    });

    // Step 2: Upload file directly to R2 (browser → R2, never touches server)
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presign.uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({
            loaded: e.loaded,
            total: e.total,
            percent: Math.round((e.loaded / e.total) * 100)
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`R2 upload failed: HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during R2 upload'));
      xhr.send(file);
    });

    // Step 3: Register video in DB (tiny JSON request)
    const video = await this.request('/api/videos/register', {
      method: 'POST',
      body: JSON.stringify({
        id: presign.id,
        s3Key: presign.s3Key,
        publicUrl: presign.publicUrl,
        filename: file.name,
        fileSize: file.size,
        title: metadata.title,
        description: metadata.description,
        category: metadata.category,
        tags: metadata.tags
      })
    });

    return video;
  },

  // Download from URL (still goes through server for yt-dlp)
  downloadFromUrl(url, category, tags) {
    return this.request('/api/videos/download', {
      method: 'POST',
      body: JSON.stringify({ url, category, tags })
    });
  },

  // Categories
  getCategories() {
    return this.request('/api/categories');
  },

  // Health
  getHealth() {
    return this.request('/api/health');
  }
};
