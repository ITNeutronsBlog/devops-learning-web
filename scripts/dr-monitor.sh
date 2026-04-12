#!/bin/bash
# ═══════════════════════════════════════════════
# DR Health Monitoring Script
# Run via cron every 5 minutes
# ═══════════════════════════════════════════════
set -euo pipefail

LOG_PREFIX="[DR-MONITOR $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

# Check PostgreSQL primary connectivity
check_pg() {
  if docker exec devops-learning-db pg_isready -U devops -d devops_learning > /dev/null 2>&1; then
    echo "$LOG_PREFIX PostgreSQL: ✅ healthy"
  else
    echo "$LOG_PREFIX PostgreSQL: ❌ UNHEALTHY"
    return 1
  fi
}

# Check app health
check_app() {
  if curl -sf http://localhost:3005/api/health > /dev/null 2>&1; then
    echo "$LOG_PREFIX App: ✅ healthy"
  else
    echo "$LOG_PREFIX App: ❌ UNHEALTHY"
    return 1
  fi
}

# Check Docker containers
check_containers() {
  local running=$(docker ps --filter "name=devops-learning" --format '{{.Names}}' | wc -l)
  echo "$LOG_PREFIX Containers running: $running"
}

# Check disk space
check_disk() {
  local usage=$(df /data 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
  if [ -n "$usage" ] && [ "$usage" -gt 85 ]; then
    echo "$LOG_PREFIX Disk: ⚠️  WARNING - ${usage}% used"
  else
    echo "$LOG_PREFIX Disk: ✅ ${usage:-?}% used"
  fi
}

# Run all checks
check_pg
check_app
check_containers
check_disk
