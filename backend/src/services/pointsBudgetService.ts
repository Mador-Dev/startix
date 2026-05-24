import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { getAdminDefaults } from "./adminDefaultsService.js";

export interface UserPointsBalanceSnapshot {
  dailyBudgetPoints: number;
  pointsUsed: number;
  pointsRemaining: number;
  pctUsed: number;
  exhausted: boolean;
  windowStart: string;
  windowEnd: string;
}

function roundPoints(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clampMinZero(value: number): number {
  return value > 0 ? value : 0;
}

export async function getEffectiveDailyPointsBudget(userId: string): Promise<number> {
  const defaults = await getAdminDefaults();
  if (!isApplicationDatabaseConfigured()) {
    return defaults.pointsBudget.dailyBudgetPoints;
  }

  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT daily_points_budget FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  ) as Array<{ daily_points_budget: string | number | null }>;

  const raw = Number(rows[0]?.daily_points_budget);
  if (Number.isFinite(raw) && raw > 0) {
    return roundPoints(raw);
  }
  return roundPoints(defaults.pointsBudget.dailyBudgetPoints);
}

export async function setUserDailyPointsBudget(userId: string, dailyBudgetPoints: number): Promise<number> {
  if (!Number.isFinite(dailyBudgetPoints) || dailyBudgetPoints <= 0) {
    throw new Error("dailyBudgetPoints must be greater than zero");
  }
  if (!isApplicationDatabaseConfigured()) {
    return roundPoints(dailyBudgetPoints);
  }

  const budget = roundPoints(dailyBudgetPoints);
  const ds = await getApplicationDataSource();
  // Update the budget cap and reset the live balance to the new cap.
  await ds.query(
    `UPDATE users
        SET daily_points_budget = $2,
            points              = $2,
            updated_at          = NOW()
      WHERE user_id = $1`,
    [userId, budget]
  );
  return budget;
}

export async function grantUserPointsCredit(
  userId: string,
  points: number,
  note: string | null,
  refId?: string | null
): Promise<void> {
  if (!Number.isFinite(points) || points <= 0) {
    throw new Error("points must be greater than zero");
  }
  if (!isApplicationDatabaseConfigured()) return;

  const amount = roundPoints(points);
  const ds = await getApplicationDataSource();

  // Credit the live balance on the users row.
  await ds.query(
    `UPDATE users
        SET points     = points + $2,
            updated_at = NOW()
      WHERE user_id = $1`,
    [userId, amount]
  );

  // Keep ledger for audit trail.
  await ds.query(
    `INSERT INTO user_points_ledger (
       user_id, points_delta, entry_type, source, action, ref_id, note, expires_at
     ) VALUES (
       $1, $2, 'credit', 'admin', 'grant_credit', $3, $4, NOW() + INTERVAL '24 hours'
     )`,
    [userId, amount, refId ?? null, note?.slice(0, 1_000) ?? null]
  );
}

export async function getUserPointsBalance(userId: string): Promise<UserPointsBalanceSnapshot> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const windowEnd   = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();

  const budget = await getEffectiveDailyPointsBudget(userId);
  if (!isApplicationDatabaseConfigured()) {
    return {
      dailyBudgetPoints: budget,
      pointsUsed: 0,
      pointsRemaining: budget,
      pctUsed: 0,
      exhausted: false,
      windowStart,
      windowEnd,
    };
  }

  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT points FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  ) as Array<{ points: string | number | null }>;

  const pointsRemaining = roundPoints(clampMinZero(Number(rows[0]?.points ?? budget)));
  const pointsUsed      = roundPoints(clampMinZero(budget - pointsRemaining));
  const pctUsed         = Math.max(0, Math.min(999, Math.round(
    budget > 0 ? (pointsUsed / budget) * 100 : 0
  )));

  return {
    dailyBudgetPoints: budget,
    pointsUsed,
    pointsRemaining,
    pctUsed,
    exhausted: pointsRemaining <= 0,
    windowStart,
    windowEnd,
  };
}

/**
 * Reset every non-blocked user's live points balance back to their daily budget.
 * Called by the watchdog once per day (tracked via `points_replenished_at`).
 */
export async function replenishAllUserPoints(): Promise<number> {
  if (!isApplicationDatabaseConfigured()) return 0;

  const ds = await getApplicationDataSource();
  const result = await ds.query(
    `UPDATE users
        SET points                = COALESCE(daily_points_budget, 500),
            points_replenished_at = NOW(),
            updated_at            = NOW()
      WHERE state != 'BLOCKED'
        AND (
          points_replenished_at IS NULL
          OR points_replenished_at < NOW() - INTERVAL '23 hours'
        )
      RETURNING user_id`
  ) as Array<{ user_id: string }>;

  return Array.isArray(result) ? result.length : 0;
}
