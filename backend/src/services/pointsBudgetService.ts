import { promises as fs } from "fs";
import path from "path";
import { eventStore } from "./eventStore.js";
import { budgetStore } from "./budgetStore.js";
import { DEFAULT_POINTS_BUDGET, type PointsBudgetConfig } from "../types/index.js";
import { resolveConfiguredPath } from "./paths.js";
import { ensureUserRecord } from "./userStore.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
export const POINTS_PER_USD = 1000;
export const POINTS_BUDGET_WINDOW_HOURS = 24;

export interface PointsBalanceSnapshot {
  dailyBudgetPoints: number;
  pointsUsed: number;
  pointsRemaining: number;
  pctUsed: number;
  exhausted: boolean;
  windowStart: string;
  windowEnd: string;
}

function profilePath(userId: string): string {
  return path.join(USERS_DIR, userId, "profile.json");
}

function normalizeDailyBudgetPoints(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_POINTS_BUDGET.dailyBudgetPoints;
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

export function usdToPoints(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * POINTS_PER_USD * 1_000_000) / 1_000_000;
}

export function buildPointsBalanceSnapshot(
  config: PointsBudgetConfig,
  totalCostUsd: number,
  now = new Date()
): PointsBalanceSnapshot {
  const dailyBudgetPoints = normalizeDailyBudgetPoints(config.dailyBudgetPoints);
  const pointsUsed = usdToPoints(Math.max(0, totalCostUsd));
  const pointsRemaining = Math.max(0, Math.round((dailyBudgetPoints - pointsUsed) * 1_000_000) / 1_000_000);
  const pctUsed = Math.min(999, Math.round((pointsUsed / Math.max(dailyBudgetPoints, 0.000001)) * 100));
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - POINTS_BUDGET_WINDOW_HOURS * 3600 * 1000).toISOString();

  return {
    dailyBudgetPoints,
    pointsUsed,
    pointsRemaining,
    pctUsed,
    exhausted: pointsRemaining <= 0,
    windowStart,
    windowEnd,
  };
}

async function readLegacyPointsBudget(userId: string): Promise<PointsBudgetConfig | null> {
  try {
    const raw = await fs.readFile(profilePath(userId), "utf-8");
    const profile = JSON.parse(raw) as { pointsBudget?: Partial<PointsBudgetConfig> };
    if (!profile.pointsBudget) return null;
    return {
      dailyBudgetPoints: normalizeDailyBudgetPoints(profile.pointsBudget.dailyBudgetPoints),
    };
  } catch {
    return null;
  }
}

export async function getUserPointsBudget(userId: string): Promise<PointsBudgetConfig> {
  const persisted = await budgetStore.getUserPointsBudget(userId);
  if (persisted) {
    return { dailyBudgetPoints: normalizeDailyBudgetPoints(persisted.dailyBudgetPoints) };
  }

  await ensureUserRecord(userId);
  const legacy = await readLegacyPointsBudget(userId);
  const next = legacy ?? DEFAULT_POINTS_BUDGET;
  await budgetStore.upsertUserPointsBudget(userId, next.dailyBudgetPoints);
  return next;
}

export async function setUserPointsBudget(
  userId: string,
  input: Partial<PointsBudgetConfig>
): Promise<PointsBudgetConfig> {
  await ensureUserRecord(userId);
  const current = await getUserPointsBudget(userId);
  const next = {
    dailyBudgetPoints: normalizeDailyBudgetPoints(
      input.dailyBudgetPoints ?? current.dailyBudgetPoints
    ),
  };

  await budgetStore.upsertUserPointsBudget(userId, next.dailyBudgetPoints);
  return next;
}

export async function getUserPointsBalanceSnapshot(
  userId: string,
  now = new Date()
): Promise<PointsBalanceSnapshot> {
  const config = await getUserPointsBudget(userId);
  const usage = await eventStore.getTokenUsageSummary({
    userId,
    sinceIso: new Date(now.getTime() - POINTS_BUDGET_WINDOW_HOURS * 3600 * 1000).toISOString(),
  });

  // Add any active one-time credits to the effective daily budget.
  let creditPoints = 0;
  try {
    const { getApplicationDataSource, isApplicationDatabaseConfigured } = await import("../db/applicationDataSource.js");
    if (isApplicationDatabaseConfigured()) {
      const ds = await getApplicationDataSource();
      const rows = await ds.query(
        `SELECT COALESCE(SUM(points), 0) AS total
           FROM user_points_credits
          WHERE user_id = $1 AND expires_at > NOW()`,
        [userId]
      ) as Array<{ total: string }>;
      creditPoints = Number(rows[0]?.total ?? 0);
    }
  } catch {
    // Credits are additive; failure to read them is non-fatal.
  }

  const effectiveConfig: PointsBudgetConfig = {
    dailyBudgetPoints: config.dailyBudgetPoints + creditPoints,
  };

  return buildPointsBalanceSnapshot(effectiveConfig, usage.totalCostUsd, now);
}

export async function ensurePointsBudgetAvailable(
  userId: string,
  options: { minRemainingPoints?: number } = {}
): Promise<
  | { allowed: true; balance: PointsBalanceSnapshot }
  | { allowed: false; balance: PointsBalanceSnapshot; reason: string }
> {
  const balance = await getUserPointsBalanceSnapshot(userId);
  const minRemainingPoints = Math.max(0, Number(options.minRemainingPoints ?? 0));
  if (!balance.exhausted && balance.pointsRemaining >= minRemainingPoints) {
    return { allowed: true, balance };
  }
  const reason = balance.exhausted
    ? "Daily points budget exhausted. Try again after the budget window resets or increase the user budget."
    : `Daily points budget is too low to start this request. Remaining: ${balance.pointsRemaining} points; required reserve: ${minRemainingPoints} points.`;
  return {
    allowed: false,
    balance,
    reason,
  };
}
