# DevOps Learning Web — Video Streaming Platform

A self-hosted video streaming platform for personal DevOps learning. Download YouTube videos, upload them to your Linux server, and stream them with adaptive quality through a modern web interface.

## Features

- 📺 **HLS Adaptive Streaming** — 480p / 720p / 1080p quality switching
- 🎬 **Video Player** — Keyboard shortcuts, speed control, quality selector
- 📥 **YouTube Download** — Paste a URL, auto-download via yt-dlp
- 📤 **File Upload** — Drag & drop with progress tracking
- 🔍 **Search & Filter** — By title, category, tags
- 🐳 **Docker** — One-command deployment
- 🔄 **CI/CD** — GitHub Actions with auto-deploy & rollback

## Quick Start

### Local Development

```bash
# Clone
git clone https://github.com/ITNeutronsBlog/devops-learning-web.git
cd devops-learning-web

# Install backend dependencies
cd backend && npm install && cd ..

# Run locally (Node.js)
cd backend && npm run dev
# Open http://localhost:3000
```

### Docker (Recommended)

```bash
docker compose up -d
# Open http://localhost:8080
```

### Linux Server (Production)

```bash
# Run the setup script on your Linux server
curl -fsSL https://raw.githubusercontent.com/ITNeutronsBlog/devops-learning-web/main/scripts/setup-server.sh | sudo bash
```

## Usage

### Upload a Video
1. Navigate to **Upload** in the sidebar
2. Drag & drop a video file or click to browse
3. Fill in title, category, and tags
4. Click Upload — transcoding starts automatically

### Download from YouTube
1. Navigate to **Download** in the sidebar
2. Paste a YouTube URL
3. Set category and tags
4. Click Download — the server downloads and transcodes it

### CLI Download
```bash
./scripts/download-video.sh "https://youtube.com/watch?v=abc123" kubernetes
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health & stats |
| `GET` | `/api/videos` | List videos (filter/search/sort) |
| `GET` | `/api/videos/:id` | Video details |
| `POST` | `/api/videos/upload` | Upload video (multipart) |
| `POST` | `/api/videos/download` | Download from YouTube URL |
| `PUT` | `/api/videos/:id` | Update metadata |
| `DELETE` | `/api/videos/:id` | Delete video & files |
| `POST` | `/api/videos/:id/transcode` | Re-trigger transcoding |
| `GET` | `/api/videos/:id/status` | Transcoding progress |
| `GET` | `/api/categories` | List categories |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | HTML / CSS / JS + HLS.js |
| Backend | Node.js 20 + Express |
| Database | SQLite (better-sqlite3) |
| Transcode | FFmpeg |
| Download | yt-dlp |
| Proxy | Nginx |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions |

## CI/CD

Push to `main` triggers:
1. **Lint & Test** → ESLint + Jest
2. **Docker Build** → Build, push to `ghcr.io`, Trivy scan
3. **Deploy** → SSH to server, pull image, health check, auto-rollback

See `.github/workflows/` for full pipeline configuration.

## License

Private — Personal use only.
