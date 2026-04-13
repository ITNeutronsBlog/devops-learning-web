#!/bin/bash
# ═══════════════════════════════════════════════
# FAILBACK — Return traffic to primary server
# ═══════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="ap-south-1"

DR_ID="$(cd "$PROJECT_DIR/terraform" && terraform output -raw dr_instance_id)"
DR_IP="$(cd "$PROJECT_DIR/terraform" && terraform output -raw dr_public_ip)"
SSH_KEY="${DR_SSH_KEY:-$HOME/.ssh/devops-learning-key.pem}"

echo "🔄 FAILBACK TO PRIMARY"
echo "======================"

# 1. Sync any new data from DR back to primary (manual step)
echo "⚠️  CRITICAL: You should use 'python3 auto_failback.py' instead!"
echo "   The Python script safely handles pg_basebackup and postgresql.auto.conf"
echo "   to prevent database corruption loops."
echo ""
echo "If you proceed manually, you must:"
echo "   1. pg_dump on DR server"
echo "   2. pg_restore on primary"
echo "   3. Manually recreate postgresql.auto.conf on both servers"
echo ""
read -p "Press Enter to proceed manually (or Ctrl+C to cancel)..."

# 2. Stop DR stack
echo "Stopping DR Docker stack..."
ssh -i "$SSH_KEY" ubuntu@"$DR_IP" \
  "cd /opt/devops-learning-web && sudo -u deploy docker compose down" 2>/dev/null || true

# 3. Stop EC2 to save costs
echo "Stopping DR EC2 instance..."
aws ec2 stop-instances --instance-ids "$DR_ID" --region "$REGION"
echo "  ✅ DR instance stopping (saves ~$13.50/mo)"

echo ""
echo "✅ FAILBACK COMPLETE — primary is serving traffic"
