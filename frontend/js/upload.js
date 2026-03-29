/**
 * Upload — Drag & drop upload + metadata form
 */
const Upload = {
  selectedFile: null,
  isUploading: false,

  render() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="upload-page animate-fade-in-up">
        <div class="page-header">
          <h1 class="page-title">Upload Video</h1>
          <p class="page-subtitle">Upload a video file for streaming</p>
        </div>

        <div class="dropzone" id="dropzone">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <h3>Drop your video here</h3>
          <p>or click to browse — MP4, MKV, MOV, AVI, WebM</p>
          <input type="file" id="file-input" accept="video/*">
        </div>

        <div id="file-info" style="display:none; margin-top:16px; padding:12px 16px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md); font-size:0.85rem; color:var(--text-secondary);"></div>

        <form class="upload-form" id="upload-form" style="display:none;">
          <div class="form-group">
            <label for="upload-title">Title</label>
            <input type="text" id="upload-title" placeholder="Video title">
          </div>
          <div class="form-group">
            <label for="upload-description">Description</label>
            <textarea id="upload-description" placeholder="What's this video about?"></textarea>
          </div>
          <div class="form-group">
            <label for="upload-category">Category</label>
            <input type="text" id="upload-category" placeholder="e.g. kubernetes, docker, terraform" value="uncategorized">
          </div>
          <div class="form-group">
            <label for="upload-tags">Tags (comma-separated)</label>
            <input type="text" id="upload-tags" placeholder="e.g. tutorial, beginner, k8s">
          </div>

          <div id="upload-progress" style="display:none;">
            <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
            <div class="upload-progress-info">
              <span id="progress-percent">0%</span>
              <span id="progress-speed"></span>
            </div>
          </div>

          <button type="submit" class="btn btn-primary" id="upload-btn" style="margin-top:8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </button>
        </form>
      </div>
    `;

    Upload.setupEvents();
  },

  setupEvents() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const form = document.getElementById('upload-form');

    // Drag & Drop
    ['dragenter', 'dragover'].forEach(evt => {
      dropzone?.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropzone?.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
      });
    });

    dropzone?.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) Upload.handleFile(file);
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) Upload.handleFile(file);
    });

    // Form submit
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      Upload.startUpload();
    });
  },

  handleFile(file) {
    Upload.selectedFile = file;

    // Show file info
    const fileInfo = document.getElementById('file-info');
    const sizeMB = (file.size / 1048576).toFixed(1);
    fileInfo.innerHTML = `📁 <strong>${file.name}</strong> — ${sizeMB} MB`;
    fileInfo.style.display = 'block';

    // Show form
    const form = document.getElementById('upload-form');
    form.style.display = 'flex';

    // Pre-fill title
    const titleInput = document.getElementById('upload-title');
    if (titleInput && !titleInput.value) {
      titleInput.value = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    }
  },

  async startUpload() {
    if (!Upload.selectedFile || Upload.isUploading) return;
    Upload.isUploading = true;

    const btn = document.getElementById('upload-btn');
    const progressDiv = document.getElementById('upload-progress');

    btn.disabled = true;
    btn.textContent = 'Uploading...';
    progressDiv.style.display = 'block';

    const metadata = {
      title: document.getElementById('upload-title')?.value || Upload.selectedFile.name,
      description: document.getElementById('upload-description')?.value || '',
      category: document.getElementById('upload-category')?.value || 'uncategorized',
      tags: (document.getElementById('upload-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean)
    };

    let startTime = Date.now();

    try {
      const result = await API.uploadVideo(Upload.selectedFile, metadata, (progress) => {
        document.getElementById('progress-fill').style.width = `${progress.percent}%`;
        document.getElementById('progress-percent').textContent = `${progress.percent}%`;

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = progress.loaded / elapsed;
        document.getElementById('progress-speed').textContent =
          speed > 1048576 ? `${(speed / 1048576).toFixed(1)} MB/s` : `${(speed / 1024).toFixed(0)} KB/s`;
      });

      App.showToast('Video uploaded successfully!', 'success');
      Upload.isUploading = false;
      Upload.selectedFile = null;

      // Go to library
      setTimeout(() => { window.location.hash = '/'; }, 1500);
    } catch (err) {
      App.showToast(`Upload failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Upload';
      Upload.isUploading = false;
    }
  }
};

/**
 * Download — Download YouTube videos via yt-dlp
 */
const Download = {
  isDownloading: false,

  render() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="download-page animate-fade-in-up">
        <div class="page-header">
          <h1 class="page-title">Download from YouTube</h1>
          <p class="page-subtitle">Paste a YouTube URL to download and stream</p>
        </div>

        <div class="download-form" id="download-form">
          <div class="form-group">
            <label>YouTube URL</label>
            <div class="url-input-group">
              <input type="url" id="download-url" placeholder="https://youtube.com/watch?v=...">
              <button class="btn btn-primary" id="download-btn">Download</button>
            </div>
          </div>
          <div class="form-group">
            <label>Category</label>
            <input type="text" id="download-category" placeholder="e.g. kubernetes" value="uncategorized">
          </div>
          <div class="form-group">
            <label>Tags (comma-separated)</label>
            <input type="text" id="download-tags" placeholder="e.g. tutorial, beginner">
          </div>

          <div id="download-status" style="display:none; margin-top:12px; padding:14px; background:var(--bg-input); border-radius:var(--radius-md); font-size:0.85rem; color:var(--text-secondary);"></div>
        </div>
      </div>
    `;

    document.getElementById('download-btn')?.addEventListener('click', Download.startDownload);
    document.getElementById('download-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Download.startDownload();
    });
  },

  async startDownload() {
    if (Download.isDownloading) return;

    const url = document.getElementById('download-url')?.value?.trim();
    if (!url) {
      App.showToast('Please enter a YouTube URL', 'error');
      return;
    }

    Download.isDownloading = true;
    const btn = document.getElementById('download-btn');
    const statusDiv = document.getElementById('download-status');

    btn.disabled = true;
    btn.textContent = 'Downloading...';
    statusDiv.style.display = 'block';
    statusDiv.innerHTML = '⏳ Downloading video from YouTube... This may take a few minutes.';

    const category = document.getElementById('download-category')?.value || 'uncategorized';
    const tags = (document.getElementById('download-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);

    try {
      const result = await API.downloadFromUrl(url, category, tags);
      statusDiv.innerHTML = `✅ Downloaded: <strong>${Library.escapeHtml(result.title || 'Video')}</strong> — Transcoding started!`;
      App.showToast('Download complete! Transcoding started.', 'success');

      // Reset form
      document.getElementById('download-url').value = '';
      btn.textContent = 'Download';
      btn.disabled = false;
      Download.isDownloading = false;

      setTimeout(() => { window.location.hash = '/'; }, 2000);
    } catch (err) {
      statusDiv.innerHTML = `❌ Error: ${err.message}`;
      App.showToast(`Download failed: ${err.message}`, 'error');
      btn.textContent = 'Download';
      btn.disabled = false;
      Download.isDownloading = false;
    }
  }
};
