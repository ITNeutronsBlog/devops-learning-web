#!/bin/bash
# ═══════════════════════════════════════════════
# FAILOVER — Activate DR site when primary is DOWN
# Run from: your local machine
# ═══════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="ap-south-1"

DR_IP="$(cd "$PROJECT_DIR/terraform" && terraform output -raw dr_public_ip)"
DR_ID="$(cd "$PROJECT_DIR/terraform" && terraform output -raw dr_instance_id)"
SSH_KEY="${DR_SSH_KEY:-$HOME/.ssh/devops-learning-key.pem}"

echo "🚨 FAILOVER TO DR SERVER"
echo "========================="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "DR Server: $DR_IP ($DR_ID)"
echo ""

# 1. Start DR instance if stopped
echo "1/5 — Starting DR instance..."
aws ec2 start-instances --instance-ids "$DR_ID" --region "$REGION" 2>/dev/null || true
aws ec2 wait instance-running --instance-ids "$DR_ID" --region "$REGION"
echo "  ✅ Instance running"

# 2. Wait for SSH
echo "2/5 — Waiting for SSH..."
for i in $(seq 1 20); do
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$SSH_KEY" ubuntu@"$DR_IP" 'echo ok' 2>/dev/null; then
    echo "  ✅ SSH available"
    break
  fi
  echo "  Attempt $i/20..."
  sleep 10
done

# 3. Restore and start stack
echo "3/5 — Starting Docker stack on DR..."
ssh -i "$SSH_KEY" ubuntu@"$DR_IP" <<'REMOTE'
  cd /opt/devops-learning-web
  sudo -u deploy git pull origin main 2>/dev/null || true
  sudo pgbackrest --stanza=main restore --delta 2>/dev/null || echo "pgBackRest restore skipped"
  sudo -u deploy docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
REMOTE
echo "  ✅ Stack starting"

# 4. Wait for health check
echo "4/5 — Waiting for health check..."
for i in $(seq 1 20); do
  if curl -sf "http://$DR_IP:8080/api/health" > /dev/null 2>&1; then
    echo "  ✅ DR site healthy!"
    break
  fi
  echo "  Attempt $i/20 — waiting 15s..."
  sleep 15
done

# 5. Print access info
echo "5/5 — Failover complete"
echo ""
echo "═══════════════════════════════════════"
echo "✅ DR SITE ACTIVE"
echo "  URL: http://$DR_IP:8080"
echo "  SSH: ssh -i $SSH_KEY ubuntu@$DR_IP"
echo "  Health: curl http://$DR_IP:8080/api/health"
echo "═══════════════════════════════════════"
