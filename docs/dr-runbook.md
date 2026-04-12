# Disaster Recovery Runbook — DevOps Learning Hub

## Overview

| Metric | Target | Strategy |
|--------|--------|----------|
| **RPO** (Recovery Point Objective) | < 5 minutes | Continuous WAL archiving to S3 |
| **RTO** (Recovery Time Objective) | < 15 minutes | DR server in Mumbai (Terraform-provisioned) |
| **DR Site** | AWS EC2 `ap-south-1` | t3.small, PostgreSQL in Docker |
| **Backup Storage** | AWS S3 | pgBackRest with AES-256 encryption |

---

## Failover Procedure (When Primary Goes DOWN)

| Step | Action | Time | Command |
|------|--------|------|---------|
| 1 | Detect failure (health check / alert) | 0:00 | `curl http://primary-ip:8080/api/health` |
| 2 | Verify primary is unreachable | 0:02 | `ping primary-ip` + SSH check |
| 3 | Start DR EC2 instance | 0:03 | `aws ec2 start-instances --instance-ids $DR_ID --region ap-south-1` |
| 4 | Wait for instance to boot | 0:05 | `aws ec2 wait instance-running` |
| 5 | Restore PG from S3 backup | 0:07 | `pgbackrest --stanza=main restore --delta` |
| 6 | Start Docker stack on DR | 0:10 | `docker compose up -d` |
| 7 | Verify health check | 0:12 | `curl http://dr-ip:8080/api/health` |
| 8 | Update DNS / notify users | 0:15 | Manual DNS update or share new IP |

**Automated failover script**: `scripts/dr-failover.sh`

---

## Failback Procedure (Return to Primary)

1. Verify primary server is restored and healthy
2. If data was written to DR during outage:
   - `pg_dump -U devops devops_learning | ssh primary-server pg_restore`
3. Start Docker stack on primary
4. Verify health check
5. Stop DR EC2 instance to save costs
6. Revert DNS if changed

**Automated failback script**: `scripts/dr-failback.sh`

---

## Backup Schedule

| Type | Frequency | Retention | Command |
|------|-----------|-----------|---------|
| **WAL Archive** | Continuous | 90 days | Automatic via `archive_command` |
| **Full Backup** | Weekly (Sunday 2 AM) | 4 copies | `pgbackrest backup --type=full` |
| **Diff Backup** | Daily (2 AM) | 14 copies | `pgbackrest backup --type=diff` |

---

## DR Drill Schedule

| Drill Type | Frequency | Duration |
|------------|-----------|----------|
| **Backup Verification** | Monthly | 30 min |
| **Full Failover** | Quarterly | 1-2 hours |
| **Full Rebuild** | Annually | 2-4 hours |

### DR Drill Checklist

```markdown
## DR Drill Report — [DATE]

### Pre-Drill
- [ ] Document current primary DB state (row counts)
- [ ] Verify backups are current (pgbackrest info)
- [ ] Confirm DR instance exists in AWS

### Execution
- [ ] Start DR EC2 instance
- [ ] Restore from S3 backup
- [ ] Start Docker compose stack
- [ ] Verify health check passes
- [ ] Verify video list returns correct data
- [ ] Verify video streaming works
- [ ] Verify new uploads succeed

### Post-Drill
- [ ] Record actual RTO: ___ minutes
- [ ] Record actual RPO: ___ (data loss if any)
- [ ] Stop DR EC2 instance
- [ ] Document issues encountered
- [ ] Update this runbook with lessons learned
```

**Automated drill script**: `scripts/dr-drill.sh`

---

## Monitoring

- **Health endpoint**: `GET /api/health` — returns PostgreSQL status, pool stats
- **DR monitor script**: `scripts/dr-monitor.sh` — runs every 5 min via cron
- Checks: PostgreSQL connectivity, app health, disk usage, container status
