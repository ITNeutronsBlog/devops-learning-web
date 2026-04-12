#!/bin/bash
# ═══════════════════════════════════════════════════════
# DevOps Learning Hub — DR Server Bootstrap Script
# Runs on first boot of EC2 instance via user_data
# Installs ALL dependencies + clones repo + configures DR
# ═══════════════════════════════════════════════════════
set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

echo "🚀 DR Server Bootstrap — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "══════════════════════════════════════════════════════"

# ──────────────────────────────────────────────
# 1. System Updates + Essential Packages
# ──────────────────────────────────────────────
echo "📦 [1/8] Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  apt-transport-https \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  software-properties-common \
  git \
  jq \
  htop \
  ncdu \
  tree \
  unzip \
  wget \
  net-tools \
  dnsutils \
  vim \
  tmux \
  fail2ban \
  ufw \
  logrotate \
  pgbackrest \
  python3 \
  python3-pip
echo "  ✅ System packages installed"

# Install AWS CLI v2
if ! command -v aws &> /dev/null; then
  curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi
echo "  ✅ AWS CLI $(aws --version | awk '{print $1}') installed"

# ──────────────────────────────────────────────
# 2. Docker + Docker Compose
# ──────────────────────────────────────────────
echo "🐳 [2/8] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# Docker Compose plugin
if ! docker compose version &> /dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

# Create deploy user and add to docker group
if ! id "deploy" &>/dev/null; then
  useradd -m -s /bin/bash deploy
  usermod -aG docker deploy
fi
echo "  ✅ Docker $(docker --version | awk '{print $3}') installed"

# ──────────────────────────────────────────────
# 3. Mount EBS Volume for PostgreSQL data
# ──────────────────────────────────────────────
echo "💾 [3/8] Setting up PostgreSQL data volume..."
PG_DATA_DIR="/data/postgres"
mkdir -p "$PG_DATA_DIR"

# Wait for EBS volume to attach
for i in $(seq 1 30); do
  if [ -b /dev/xvdf ]; then break; fi
  echo "  Waiting for EBS volume... ($i/30)"
  sleep 5
done

# Format only if not already formatted
if [ -b /dev/xvdf ] && ! blkid /dev/xvdf &>/dev/null; then
  mkfs -t ext4 /dev/xvdf
  echo "  Formatted /dev/xvdf as ext4"
fi

# Mount if not already mounted
if [ -b /dev/xvdf ] && ! mountpoint -q "$PG_DATA_DIR"; then
  mount /dev/xvdf "$PG_DATA_DIR"
fi

# Add to fstab for persistence across reboots
if ! grep -q '/dev/xvdf' /etc/fstab; then
  echo '/dev/xvdf /data/postgres ext4 defaults,nofail 0 2' >> /etc/fstab
fi
chown -R 999:999 "$PG_DATA_DIR" # UID 999 = postgres user in Docker
echo "  ✅ PostgreSQL data volume mounted at $PG_DATA_DIR"

# ──────────────────────────────────────────────
# 4. Create application directories
# ──────────────────────────────────────────────
echo "📁 [4/8] Setting up application directories..."
APP_DIR="/opt/devops-learning-web"
DATA_DIR="/data/videos"
mkdir -p "$APP_DIR" "$DATA_DIR/uploads" "$DATA_DIR/streams"
chown -R deploy:deploy "$DATA_DIR"

# ──────────────────────────────────────────────
# 5. Clone repository
# ──────────────────────────────────────────────
echo "📥 [5/8] Cloning repository..."
if [ ! -d "$APP_DIR/.git" ]; then
  git clone https://github.com/ITNeutronsBlog/devops-learning-web.git "$APP_DIR"
  chown -R deploy:deploy "$APP_DIR"
else
  cd "$APP_DIR"
  sudo -u deploy git pull origin main
fi
echo "  ✅ Repository cloned to $APP_DIR"

# ──────────────────────────────────────────────
# 6. Write environment file
# ──────────────────────────────────────────────
echo "⚙️  [6/8] Configuring environment..."
cat > "$APP_DIR/.env" <<'ENVFILE'
NODE_ENV=production
PORT=3005

# PostgreSQL
POSTGRES_DB=devops_learning
POSTGRES_USER=devops
POSTGRES_PASSWORD=${postgres_password}
DATABASE_URL=postgres://devops:${postgres_password}@postgres:5432/devops_learning

# Replication
REPLICATION_PASSWORD=${replication_password}
PRIMARY_PG_HOST=${primary_server_ip}

# Cloudflare R2
R2_ACCOUNT_ID=${r2_account_id}
R2_ACCESS_KEY_ID=${r2_access_key_id}
R2_SECRET_ACCESS_KEY=${r2_secret_access_key}
R2_BUCKET_NAME=${r2_bucket_name}
R2_PUBLIC_URL=${r2_public_url}

# Docker image
IMAGE_FULL=ghcr.io/itneutronsblog/devops-learning-web:latest
ENVFILE

chown deploy:deploy "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

# Login to GHCR for pulling images
echo "${ghcr_token}" | docker login ghcr.io -u github --password-stdin

echo "  ✅ Environment configured"

# ──────────────────────────────────────────────
# 7. Configure pgBackRest for S3 backups
# ──────────────────────────────────────────────
echo "🗄️  [7/8] Configuring pgBackRest..."
mkdir -p /etc/pgbackrest
cat > /etc/pgbackrest/pgbackrest.conf <<PGCONF
[global]
repo1-type=s3
repo1-s3-bucket=${s3_backup_bucket}
repo1-s3-region=${aws_region}
repo1-s3-endpoint=s3.amazonaws.com
repo1-retention-full=4
repo1-retention-diff=14
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=devops-learning-backup-key

[main]
pg1-path=/data/postgres
pg1-port=5432
pg1-user=devops
PGCONF

echo "  ✅ pgBackRest configured with S3 bucket: ${s3_backup_bucket}"

# ──────────────────────────────────────────────
# 8. Security hardening
# ──────────────────────────────────────────────
echo "🔒 [8/8] Applying security hardening..."

# UFW firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw allow 8080/tcp # App direct
ufw allow from ${primary_server_ip} to any port 5432 # PG replication
ufw --force enable

# Fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Disable root SSH login
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload sshd

echo "  ✅ Firewall + fail2ban + SSH hardened"

# ──────────────────────────────────────────────
# Setup cron for DR monitoring
# ──────────────────────────────────────────────
cat > /etc/cron.d/dr-monitor <<'CRON'
# DR health monitoring — every 5 minutes
*/5 * * * * root /opt/devops-learning-web/scripts/dr-monitor.sh >> /var/log/dr-monitor.log 2>&1

# Daily pgBackRest backup check
0 2 * * * root pgbackrest --stanza=main info >> /var/log/pgbackrest-check.log 2>&1
CRON

# ──────────────────────────────────────────────
# DONE — Print status
# ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
echo "✅ DR SERVER BOOTSTRAP COMPLETE"
echo "══════════════════════════════════════════════════════"
echo ""
echo "📋 Server Status: STANDBY"
echo "📁 App Directory: $APP_DIR"
echo "💾 PG Data Volume: $PG_DATA_DIR"
echo "🗄️  S3 Backup: ${s3_backup_bucket}"
echo "🐳 Docker: $(docker --version)"
echo "🔧 Docker Compose: $(docker compose version)"
echo ""
echo "🚨 To activate DR site:"
echo "   ssh deploy@$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo "   cd /opt/devops-learning-web"
echo "   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
echo ""
echo "Completed at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
