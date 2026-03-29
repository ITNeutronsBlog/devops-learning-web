/**
 * Video Library — Grid view with search, filter, and sort
 */
const Library = {
  currentCategory: 'all',
  currentSearch: '',
  currentSort: 'created_at',

  render() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="animate-fade-in-up">
        <div class="page-header">
          <h1 class="page-title">Video Library</h1>
          <p class="page-subtitle">Your DevOps learning videos</p>
        </div>

      <div class="controls-bar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="search-input" id="search-input" placeholder="Search videos..." value="${Library.currentSearch}">
        </div>
        <select class="sort-select" id="sort-select">
          <option value="created_at" ${Library.currentSort === 'created_at' ? 'selected' : ''}>Newest First</option>
          <option value="title" ${Library.currentSort === 'title' ? 'selected' : ''}>Title A-Z</option>
          <option value="duration" ${Library.currentSort === 'duration' ? 'selected' : ''}>Duration</option>
        </select>
      </div>

      <div class="filter-tabs" id="filter-tabs">
        <button class="filter-tab ${Library.currentCategory === 'all' ? 'active' : ''}" data-category="all">All</button>
      </div>

      <div class="video-grid" id="video-grid">
        <div class="loading-screen"><div class="spinner"></div><span>Loading videos...</span></div>
      </div>
      </div>
    `;

    Library.setupEvents();
    Library.loadCategories();
    Library.loadVideos();
  },

  setupEvents() {
    const searchInput = document.getElementById('search-input');
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      Library.currentSearch = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => Library.loadVideos(), 300);
    });

    document.getElementById('sort-select')?.addEventListener('change', (e) => {
      Library.currentSort = e.target.value;
      Library.loadVideos();
    });
  },

  async loadCategories() {
    try {
      const categories = await API.getCategories();
      const tabs = document.getElementById('filter-tabs');
      if (!tabs) return;

      const allTab = `<button class="filter-tab ${Library.currentCategory === 'all' ? 'active' : ''}" data-category="all">All</button>`;
      const catTabs = categories.map(c =>
        `<button class="filter-tab ${Library.currentCategory === c.category ? 'active' : ''}" data-category="${c.category}">${c.category} (${c.count})</button>`
      ).join('');

      tabs.innerHTML = allTab + catTabs;
      tabs.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          Library.currentCategory = tab.dataset.category;
          tabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          Library.loadVideos();
        });
      });
    } catch (_e) {
      // Categories will just show "All"
    }
  },

  async loadVideos() {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    try {
      const params = {
        sort: Library.currentSort,
        order: Library.currentSort === 'title' ? 'asc' : 'desc',
        limit: 50
      };
      if (Library.currentSearch) params.search = Library.currentSearch;
      if (Library.currentCategory !== 'all') params.category = Library.currentCategory;

      const { videos } = await API.getVideos(params);

      if (videos.length === 0) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="20" height="20" rx="3"/>
              <polygon points="10,8 10,16 16,12"/>
            </svg>
            <h3>No videos yet</h3>
            <p>Upload a video or download from YouTube to get started</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = videos.map(v => Library.renderCard(v)).join('');

      // Add click handlers
      grid.querySelectorAll('.video-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.id;
          const video = videos.find(v => v.id === id);
          if (video && video.status === 'ready') {
            window.location.hash = `/watch/${id}`;
          }
        });
      });
    } catch (err) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>Failed to load videos</h3><p>${err.message}</p></div>`;
    }
  },

  renderCard(video) {
    const duration = video.duration ? Library.formatDuration(video.duration) : '';
    const thumbnail = video.thumbnail
      ? `<img src="${video.thumbnail}" alt="${video.title}" loading="lazy">`
      : `<div class="placeholder-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="3"/><polygon points="10,8 10,16 16,12"/></svg></div>`;

    return `
      <div class="video-card glass-panel" data-id="${video.id}">
        <div class="card-thumbnail">
          ${thumbnail}
          <div class="card-play-overlay">
            <div class="play-circle">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7,5 19,12 7,19"/></svg>
            </div>
          </div>
          ${duration ? `<span class="card-duration">${duration}</span>` : ''}
          <span class="card-status-badge ${video.status}">${video.status}</span>
        </div>
        <div class="card-info">
          <div class="card-title">${Library.escapeHtml(video.title)}</div>
          <div class="card-meta">
            <span class="card-category">${video.category}</span>
            <span>${Library.timeAgo(video.created_at)}</span>
          </div>
        </div>
      </div>
    `;
  },

  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  timeAgo(dateStr) {
    const date = new Date(dateStr + 'Z');
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
