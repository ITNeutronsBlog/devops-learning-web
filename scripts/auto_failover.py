#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════
AUTO FAILOVER DAEMON — PostgreSQL DR Automatic Failover
═══════════════════════════════════════════════════════════

Monitors the primary server's health and automatically triggers
failover to the DR server after consecutive failures.

Usage:
    python3 auto_failover.py                  # Start daemon
    python3 auto_failover.py --status         # Check current status
    python3 auto_failover.py --pause          # Pause monitoring (manual override)
    python3 auto_failover.py --resume         # Resume monitoring
    python3 auto_failover.py --failover-now   # Force immediate failover
    python3 auto_failover.py --reset          # Reset state to MONITORING

Requires: redis, requests, pyyaml, boto3
"""

import os
import sys
import time
import json
import signal
import logging
import argparse
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import yaml
import redis
import requests

# ════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════

SCRIPT_DIR = Path(__file__).parent.resolve()
CONFIG_PATH = SCRIPT_DIR / "auto_failover_config.yaml"
LOG_PATH = "/var/log/auto-failover.log"

REDIS_PREFIX = "auto_failover"
STATE_KEY = f"{REDIS_PREFIX}:status"
FAILURE_COUNT_KEY = f"{REDIS_PREFIX}:failure_count"
LAST_FAILOVER_KEY = f"{REDIS_PREFIX}:last_failover"
LOCK_KEY = f"{REDIS_PREFIX}:failover_lock"
HISTORY_KEY = f"{REDIS_PREFIX}:history"

# State machine states
STATE_MONITORING = "MONITORING"
STATE_WARNING = "WARNING"
STATE_FAILING_OVER = "FAILING_OVER"
STATE_DR_ACTIVE = "DR_ACTIVE"
STATE_FAILED = "FAILED"
STATE_MANUAL_OVERRIDE = "MANUAL_OVERRIDE"

# ════════════════════════════════════════════════
# LOGGING SETUP
# ════════════════════════════════════════════════

def setup_logging():
    """Configure logging to both file and stdout."""
    logger = logging.getLogger("auto_failover")
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # File handler
    try:
        fh = logging.FileHandler(LOG_PATH)
        fh.setFormatter(formatter)
        logger.addHandler(fh)
    except PermissionError:
        # Fallback to /tmp if /var/log isn't writable
        fh = logging.FileHandler("/tmp/auto-failover.log")
        fh.setFormatter(formatter)
        logger.addHandler(fh)

    # Stdout handler
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(formatter)
    logger.addHandler(sh)

    return logger


log = setup_logging()

# ════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════

def load_config():
    """Load configuration from YAML file."""
    if not CONFIG_PATH.exists():
        log.error(f"Config file not found: {CONFIG_PATH}")
        sys.exit(1)

    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    # Defaults
    monitoring = config.get("monitoring", {})
    config.setdefault("monitoring", {})
    config["monitoring"].setdefault("check_interval", 30)
    config["monitoring"].setdefault("failure_threshold", 5)
    config["monitoring"].setdefault("health_timeout", 10)
    config["monitoring"].setdefault("cooldown_period", 3600)
    config["monitoring"].setdefault("warning_threshold", 3)

    return config

# ════════════════════════════════════════════════
# REDIS STATE MANAGER
# ════════════════════════════════════════════════

class StateManager:
    """Manages failover state in Redis."""

    def __init__(self, redis_url="redis://localhost:6379/0"):
        self.r = redis.from_url(redis_url, decode_responses=True)
        # Initialize state if not exists
        if not self.r.exists(STATE_KEY):
            self.r.set(STATE_KEY, STATE_MONITORING)
            self.r.set(FAILURE_COUNT_KEY, 0)
        log.info(f"Redis connected — State: {self.get_status()}")

    def get_status(self):
        return self.r.get(STATE_KEY) or STATE_MONITORING

    def set_status(self, status):
        self.r.set(STATE_KEY, status)

    def get_failure_count(self):
        return int(self.r.get(FAILURE_COUNT_KEY) or 0)

    def increment_failure(self):
        return self.r.incr(FAILURE_COUNT_KEY)

    def reset_failure(self):
        self.r.set(FAILURE_COUNT_KEY, 0)

    def get_last_failover(self):
        ts = self.r.get(LAST_FAILOVER_KEY)
        return float(ts) if ts else 0

    def set_last_failover(self):
        self.r.set(LAST_FAILOVER_KEY, time.time())

    def acquire_lock(self, ttl=600):
        """Acquire failover lock (prevents concurrent failovers)."""
        return self.r.set(LOCK_KEY, "locked", nx=True, ex=ttl)

    def release_lock(self):
        self.r.delete(LOCK_KEY)

    def is_locked(self):
        return self.r.exists(LOCK_KEY)

    def add_history(self, event):
        """Add event to history list (keep last 100)."""
        entry = json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event
        })
        self.r.lpush(HISTORY_KEY, entry)
        self.r.ltrim(HISTORY_KEY, 0, 99)

    def get_history(self, count=10):
        entries = self.r.lrange(HISTORY_KEY, 0, count - 1)
        return [json.loads(e) for e in entries]

    def get_full_state(self):
        """Get complete state for --status command."""
        return {
            "status": self.get_status(),
            "failure_count": self.get_failure_count(),
            "last_failover": self.get_last_failover(),
            "locked": self.is_locked(),
            "recent_history": self.get_history(5)
        }

# ════════════════════════════════════════════════
# HEALTH CHECKS
# ════════════════════════════════════════════════

def check_primary_health(config):
    """
    Check if the primary server is healthy.
    Returns (is_healthy: bool, details: dict)
    """
    health_url = config["primary"]["health_url"]
    timeout = config["monitoring"]["health_timeout"]
    details = {"checks": {}}

    # Check 1: HTTP health endpoint
    try:
        resp = requests.get(health_url, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            db_status = data.get("database", {}).get("status", "unknown")
            details["checks"]["http"] = {
                "status": "pass",
                "response_time_ms": resp.elapsed.total_seconds() * 1000,
                "db_status": db_status
            }
            if db_status != "connected":
                details["checks"]["http"]["status"] = "warn"
                return False, details
        else:
            details["checks"]["http"] = {
                "status": "fail",
                "status_code": resp.status_code
            }
            return False, details
    except requests.exceptions.ConnectTimeout:
        details["checks"]["http"] = {"status": "fail", "error": "connection_timeout"}
        return False, details
    except requests.exceptions.ConnectionError:
        details["checks"]["http"] = {"status": "fail", "error": "connection_refused"}
        return False, details
    except requests.exceptions.ReadTimeout:
        details["checks"]["http"] = {"status": "fail", "error": "read_timeout"}
        return False, details
    except Exception as e:
        details["checks"]["http"] = {"status": "fail", "error": str(e)}
        return False, details

    # Check 2: PostgreSQL replication status (optional, checks if DR is receiving)
    try:
        result = subprocess.run(
            ["sudo", "docker", "exec", "devops-learning-db",
             "psql", "-U", "devops", "-d", "devops_learning",
             "-t", "-c", "SELECT 1;"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            details["checks"]["pg_local"] = {"status": "pass"}
        else:
            details["checks"]["pg_local"] = {"status": "skip", "note": "DR PG not running"}
    except Exception:
        details["checks"]["pg_local"] = {"status": "skip"}

    return True, details

# ════════════════════════════════════════════════
# NOTIFICATIONS
# ════════════════════════════════════════════════

def send_notification(config, level, message, details=None):
    """Send notification via configured channels."""
    notif = config.get("notifications", {})
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # Slack
    slack_webhook = notif.get("slack_webhook", "")
    if slack_webhook:
        try:
            emoji = {"info": "ℹ️", "warning": "⚠️", "critical": "🚨"}.get(level, "📋")
            payload = {
                "text": f"{emoji} *Auto Failover — {level.upper()}*\n"
                        f">{message}\n"
                        f"_Timestamp: {timestamp}_"
            }
            if details:
                payload["text"] += f"\n```{json.dumps(details, indent=2)}```"
            requests.post(slack_webhook, json=payload, timeout=10)
            log.info("Slack notification sent")
        except Exception as e:
            log.error(f"Slack notification failed: {e}")

    # Email via AWS SNS
    sns_topic = notif.get("sns_topic_arn", "")
    if sns_topic:
        try:
            import boto3
            sns = boto3.client("sns", region_name=config["dr"]["region"])
            subject = f"DR Auto Failover — {level.upper()}"
            body = f"{message}\n\nTimestamp: {timestamp}"
            if details:
                body += f"\n\nDetails:\n{json.dumps(details, indent=2)}"
            sns.publish(TopicArn=sns_topic, Subject=subject[:100], Message=body)
            log.info("SNS notification sent")
        except Exception as e:
            log.error(f"SNS notification failed: {e}")

    # Email via local mail command (fallback)
    email = notif.get("email", "")
    if email and not sns_topic:
        try:
            subprocess.run(
                ["mail", "-s", f"DR Failover — {level.upper()}", email],
                input=f"{message}\n\nTimestamp: {timestamp}",
                text=True, timeout=10, capture_output=True
            )
        except Exception:
            pass  # mail command may not be available

# ════════════════════════════════════════════════
# FAILOVER EXECUTION
# ════════════════════════════════════════════════

def execute_failover(config, state):
    """
    Execute the complete failover sequence.
    This is the critical path — every step is logged.
    """
    dr_config = config["dr"]
    primary = config["primary"]
    compose_path = dr_config["compose_path"]

    log.critical("🚨 ═══ FAILOVER INITIATED ═══")
    state.set_status(STATE_FAILING_OVER)
    state.add_history("FAILOVER_STARTED")

    steps_completed = []

    try:
        # ── Step 1: Acquire failover lock ──
        if not state.acquire_lock(ttl=600):
            log.error("❌ Could not acquire failover lock — another failover in progress")
            state.add_history("FAILOVER_BLOCKED_BY_LOCK")
            return False
        steps_completed.append("lock_acquired")
        log.info("1/6 — Failover lock acquired")

        # ── Step 2: Fence the primary (prevent split-brain) ──
        log.info("2/6 — Attempting to fence primary server...")
        try:
            ssh_user = primary.get("ssh_user", "ubuntu")
            ssh_host = primary["ssh_host"]
            ssh_key = primary.get("ssh_key", "")
            ssh_cmd = ["ssh", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no"]
            if ssh_key:
                ssh_cmd.extend(["-i", ssh_key])
            ssh_cmd.extend([f"{ssh_user}@{ssh_host}",
                           "docker stop devops-learning-app devops-learning-db 2>/dev/null || true"])
            result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                log.info("  ✅ Primary containers stopped (fenced)")
                steps_completed.append("primary_fenced")
            else:
                log.warning(f"  ⚠️ Could not fence primary: {result.stderr}")
                steps_completed.append("primary_fence_failed")
        except subprocess.TimeoutExpired:
            log.warning("  ⚠️ Primary unreachable for fencing (timeout) — proceeding anyway")
            steps_completed.append("primary_fence_timeout")
        except Exception as e:
            log.warning(f"  ⚠️ Fencing error: {e} — proceeding anyway")
            steps_completed.append("primary_fence_error")

        # ── Step 3: Promote PostgreSQL standby → primary ──
        log.info("3/6 — Promoting PostgreSQL standby to primary...")
        try:
            result = subprocess.run(
                ["sudo", "docker", "exec", "-u", "postgres", "devops-learning-db",
                 "pg_ctl", "promote", "-D", "/var/lib/postgresql/data"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                log.info("  ✅ PostgreSQL promoted to primary")
                steps_completed.append("pg_promoted")
            else:
                log.warning(f"  ⚠️ Promotion output: {result.stderr}")
                # Check if PG is already a primary (not in recovery)
                check = subprocess.run(
                    ["sudo", "docker", "exec", "devops-learning-db",
                     "psql", "-U", "devops", "-d", "devops_learning",
                     "-t", "-c", "SELECT pg_is_in_recovery();"],
                    capture_output=True, text=True, timeout=10
                )
                if "f" in check.stdout:
                    log.info("  ✅ PostgreSQL is already a primary")
                    steps_completed.append("pg_already_primary")
                else:
                    raise Exception(f"Promotion failed: {result.stderr}")
        except Exception as e:
            log.error(f"  ❌ PostgreSQL promotion failed: {e}")
            state.add_history(f"FAILOVER_FAILED: PG promotion — {e}")
            state.set_status(STATE_FAILED)
            state.release_lock()
            return False

        # ── Step 4: Start full application stack ──
        log.info("4/6 — Starting full application stack...")
        try:
            # Ensure video data directory exists
            os.makedirs("/data/videos/uploads", exist_ok=True)
            subprocess.run(["chmod", "777", "/data/videos"], capture_output=True)
            subprocess.run(["chmod", "777", "/data/videos/uploads"], capture_output=True)

            compose_files = [
                "-f", f"{compose_path}/docker-compose.yml",
                "-f", f"{compose_path}/docker-compose.prod.yml",
                "-f", f"{compose_path}/docker-compose.dr.yml",
            ]
            result = subprocess.run(
                ["sudo", "docker", "compose"] + compose_files + ["up", "-d"],
                capture_output=True, text=True, timeout=120, cwd=compose_path
            )
            if result.returncode == 0:
                log.info("  ✅ Application stack started")
                steps_completed.append("stack_started")
            else:
                log.error(f"  ❌ Stack failed: {result.stderr}")
                raise Exception(result.stderr)
        except Exception as e:
            log.error(f"  ❌ Stack start failed: {e}")
            state.add_history(f"FAILOVER_FAILED: Stack start — {e}")
            state.set_status(STATE_FAILED)
            state.release_lock()
            return False

        # ── Step 5: Wait for health check ──
        log.info("5/6 — Waiting for DR health check...")
        dr_healthy = False
        for attempt in range(1, 21):
            try:
                resp = requests.get("http://localhost:3005/api/health", timeout=10)
                if resp.status_code == 200:
                    log.info(f"  ✅ DR health check passed (attempt {attempt})")
                    dr_healthy = True
                    steps_completed.append("health_check_passed")
                    break
            except Exception:
                pass
            log.info(f"  Attempt {attempt}/20 — waiting 15s...")
            time.sleep(15)

        if not dr_healthy:
            log.error("  ❌ DR health check failed after 20 attempts")
            state.add_history("FAILOVER_FAILED: Health check")
            state.set_status(STATE_FAILED)
            state.release_lock()
            return False

        # ── Step 6: Finalize ──
        log.info("6/6 — Finalizing failover...")
        state.set_status(STATE_DR_ACTIVE)
        state.set_last_failover()
        state.reset_failure()
        state.release_lock()
        state.add_history("FAILOVER_COMPLETE")

        log.critical("═══════════════════════════════════════")
        log.critical("✅ FAILOVER COMPLETE — DR SITE ACTIVE")
        log.critical(f"   URL: http://localhost:3005")
        log.critical(f"   Steps: {', '.join(steps_completed)}")
        log.critical("═══════════════════════════════════════")

        # Send success notification
        send_notification(config, "critical",
            f"🚨 FAILOVER COMPLETE — DR site is now active!\n"
            f"Steps completed: {', '.join(steps_completed)}",
            {"steps": steps_completed}
        )

        return True

    except Exception as e:
        log.error(f"❌ Unexpected failover error: {e}")
        state.add_history(f"FAILOVER_ERROR: {e}")
        state.set_status(STATE_FAILED)
        state.release_lock()
        send_notification(config, "critical",
            f"❌ FAILOVER FAILED: {e}\nSteps completed: {', '.join(steps_completed)}")
        return False

# ════════════════════════════════════════════════
# MAIN MONITORING LOOP
# ════════════════════════════════════════════════

def monitoring_loop(config, state):
    """Main monitoring loop — runs every check_interval seconds."""
    interval = config["monitoring"]["check_interval"]
    threshold = config["monitoring"]["failure_threshold"]
    warning_at = config["monitoring"]["warning_threshold"]
    cooldown = config["monitoring"]["cooldown_period"]

    log.info("═══════════════════════════════════════")
    log.info("🔍 AUTO FAILOVER DAEMON STARTED")
    log.info(f"   Primary:    {config['primary']['health_url']}")
    log.info(f"   Interval:   {interval}s")
    log.info(f"   Threshold:  {threshold} consecutive failures")
    log.info(f"   Cooldown:   {cooldown}s after failover")
    log.info("═══════════════════════════════════════")

    while True:
        try:
            current_status = state.get_status()

            # Skip if manually paused
            if current_status == STATE_MANUAL_OVERRIDE:
                log.debug("⏸ Monitoring paused (manual override)")
                time.sleep(interval)
                continue

            # Skip if DR is already active
            if current_status == STATE_DR_ACTIVE:
                log.debug("🟢 DR is active — monitoring paused")
                time.sleep(interval)
                continue

            # Skip if in failed state (needs manual reset)
            if current_status == STATE_FAILED:
                log.debug("❌ In FAILED state —  use --reset to resume")
                time.sleep(interval)
                continue

            # Check cooldown period
            last_failover = state.get_last_failover()
            if last_failover > 0:
                elapsed = time.time() - last_failover
                if elapsed < cooldown:
                    remaining = int(cooldown - elapsed)
                    log.debug(f"⏳ Cooldown active — {remaining}s remaining")
                    time.sleep(interval)
                    continue

            # ── Perform health check ──
            is_healthy, details = check_primary_health(config)

            if is_healthy:
                # Reset failure count on success
                prev_count = state.get_failure_count()
                state.reset_failure()
                if current_status == STATE_WARNING:
                    state.set_status(STATE_MONITORING)
                    log.info("✅ Primary recovered — state reset to MONITORING")
                    state.add_history("PRIMARY_RECOVERED")
                    send_notification(config, "info", "Primary server recovered ✅")
                elif prev_count > 0:
                    state.set_status(STATE_MONITORING)
                    log.info(f"✅ Primary healthy (was at failure count {prev_count})")
                else:
                    log.info("✅ Primary healthy")
            else:
                # Increment failure count
                count = state.increment_failure()
                http_details = details.get("checks", {}).get("http", {})
                error = http_details.get("error", http_details.get("status_code", "unknown"))
                log.warning(f"⚠️ Primary UNHEALTHY ({count}/{threshold}) — {error}")

                if count >= warning_at and count < threshold:
                    state.set_status(STATE_WARNING)
                    if count == warning_at:
                        log.warning(f"🔶 WARNING: {count} consecutive failures!")
                        state.add_history(f"WARNING: {count} failures")
                        send_notification(config, "warning",
                            f"⚠️ Primary server failing! {count}/{threshold} checks failed.\n"
                            f"Error: {error}\n"
                            f"Failover will trigger at {threshold} failures.")

                if count >= threshold:
                    log.critical(f"🚨 THRESHOLD REACHED: {count}/{threshold} — TRIGGERING FAILOVER!")
                    state.add_history(f"THRESHOLD_REACHED: {count} failures")
                    send_notification(config, "critical",
                        f"🚨 Primary down for {count * interval}s — triggering automatic failover!")

                    success = execute_failover(config, state)
                    if not success:
                        log.error("❌ Failover failed — entering FAILED state")
                        send_notification(config, "critical",
                            "❌ Automatic failover FAILED! Manual intervention required.")

        except redis.exceptions.ConnectionError:
            log.error("❌ Redis connection lost — retrying in 10s")
            time.sleep(10)
            continue
        except KeyboardInterrupt:
            log.info("🛑 Daemon stopped by user (Ctrl+C)")
            sys.exit(0)
        except Exception as e:
            log.error(f"❌ Unexpected error in monitoring loop: {e}")

        time.sleep(interval)

# ════════════════════════════════════════════════
# CLI COMMANDS
# ════════════════════════════════════════════════

def cmd_status(state):
    """Show current failover status."""
    info = state.get_full_state()
    status_emoji = {
        STATE_MONITORING: "🟢",
        STATE_WARNING: "🟡",
        STATE_FAILING_OVER: "🔴",
        STATE_DR_ACTIVE: "🔵",
        STATE_FAILED: "❌",
        STATE_MANUAL_OVERRIDE: "⏸"
    }
    emoji = status_emoji.get(info["status"], "❓")

    print("═══════════════════════════════════════")
    print("  AUTO FAILOVER STATUS")
    print("═══════════════════════════════════════")
    print(f"  Status:        {emoji} {info['status']}")
    print(f"  Failure Count: {info['failure_count']}")
    print(f"  Locked:        {'🔒 Yes' if info['locked'] else '🔓 No'}")
    if info["last_failover"] > 0:
        last = datetime.fromtimestamp(info["last_failover"], timezone.utc)
        print(f"  Last Failover: {last.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    else:
        print("  Last Failover: Never")
    print()
    if info["recent_history"]:
        print("  Recent Events:")
        for entry in info["recent_history"]:
            print(f"    {entry['timestamp']} — {entry['event']}")
    print("═══════════════════════════════════════")


def cmd_pause(state):
    """Pause automatic monitoring."""
    state.set_status(STATE_MANUAL_OVERRIDE)
    state.add_history("MANUAL_OVERRIDE_ENABLED")
    print("⏸ Automatic failover PAUSED — use --resume to re-enable")


def cmd_resume(state):
    """Resume automatic monitoring."""
    state.set_status(STATE_MONITORING)
    state.reset_failure()
    state.add_history("MONITORING_RESUMED")
    print("▶️ Automatic failover RESUMED")


def cmd_reset(state):
    """Reset state to MONITORING."""
    state.set_status(STATE_MONITORING)
    state.reset_failure()
    state.release_lock()
    state.add_history("STATE_RESET")
    print("🔄 State reset to MONITORING")


def cmd_failover_now(config, state):
    """Force immediate failover."""
    print("🚨 FORCING IMMEDIATE FAILOVER!")
    confirm = input("Type 'FAILOVER' to confirm: ").strip()
    if confirm != "FAILOVER":
        print("❌ Cancelled — must type 'FAILOVER' exactly")
        return
    state.add_history("MANUAL_FAILOVER_TRIGGERED")
    success = execute_failover(config, state)
    if success:
        print("✅ Failover complete!")
    else:
        print("❌ Failover failed — check logs")

# ════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Auto Failover Daemon")
    parser.add_argument("--status", action="store_true", help="Show current status")
    parser.add_argument("--pause", action="store_true", help="Pause monitoring")
    parser.add_argument("--resume", action="store_true", help="Resume monitoring")
    parser.add_argument("--reset", action="store_true", help="Reset to MONITORING state")
    parser.add_argument("--failover-now", action="store_true", help="Force immediate failover")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="Config file path")
    args = parser.parse_args()

    # Load config
    config = load_config()

    # Connect to Redis
    redis_url = config.get("redis", {}).get("url", "redis://localhost:6379/0")
    try:
        state = StateManager(redis_url)
    except redis.exceptions.ConnectionError:
        print("❌ Cannot connect to Redis. Is it running?")
        print("   Start with: sudo systemctl start redis")
        sys.exit(1)

    # Handle CLI commands
    if args.status:
        cmd_status(state)
    elif args.pause:
        cmd_pause(state)
    elif args.resume:
        cmd_resume(state)
    elif args.reset:
        cmd_reset(state)
    elif args.failover_now:
        cmd_failover_now(config, state)
    else:
        # Handle graceful shutdown
        def signal_handler(sig, frame):
            log.info("🛑 Received shutdown signal — stopping daemon")
            state.add_history("DAEMON_STOPPED")
            sys.exit(0)

        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)

        # Start monitoring loop
        monitoring_loop(config, state)


if __name__ == "__main__":
    main()
