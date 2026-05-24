import type { DataSource } from "typeorm";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { logger } from "../logger.js";
import { unwrapMutationRows } from "../dbUtils.js";
import { replenishAllUserPoints } from "../pointsBudgetService.js";

/**
 * Postgres-only watchdog for the simplified job model.
 *
 * The live system has durable `jobs` rows, but no durable step queue. Keep the
 * watchdog focused on one concern only: mark clearly stale jobs as failed so
 * the UI and scheduler do not accumulate stuck pending/running entries.
 */

const ACTION_TIMEOUT_MINUTES: Record<string, number> = {
  "quick_check":  5,
  "daily_brief":  60,
  "deep_dive":    180,
  "full_report":  240,
  "new_ideas":    120,
};

const DEFAULT_JOB_TIMEOUT_MINUTES = 60;

/** Pending jobs that were never picked up: allow 2 × 30-min scheduler cycles. */
const PENDING_JOB_STALE_MINUTES = 90;

const SCAN_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Job-level sweep
// ---------------------------------------------------------------------------

async function sweepStuckJobs(ds: DataSource): Promise<number> {
  // Jobs that have been `running` longer than their action-specific timeout
  // are marked `failed`. This is intentionally coarse-grained: one durable job
  // record is the unit of recovery in the simplified workflow.
  const cases = Object.entries(ACTION_TIMEOUT_MINUTES)
    .map(([action, minutes]) => `WHEN action = '${action}' THEN INTERVAL '${minutes} minutes'`)
    .join("\n         ");
  const defaultInterval = `INTERVAL '${DEFAULT_JOB_TIMEOUT_MINUTES} minutes'`;

  const result = await ds.query(
    `UPDATE jobs
        SET status = 'failed',
            completed_at = NOW(),
            failure_reason = 'Watchdog: job exceeded action-specific timeout'
      WHERE status = 'running'
        AND started_at < NOW() - CASE
         ${cases}
         ELSE ${defaultInterval}
       END
      RETURNING id, action, user_id`
  );

  const validRows = unwrapMutationRows<{ id: string; action: string; user_id: string }>(result);
  for (const row of validRows) {
    logger.warn(
      `Watchdog: failed stuck job job_id=${row.id} action=${row.action} user=${row.user_id}`
    );
  }
  return validRows.length;
}

// ---------------------------------------------------------------------------
// Pending-job sweep (never picked up)
// ---------------------------------------------------------------------------

async function sweepAbandonedPendingJobs(ds: DataSource): Promise<number> {
  const result = await ds.query(
    `UPDATE jobs
        SET status = 'failed',
            completed_at = NOW(),
            failure_reason = 'Watchdog: job was never picked up (pending timeout)'
      WHERE status = 'pending'
        AND triggered_at < NOW() - INTERVAL '${PENDING_JOB_STALE_MINUTES} minutes'
      RETURNING id, action, user_id`
  );

  const validRows = unwrapMutationRows<{ id: string; action: string; user_id: string }>(result);
  for (const row of validRows) {
    logger.warn(
      `Watchdog: abandoned pending job job_id=${row.id} action=${row.action} user=${row.user_id}`
    );
  }
  return validRows.length;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

async function scan(): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  scanning = true;
  try {
    const ds = await getApplicationDataSource();
    const [jobs, pending, replenished] = await Promise.all([
      sweepStuckJobs(ds),
      sweepAbandonedPendingJobs(ds),
      replenishAllUserPoints(),
    ]);
    if (jobs > 0 || pending > 0 || replenished > 0) {
      logger.info(
        `Watchdog scan: failed_jobs=${jobs} abandoned_pending=${pending} points_replenished=${replenished}`
      );
    }
  } finally {
    scanning = false;
  }
}

let interval: ReturnType<typeof setInterval> | null = null;
let scanning = false; // R9: prevent concurrent sweeps

export function startWatchdog(): void {
  if (interval) return;

  // Delay initial scan 30 s so the server fully starts before touching rows.
  setTimeout(() => {
    scan().catch((err: Error) =>
      logger.error(`Watchdog initial scan error: ${err.message}`)
    );
  }, 30_000);

  interval = setInterval(() => {
    if (scanning) return; // R9: skip if previous sweep is still running
    scan().catch((err: Error) =>
      logger.error(`Watchdog scan error: ${err.message}`)
    );
  }, SCAN_INTERVAL_MS);

  logger.info(
    `Postgres-only watchdog started — scan_interval=${SCAN_INTERVAL_MS / 60000}min`
  );
}

export function stopWatchdog(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
