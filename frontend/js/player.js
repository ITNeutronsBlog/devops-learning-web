/**
 * Video Player — Native MP4 player with speed control + keyboard shortcuts
 */
const Player = {
  video: null,
  currentVideoId: null,

  async render(videoId) {
    Player.currentVideoId = videoId;
    const main = document.getElementById('main-content');

    main.innerHTML = `
      <div class="player-page animate-fade-in-up">
        <a href="#/" class="back-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Library
        </a>
        <div class="loading-screen"><div class="spinner"></div><span>Loading video...</span></div>
      </div>
    `;

    try {
      const video = await API.getVideo(videoId);
      if (!video) return main.innerHTML = '<p>Video not found</p>';

      if (video.status !== 'ready' || !video.s3_url) {
        main.innerHTML = `
          <div class="player-page animate-fade-in-up">
            <a href="#/" class="back-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              Back to Library
            </a>
            <div class="empty-state">
              <h3>Video is not available</h3>
              <p>${video.status === 'uploading' ? 'Please wait while the video is being uploaded...' : 'There was an error processing this video.'}</p>
            </div>
          </div>
        `;
        return;
      }

      main.querySelector('.player-page').innerHTML = `
        <a href="#/" class="back-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Library
        </a>

        <div class="player-wrapper" id="player-wrapper">
          <video id="video-player" playsinline preload="auto" src="${video.s3_url}"></video>
          <div class="player-loading" id="player-loading">
            <div class="player-spinner"></div>
          </div>
          <div class="player-controls-overlay" id="player-controls">
            <button id="play-btn" title="Play/Pause (Space)">
              <svg id="play-icon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              <svg id="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            </button>
            <div class="player-progress" id="progress-bar">
              <div class="player-buffer-fill" id="buffer-fill"></div>
              <div class="player-progress-fill" id="progress-fill"></div>
            </div>
            <span class="player-time" id="time-display">0:00 / 0:00</span>
            <div class="speed-selector">
              <button class="speed-btn" id="speed-btn">1x</button>
              <div class="speed-dropdown" id="speed-dropdown">
                ${[0.5, 0.75, 1, 1.25, 1.5, 2].map(s =>
                  `<div class="speed-option ${s === 1 ? 'active' : ''}" data-speed="${s}">${s}x</div>`
                ).join('')}
              </div>
            </div>
            <button id="fullscreen-btn" title="Fullscreen (F)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
          </div>
        </div>

        <div class="player-info">
          <div class="video-title">${Library.escapeHtml(video.title)}</div>
          <div class="video-meta">
            <span>${video.category}</span>
            ${video.duration ? `<span>${Library.formatDuration(video.duration)}</span>` : ''}
            <span>${Library.timeAgo(video.created_at)}</span>
          </div>
          ${video.description ? `<div class="video-description">${Library.escapeHtml(video.description)}</div>` : ''}
          ${video.tags && video.tags.length > 0 ? `
            <div class="video-tags">
              ${video.tags.map(t => `<span class="tag">${Library.escapeHtml(t)}</span>`).join('')}
            </div>
          ` : ''}
          <div style="margin-top:20px;display:flex;gap:8px;">
            <button class="btn btn-secondary" id="edit-btn">Edit Info</button>
            <button class="btn btn-danger" id="delete-btn">Delete</button>
          </div>
        </div>
      `;

      Player.initPlayer();
      Player.setupControls(video);

    } catch (err) {
      main.innerHTML = `<div class="empty-state"><h3>Error loading video</h3><p>${err.message}</p></div>`;
    }
  },

  initPlayer() {
    const videoEl = document.getElementById('video-player');
    Player.video = videoEl;
    // preload="auto" on the element tells browser to buffer aggressively
  },

  setupControls(videoData) {
    const video = Player.video;
    if (!video) return;

    const playBtn = document.getElementById('play-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const bufferFill = document.getElementById('buffer-fill');
    const loadingOverlay = document.getElementById('player-loading');
    const timeDisplay = document.getElementById('time-display');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const speedBtn = document.getElementById('speed-btn');
    const speedDropdown = document.getElementById('speed-dropdown');
    const editBtn = document.getElementById('edit-btn');
    const deleteBtn = document.getElementById('delete-btn');

    // Play/Pause
    const togglePlay = () => {
      if (video.paused) {
        video.play().catch(err => App.showToast('Unable to play video: ' + err.message, 'error'));
      } else {
        video.pause();
      }
    };
    playBtn?.addEventListener('click', togglePlay);

    video.addEventListener('play', () => {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
    });
    video.addEventListener('pause', () => {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
    });

    video.addEventListener('error', () => {
      let errorMsg = 'Unknown video error';
      if (video.error) {
        switch (video.error.code) {
          case 1: errorMsg = 'Loading aborted'; break;
          case 2: errorMsg = 'Network error while loading'; break;
          case 3: errorMsg = 'Video decoding failed'; break;
          case 4: errorMsg = 'Video format unsupported or source unreachable'; break;
        }
      }
      App.showToast(`Error: ${errorMsg}`, 'error');
      loadingOverlay.classList.remove('visible');
    });

    // Progress + Buffer
    video.addEventListener('timeupdate', () => {
      if (video.duration) {
        progressFill.style.width = `${(video.currentTime / video.duration) * 100}%`;
        timeDisplay.textContent = `${Library.formatDuration(video.currentTime)} / ${Library.formatDuration(video.duration)}`;
      }
    });

    // Buffer progress bar
    video.addEventListener('progress', () => {
      if (video.duration && video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        bufferFill.style.width = `${(bufferedEnd / video.duration) * 100}%`;
      }
    });

    // Loading spinner — show when buffering, hide when playing
    video.addEventListener('waiting', () => {
      loadingOverlay.classList.add('visible');
    });
    video.addEventListener('playing', () => {
      loadingOverlay.classList.remove('visible');
    });
    video.addEventListener('canplay', () => {
      loadingOverlay.classList.remove('visible');
    });

    progressBar?.addEventListener('click', (e) => {
      const rect = progressBar.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      video.currentTime = pos * video.duration;
    });

    // Fullscreen
    fullscreenBtn?.addEventListener('click', () => {
      const wrapper = document.getElementById('player-wrapper');
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        wrapper.requestFullscreen();
      }
    });

    // Speed dropdown toggle
    speedBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      speedDropdown?.classList.toggle('show');
    });

    // Speed options
    speedDropdown?.querySelectorAll('.speed-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const speed = parseFloat(opt.dataset.speed);
        video.playbackRate = speed;
        speedBtn.textContent = `${speed}x`;
        speedDropdown.querySelectorAll('.speed-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        speedDropdown.classList.remove('show');
      });
    });

    // Close dropdowns on click outside
    document.addEventListener('click', () => {
      speedDropdown?.classList.remove('show');
    });

    // Keyboard controls
    document.addEventListener('keydown', Player.handleKeyboard);

    // Edit button
    editBtn?.addEventListener('click', () => Player.showEditModal(videoData));

    // Delete button
    deleteBtn?.addEventListener('click', async () => {
      if (confirm(`Delete "${videoData.title}"? This cannot be undone.`)) {
        try {
          await API.deleteVideo(videoData.id);
          App.showToast('Video deleted', 'success');
          window.location.hash = '/';
        } catch (err) {
          App.showToast(`Delete failed: ${err.message}`, 'error');
        }
      }
    });
  },

  handleKeyboard(e) {
    if (!Player.video || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
    case ' ':
      e.preventDefault();
      if (Player.video.paused) {
        Player.video.play().catch(err => App.showToast('Unable to play video: ' + err.message, 'error'));
      } else {
        Player.video.pause();
      }
      break;
    case 'ArrowRight':
      Player.video.currentTime = Math.min(Player.video.currentTime + 10, Player.video.duration);
      break;
    case 'ArrowLeft':
      Player.video.currentTime = Math.max(Player.video.currentTime - 10, 0);
      break;
    case 'ArrowUp':
      Player.video.volume = Math.min(Player.video.volume + 0.1, 1);
      break;
    case 'ArrowDown':
      Player.video.volume = Math.max(Player.video.volume - 0.1, 0);
      break;
    case 'f':
    case 'F':
      document.getElementById('fullscreen-btn')?.click();
      break;
    }
  },

  showEditModal(video) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Edit Video Info</h2>
        <div class="upload-form">
          <div class="form-group">
            <label>Title</label>
            <input type="text" id="edit-title" value="${Library.escapeHtml(video.title)}">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="edit-description">${Library.escapeHtml(video.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Category</label>
            <input type="text" id="edit-category" value="${Library.escapeHtml(video.category || '')}">
          </div>
          <div class="form-group">
            <label>Tags (comma-separated)</label>
            <input type="text" id="edit-tags" value="${(video.tags || []).join(', ')}">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="edit-cancel">Cancel</button>
          <button class="btn btn-primary" id="edit-save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#edit-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#edit-save').addEventListener('click', async () => {
      try {
        const updates = {
          title: document.getElementById('edit-title').value,
          description: document.getElementById('edit-description').value,
          category: document.getElementById('edit-category').value,
          tags: document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean)
        };

        await API.updateVideo(video.id, updates);
        overlay.remove();
        App.showToast('Video updated!', 'success');
        Player.render(video.id);
      } catch (err) {
        App.showToast(`Update failed: ${err.message}`, 'error');
      }
    });
  },

  destroy() {
    document.removeEventListener('keydown', Player.handleKeyboard);
    Player.video = null;
  }
};
