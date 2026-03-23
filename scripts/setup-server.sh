#!/bin/bash
# setup-server.sh — First-time Linux server provisioning
# Run as root on your Linux server

set -e

echo "🚀 DevOps Learning Web — Server Setup"
echo "======================================="
echo ""

# 1. Install Docker
if ! command -v docker &> /dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "✅ Docker installed"
else
  echo "✅ Docker already installed"
fi

# 2. Install Docker Compose plugin
if ! docker compose version &> /dev/null; then
  echo "📦 Installing Docker Compose plugin..."
  apt-get update && apt-get install -y docker-compose-plugin 2>/dev/null || \
  yum install -y docker-compose-plugin 2>/dev/null || \
  echo "⚠️  Please install docker-compose-plugin manually"
fi

# 3. Install Git
if ! command -v git &> /dev/null; then
  echo "📦 Installing Git..."
  apt-get update && apt-get install -y git 2>/dev/null || \
  yum install -y git 2>/dev/null
fi

# 4. Create deploy user
if ! id "deploy" &>/dev/null; then
  echo "👤 Creating deploy user..."
  useradd -m -s /bin/bash deploy
  usermod -aG docker deploy
  echo "✅ Deploy user created"
else
  echo "✅ Deploy user already exists"
  usermod -aG docker deploy
fi

# 5. Create application directory
APP_DIR="/opt/devops-learning-web"
mkdir -p "$APP_DIR"
chown deploy:deploy "$APP_DIR"

# 6. Create data directories
DATA_DIR="/data/videos"
mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/streams" "$DATA_DIR/thumbnails"
chown -R deploy:deploy /data

# 7. Clone repository
if [ ! -d "$APP_DIR/.git" ]; then
  echo "📥 Cloning repository..."
  sudo -u deploy git clone https://github.com/ITNeutronsBlog/devops-learning-web.git "$APP_DIR"
else
  echo "✅ Repository already cloned"
fi

# 8. Start the stack
echo "🐳 Starting Docker stack..."
cd "$APP_DIR"
sudo -u deploy docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo ""
echo "======================================="
echo "✅ Setup complete!"
echo ""
echo "📌 Access the website at:"
echo "   http://$(hostname -I | awk '{print $1}'):8080"
echo ""
echo "📌 To set up CI/CD, add these GitHub Secrets:"
echo "   SERVER_HOST=$(hostname -I | awk '{print $1}')"
echo "   SERVER_USER=deploy"
echo "   SERVER_SSH_KEY=<generate with: ssh-keygen -t ed25519>"
echo "   GHCR_TOKEN=<GitHub PAT with read:packages>"
echo ""
echo "📌 Run download script:"
echo "   ./scripts/download-video.sh 'https://youtube.com/watch?v=...' kubernetes"
echo ""
