/**
 * App — Client-side router and initialization
 */
const App = {
  init() {
    // Setup routing
    window.addEventListener('hashchange', () => App.route());

    // Mobile menu toggle
    document.getElementById('menu-btn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('open');
      document.getElementById('sidebar-overlay')?.classList.toggle('show');
    });

    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('show');
    });

    // Check server health
    App.checkHealth();
    setInterval(() => App.checkHealth(), 30000);

    // Initial route
    App.route();
  },

  route() {
    const hash = window.location.hash || '#/';
    const path = hash.substring(1); // Remove #

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    // Clean up player if navigating away
    if (!path.startsWith('/watch/') && Player.hls) {
      Player.destroy();
    }

    // Close mobile menu
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('show');

    if (path === '/' || path === '') {
      document.getElementById('nav-library')?.classList.add('active');
      Library.render();
    } else if (path.startsWith('/watch/')) {
      document.getElementById('nav-library')?.classList.add('active');
      const videoId = path.replace('/watch/', '');
      Player.render(videoId);
    } else if (path === '/upload') {
      document.getElementById('nav-upload')?.classList.add('active');
      Upload.render();
    } else if (path === '/download') {
      document.getElementById('nav-download')?.classList.add('active');
      Download.render();
    } else {
      // 404 — redirect to library
      window.location.hash = '/';
    }
  },

  async checkHealth() {
    const statusEl = document.getElementById('server-status');
    if (!statusEl) return;

    try {
      const health = await API.getHealth();
      const dot = statusEl.querySelector('.status-dot');
      dot?.classList.remove('offline');
      dot?.classList.add('online');
      statusEl.querySelector('span').textContent = `${health.videos.total} videos • ${health.storage.used}`;
    } catch (_e) {
      const dot = statusEl.querySelector('.status-dot');
      dot?.classList.remove('online');
      dot?.classList.add('offline');
      statusEl.querySelector('span').textContent = 'Server offline';
    }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
