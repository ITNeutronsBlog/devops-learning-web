# Disaster Recovery (DR) Drill Plan

This document outlines the standard operating procedure for conducting a full Disaster Recovery Drill for the DevOps Learning Hub. 

Unlike the legacy backup/restore strategy, this guide reflects the current **Active-Standby Streaming Replication** architecture powered by the `auto_failover.py` and `auto_failback.py` orchestrators.

---

## 🎯 Drill Objectives
- **Validate RPO (Recovery Point Objective):** Ensure streaming replication is maintaining near-zero data loss.
- **Validate RTO (Recovery Time Objective):** Ensure `auto_failover.py` promotes the DR server to primary within 5 minutes.
- **Validate Failback:** Ensure `auto_failback.py` successfully re-syncs the DR server's timeline and coverts it back to a standby without configuration corruption.

---

## 📋 Phase 1: Pre-Drill Preparation

**1. Announce the Drill**
- Notify stakeholders that the primary database will be intentionally fenced and a failover will occur.
- Expected downtime: 2-5 minutes during failover, 2-5 minutes during failback.

**2. Verify System Health**
Run these checks on the **Primary Server**:
- Verify Primary Application is healthy: `curl http://localhost:3005/api/health`
- Verify DR is streaming: `docker exec devops-learning-db psql -U devops -d devops_learning -c 'SELECT * FROM pg_stat_replication;'`

**3. Insert "Tracer" Data**
- Upload a specific test video or insert a clear dummy record (e.g., "DR-DRILL-TEST-1") into the database.
- Immediately verify this data exists on the Primary frontend.

---

## 🔥 Phase 2: Execute Failover (Simulate Disaster)

We will use the automated failover daemon to conduct the failover.

**1. Isolate the Primary (Simulate Failure)**
On the **Primary Server**, manually stop the database so the failover daemon detects a crash:
```bash
sudo docker stop devops-learning-db
```

**2. Monitor Auto-Failover**
The `auto_failover.py` daemon running on your orchestrator/Primary node will detect the failure (within its polling interval, usually ~30 seconds) and automatically:
1. Fence the primary.
2. Promote the DR database to Primary using `pg_ctl promote`.
3. Sanitize `postgresql.auto.conf` on the DR.
4. Bring up the application stack on the DR server.

**3. Validate DR Takeover**
- Open the application using the **DR Server IP**.
- Verify the "Tracer" data ("DR-DRILL-TEST-1") is visible. This proves zero data loss (RPO = 0).
- Upload a *new* piece of test data directly to the DR server (e.g., "DR-DRILL-TEST-2"). This proves the DR server is accepting writes.

---

## 🔄 Phase 3: Execute Failback (Restore Normalcy)

Once the drill is validated, we return authority back to the Primary server. 

> [!WARNING]  
> The DR server is currently on a "future" timeline because it accepted writes. We must run the orchestrator script to properly sync this data back to the primary.

**1. Run the Automator**
On your **Local Machine**, run the failback script:
```bash
cd /Users/veeradinesh/Documents/Project-x/Devops-personal-learning
python3 scripts/auto_failback.py
```

**2. What the Script Validates & Executes:**
- Stops the DR application stack.
- Uses `pg_dump` to copy the data (including "DR-DRILL-TEST-2") from the DR server over SSH to the Primary Server.
- Restarts the Primary stack as the primary authority.
- Drops the `/data/postgres` directory on the DR server.
- Uses `pg_basebackup` to securely clone the Primary back to the DR Server.
- Configures `standby.signal` and rewrites `postgresql.auto.conf` cleanly.

**3. Validate Normalcy**
- Open the application using the **Primary Server IP**.
- Verify BOTH "DR-DRILL-TEST-1" and "DR-DRILL-TEST-2" are visible. This proves data generated during the outage was successfully preserved.
- Verify the DR Database is back in standby mode:
  ```bash
  # Run on DR Server
  sudo docker exec devops-learning-db psql -U devops -d devops_learning -t -c "SELECT pg_is_in_recovery();"
  # Should output: 't' (true)
  ```

---

## 📝 Phase 4: Post-Drill Teardown

1. **Clean up Tracer Data:** Delete "DR-DRILL-TEST-1" and "DR-DRILL-TEST-2" from the application.
2. **Review Logs:** Check the orchestrated logs from both python scripts to ensure no silent warnings occurred.
3. **Sign-off:** Record the timestamps for the actual RTO (total time application was down during the transition) and officially close the drill.
