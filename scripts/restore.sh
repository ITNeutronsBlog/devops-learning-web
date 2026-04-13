#!/bin/bash
# ═══════════════════════════════════════════════
# PostgreSQL Restore Script (pgBackRest)
# Usage:
#   ./restore.sh                    # Full restore (latest)
#   ./restore.sh "2026-04-12 12:00" # Point-in-time recovery
# ═══════════════════════════════════════════════
set -euo pipefail

TARGET_TIME="${1:-}"
LOG_PREFIX="[RESTORE $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

echo "$LOG_PREFIX Starting restore..."

# Stop PostgreSQL container
echo "$LOG_PREFIX Stopping PostgreSQL container..."
docker stop devops-learning-db-prod 2>/dev/null || true

if [ -n "$TARGET_TIME" ]; then
  echo "$LOG_PREFIX Point-in-time recovery to: $TARGET_TIME"
  pgbackrest --stanza=main restore --delta --type=time --target="$TARGET_TIME"
else
  echo "$LOG_PREFIX Full restore (latest backup)"
  pgbackrest --stanza=main restore --delta
fi

# Start PostgreSQL
echo "$LOG_PREFIX Starting PostgreSQL container..."
docker start devops-learning-db-prod

# Wait for PG to be ready
echo "$LOG_PREFIX Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker exec devops-learning-db-prod pg_isready -U devops -d devops_learning > /dev/null 2>&1; then
    echo "$LOG_PREFIX ✅ PostgreSQL is ready"
    break
  fi
  sleep 2
done

# Verify data
echo "$LOG_PREFIX Verifying data..."
docker exec devops-learning-db-prod psql -U devops -d devops_learning -c "SELECT COUNT(*) as video_count FROM videos;"

echo "$LOG_PREFIX ✅ Restore complete"
