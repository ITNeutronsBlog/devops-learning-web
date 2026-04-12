# DevOps Learning Web — Video Streaming Platform

A self-hosted video streaming platform for personal DevOps learning. Download YouTube videos, upload them to your Linux server, and stream them with adaptive quality through a modern web interface.

## Architecture

### Full System Architecture

```mermaid
graph TB
    subgraph "🌐 Users"
        USER["👤 Browser<br/>HLS.js Player"]
    end

    subgraph "🔄 CI/CD Pipeline"
        GH["GitHub Actions"]
        GHCR["ghcr.io<br/>Container Registry"]
    end

    subgraph "🖥️ Production Server — 178.128.55.28 (DigitalOcean SGP)"
        NGINX_P["Nginx<br/>:8080"]
        APP_P["Node.js App<br/>:3005"]
        PG_P["PostgreSQL 16<br/>Primary (read-write)<br/>:5432"]
        FFMPEG["FFmpeg<br/>Transcoder"]
        YTDLP["yt-dlp<br/>Downloader"]
        VIDEOS_P["📁 /data/videos<br/>HLS Segments"]
        PGBR["pgBackRest<br/>Backup Agent"]

        NGINX_P -->|"proxy_pass"| APP_P
        APP_P -->|"queries"| PG_P
        APP_P -->|"transcode"| FFMPEG
        APP_P -->|"download"| YTDLP
        FFMPEG --> VIDEOS_P
        YTDLP --> VIDEOS_P
        PG_P -->|"WAL stream<br/>real-time"| DR_LINK["TCP :5432"]
        PGBR -->|"scheduled<br/>backups"| S3_LINK["S3 Upload"]
    end

    subgraph "☁️ AWS Mumbai (ap-south-1) — DR Site"
        subgraph "EC2 t3.small — 3.7.200.91"
            NGINX_DR["Nginx<br/>:8080"]
            APP_DR["Node.js App<br/>:3005"]
            PG_DR["PostgreSQL 16<br/>Standby (read-only)<br/>:5432"]
            FAILOVER["🐍 auto_failover.py<br/>Monitors Primary<br/>every 30s"]
            REDIS["Redis<br/>State Tracker"]
            VIDEOS_DR["📁 /data/videos"]
        end

        EBS["💾 EBS gp3<br/>20GB<br/>/data/postgres"]
        S3["🪣 S3 Bucket<br/>devops-learning-pg-backups<br/>WAL Archives + Backups"]

        FAILOVER -->|"health check"| HEALTH_CHECK["HTTP GET<br/>/api/health"]
        FAILOVER -->|"state"| REDIS
        PG_DR --- EBS
    end

    USER -->|"HTTPS"| NGINX_P
    GH -->|"build + push"| GHCR
    GH -->|"SSH deploy"| APP_P
    DR_LINK -->|"streaming<br/>replication"| PG_DR
    S3_LINK --> S3
    HEALTH_CHECK -.->|"monitor"| APP_P
    S3 -.->|"restore"| PG_DR

    style PG_P fill:#336791,color:#fff
    style PG_DR fill:#FF9900,color:#000
    style S3 fill:#569A31,color:#fff
    style FAILOVER fill:#3498db,color:#fff
    style REDIS fill:#e74c3c,color:#fff
    style NGINX_P fill:#009639,color:#fff
    style NGINX_DR fill:#009639,color:#fff
    style GH fill:#24292e,color:#fff
    style GHCR fill:#24292e,color:#fff
```

### Disaster Recovery — 3 Layer Protection

```mermaid
graph LR
    subgraph "Layer 1: Streaming Replication"
        L1A["PostgreSQL Primary"] -->|"Real-time WAL stream<br/>RPO: ~0 seconds"| L1B["PostgreSQL Standby"]
    end

    subgraph "Layer 2: WAL Archive to S3"
        L2A["WAL Segments<br/>(16MB each)"] -->|"Continuous archive<br/>RPO: ~5 minutes"| L2B["S3 Glacier<br/>(90 days)"]
    end

    subgraph "Layer 3: Scheduled Backups"
        L3A["Full Backup<br/>(Sunday 2AM)"] -->|"Weekly + Daily Diff<br/>4 full + 14 diff"| L3B["S3 Standard<br/>(180 days)"]
    end

    style L1A fill:#336791,color:#fff
    style L1B fill:#FF9900,color:#000
    style L2B fill:#569A31,color:#fff
    style L3B fill:#569A31,color:#fff
```

### Automatic Failover Flow

```mermaid
sequenceDiagram
    participant M as auto_failover.py
    participant R as Redis
    participant P as Primary (178.128.55.28)
    participant DR as DR (3.7.200.91)
    participant N as Notifications

    loop Every 30 seconds
        M->>P: GET /api/health
        alt Healthy
            M->>R: Reset failure_count = 0
        else Failed
            M->>R: Increment failure_count
            alt count >= 5 (2.5 min down)
                M->>P: SSH: docker stop (fence)
                M->>DR: pg_ctl promote
                M->>DR: docker compose up -d
                M->>R: Set status = DR_ACTIVE
                M->>N: 🚨 FAILOVER COMPLETE
            end
        end
    end
```

### CI/CD Pipeline

```mermaid
graph LR
    A["git push main"] --> B["GitHub Actions"]
    B --> C["Lint + Test"]
    C --> D["Docker Build"]
    D --> E["Trivy Scan"]
    E --> F["Push to ghcr.io"]
    F --> G["SSH Deploy"]
    G --> H["Health Check"]
    H -->|"✅ Pass"| I["✅ Live"]
    H -->|"❌ Fail"| J["🔄 Auto Rollback"]

    style A fill:#24292e,color:#fff
    style B fill:#24292e,color:#fff
    style I fill:#27ae60,color:#fff
    style J fill:#e74c3c,color:#fff
```

## Features

- 📺 **HLS Adaptive Streaming** — 480p / 720p / 1080p quality switching
- 🎬 **Video Player** — Keyboard shortcuts, speed control, quality selector
- 📥 **YouTube Download** — Paste a URL, auto-download via yt-dlp
- 📤 **File Upload** — Drag & drop with progress tracking
- 🔍 **Search & Filter** — By title, category, tags
- 🐳 **Docker** — One-command deployment
- 🔄 **CI/CD** — GitHub Actions with auto-deploy & rollback
- 🐘 **PostgreSQL** — Production-grade database with connection pooling
- 🛡️ **Disaster Recovery** — Automatic failover with 3-layer data protection
- 📊 **Monitoring** — Health checks, replication lag, backup status

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

## DR Operations

### Scripts

| Script | Purpose | Trigger |
|--------|---------|---------|
| `auto_failover.py` | Monitor primary, auto failover | Automatic (daemon) |
| `auto_failback.py` | Restore primary from DR | Manual |
| `dr-failover.sh` | Manual failover (bash) | Manual |
| `dr-failback.sh` | Manual failback (bash) | Manual |
| `dr-drill.sh` | Quarterly DR test | Manual |
| `dr-monitor.sh` | Health check script | Cron (5 min) |

### Quick Commands

```bash
# Check auto-failover status
python3 scripts/auto_failover.py --status

# Run DR drill
bash scripts/dr-drill.sh

# Force failover
python3 scripts/auto_failover.py --failover-now

# Failback to primary
python3 scripts/auto_failback.py --preflight
python3 scripts/auto_failback.py
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
| Database | PostgreSQL 16 (pg.Pool) |
| Transcode | FFmpeg |
| Download | yt-dlp |
| Proxy | Nginx |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| DR | AWS EC2 + S3 + Streaming Replication |
| Monitoring | auto_failover.py + Redis |
| IaC | Terraform (AWS Mumbai) |
| Backup | pgBackRest → S3 |

## Infrastructure

| Resource | Location | Purpose |
|----------|----------|---------|
| Production Server | DigitalOcean SGP (178.128.55.28) | Main app + PostgreSQL primary |
| DR Server | AWS Mumbai (3.7.200.91) | PostgreSQL standby + failover |
| S3 Bucket | AWS ap-south-1 | WAL archives + scheduled backups |
| EBS Volume | AWS ap-south-1 | 20GB gp3 for DR PostgreSQL data |
| Container Registry | ghcr.io | Docker image storage |

## CI/CD

Push to `main` triggers:
1. **Lint & Test** → ESLint + Jest
2. **Docker Build** → Build, push to `ghcr.io`, Trivy scan
3. **Deploy** → SSH to server, pull image, health check, auto-rollback

See `.github/workflows/` for full pipeline configuration.

## License

Private — Personal use only.
