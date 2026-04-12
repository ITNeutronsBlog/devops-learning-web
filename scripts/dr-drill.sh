#!/bin/bash
# ═══════════════════════════════════════════════
# DR DRILL — Quarterly disaster recovery test
# Tests the full recovery chain
# ═══════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="ap-south-1"
SSH_KEY="${DR_SSH_KEY:-$HOME/.ssh/devops-learning-key.pem}"

DRILL_DATE=$(date +%Y-%m-%d)
LOG="/tmp/dr-drill-$DRILL_DATE.log"
PASS=0
FAIL=0

echo "🔥 DR DRILL — $DRILL_DATE" | tee "$LOG"

check() {
  local name=$1; shift
  printf "  [%-30s] " "$name" | tee -a "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    echo "✅ PASS" | tee -a "$LOG"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL" | tee -a "$LOG"
    FAIL=$((FAIL + 1))
  fi
}

echo "— Phase 1: Pre-flight" | tee -a "$LOG"
check "Terraform state valid" terraform -chdir="$PROJECT_DIR/terraform" validate
check "AWS credentials" aws sts get-caller-identity --region "$REGION"

DR_ID="$(cd "$PROJECT_DIR/terraform" && terraform output -raw dr_instance_id 2>/dev/null || echo "")"
DR_IP="$(cd "$PROJECT_DIR/terraform" && terraform output -raw dr_public_ip 2>/dev/null || echo "")"
S3_BUCKET="$(cd "$PROJECT_DIR/terraform" && terraform output -raw s3_backup_bucket 2>/dev/null || echo "")"

check "DR instance exists" test -n "$DR_ID"
check "S3 bucket accessible" aws s3 ls "s3://$S3_BUCKET/" --region "$REGION"

echo "— Phase 2: Start DR" | tee -a "$LOG"
check "Start instance" aws ec2 start-instances --instance-ids "$DR_ID" --region "$REGION"
check "Wait for running" aws ec2 wait instance-running --instance-ids "$DR_ID" --region "$REGION"

echo "— Phase 3: Verify Stack" | tee -a "$LOG"
sleep 60  # Wait for Docker to start
check "SSH accessible" ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no -i "$SSH_KEY" ubuntu@"$DR_IP" 'echo ok'
check "Docker running" ssh -i "$SSH_KEY" ubuntu@"$DR_IP" 'docker ps --format "{{.Names}}"'

echo "— Phase 4: Cleanup" | tee -a "$LOG"
check "Stop instance" aws ec2 stop-instances --instance-ids "$DR_ID" --region "$REGION"

echo "" | tee -a "$LOG"
echo "═══════════════════════════════════════" | tee -a "$LOG"
echo "RESULTS: $PASS passed, $FAIL failed" | tee -a "$LOG"
echo "Log: $LOG" | tee -a "$LOG"
echo "═══════════════════════════════════════" | tee -a "$LOG"
