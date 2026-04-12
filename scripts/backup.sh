#!/bin/bash
# ═══════════════════════════════════════════════
# PostgreSQL Backup Script (pgBackRest)
# Run via cron:
#   0 2 * * 0  /scripts/backup.sh full      # Weekly full (Sunday 2 AM)
#   0 2 * * 1-6 /scripts/backup.sh diff      # Daily differential
# ═══════════════════════════════════════════════
set -euo pipefail

BACKUP_TYPE="${1:-diff}"
LOG_PREFIX="[BACKUP $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

echo "$LOG_PREFIX Starting ${BACKUP_TYPE} backup..."

# Run pgBackRest backup
if pgbackrest --stanza=main backup --type="${BACKUP_TYPE}"; then
  echo "$LOG_PREFIX ✅ ${BACKUP_TYPE} backup completed successfully"
else
  echo "$LOG_PREFIX ❌ ${BACKUP_TYPE} backup FAILED"
  exit 1
fi

# Verify backup integrity
echo "$LOG_PREFIX Verifying backup..."
pgbackrest --stanza=main check

# Show backup info
echo "$LOG_PREFIX Backup info:"
pgbackrest --stanza=main info

echo "$LOG_PREFIX Done"
