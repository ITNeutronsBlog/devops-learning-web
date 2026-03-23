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

  getTranscodeStatus(id) {
    return this.request(`/api/videos/${id}/status`);
  },

  retranscode(id) {
    return this.request(`/api/videos/${id}/transcode`, { method: 'POST' });
  },

  // Upload with progress
  uploadVideo(file, metadata, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('video', file);
      if (metadata.title) formData.append('title', metadata.title);
      if (metadata.description) formData.append('description', metadata.description);
      if (metadata.category) formData.append('category', metadata.category);
      if (metadata.tags) formData.append('tags', JSON.stringify(metadata.tags));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/api/videos/upload`);

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
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.error?.message || data.error || 'Upload failed'));
          }
        } catch (_e) {
          reject(new Error('Invalid server response'));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  },

  // Download from URL
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
