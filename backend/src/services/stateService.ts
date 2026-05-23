import { PortfolioFileSchema } from "../schemas/portfolio.js";
import type { PortfolioState, PortfolioStateData } from "../types/index.js";
import { readUserState, writeUserState } from "./userStore.js";
import { readPortfolio } from "./portfolioStore.js";
import { listStrategies } from "./strategyStore.js";

export class StateTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: PortfolioState,
    public readonly to: PortfolioState
  ) {
    super(message);
    this.name = "StateTransitionError";
  }
}

export async function readState(userId: string): Promise<PortfolioStateData> {
  return readUserState(userId);
}

export async function writeState(
  userId: string,
  update: Partial<PortfolioStateData>
): Promise<void> {
  await writeUserState(userId, update);
}

export interface ActiveUserEligibility {
  eligible: boolean;
  reason: string | null;
}

export async function getActiveUserEligibility(userId: string): Promise<ActiveUserEligibility> {
  const current = await readState(userId);
  if (current.state !== "ACTIVE") {
    return {
      eligible: false,
      reason: `state is ${current.state.toLowerCase()}`,
    };
  }

  const portfolio = await readPortfolio(userId);
  if (!portfolio) {
    return { eligible: false, reason: "portfolio missing" };
  }

  const portfolioResult = PortfolioFileSchema.safeParse(portfolio);
  if (!portfolioResult.success) {
    return { eligible: false, reason: "portfolio invalid" };
  }

  const positionCount = Object.values(portfolioResult.data.accounts).flat().length;
  if (positionCount === 0) {
    return { eligible: false, reason: "portfolio empty" };
  }

  return { eligible: true, reason: null };
}

export async function repairActiveUserState(userId: string): Promise<boolean> {
  const current = await readState(userId);
  if (current.state !== "ACTIVE") return false;

  const updates: Partial<PortfolioStateData> = {};
  let changed = false;

  if (current.bootstrapProgress !== null) {
    updates.bootstrapProgress = null;
    changed = true;
  }

  const eligibility = await getActiveUserEligibility(userId);
  if (!eligibility.eligible) {
    updates.state = "INCOMPLETE";
    changed = true;
  }

  if (changed) {
    await writeState(userId, updates);
    const repairReasons: string[] = [];
    if (current.bootstrapProgress !== null) {
      repairReasons.push("cleared stale bootstrap-only fields");
    }
    if (!eligibility.eligible) {
      repairReasons.push(`downgraded ACTIVE user to INCOMPLETE because ${eligibility.reason}`);
    }
    const { logger } = await import("./logger.js");
    logger.info(`Repaired active-user state for ${userId}: ${repairReasons.join("; ")}`);
  }

  return changed;
}

const LEGAL_TRANSITIONS: Record<PortfolioState, PortfolioState[]> = {
  INCOMPLETE: ["BOOTSTRAPPING", "BLOCKED"],
  BOOTSTRAPPING: ["ACTIVE", "INCOMPLETE", "BLOCKED"],
  ACTIVE: ["BOOTSTRAPPING", "INCOMPLETE", "BLOCKED"],
  BLOCKED: [],
};

export async function transitionState(
  userId: string,
  to: PortfolioState,
  reason: string
): Promise<void> {
  const current = await readState(userId);
  const from = current.state;

  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new StateTransitionError(
      `Illegal state transition from ${from} to ${to}`,
      from,
      to
    );
  }

  const { logger } = await import("./logger.js");
  logger.info(`State transition: ${from} → ${to} | reason=${reason}`);
  await writeState(userId, { state: to });
}

export interface ConditionCheckResult {
  userId: string;
  checkedAt: string;
  expiredCatalysts: Array<{ ticker: string; catalyst: string; expiredAt: string }>;
  pendingDeepDives: string[];
  summary: string;
}

export async function checkDailyConditions(userId: string): Promise<ConditionCheckResult> {
  const expiredCatalysts: ConditionCheckResult["expiredCatalysts"] = [];
  const pendingDeepDives: string[] = [];

  const strategies = await listStrategies(userId).catch(() => []);
  const now = new Date();

  for (const strategy of strategies) {
    const catalysts = strategy.catalysts ?? [];
    for (const catalyst of catalysts) {
      const expiresAt = catalyst.expiresAt;
      if (expiresAt && new Date(expiresAt) < now) {
        expiredCatalysts.push({
          ticker: strategy.ticker,
          catalyst: catalyst.description,
          expiredAt: expiresAt,
        });
      }
    }

    if (strategy.verdict === "HOLD") {
      const hasExpiring = catalysts.some(
        (c) => c.expiresAt !== null && new Date(c.expiresAt) > now
      );
      if (!hasExpiring) pendingDeepDives.push(strategy.ticker);
    }
  }

  const summary =
    expiredCatalysts.length === 0 && pendingDeepDives.length === 0
      ? "All clear — no expired catalysts, no HOLD without catalyst"
      : `${expiredCatalysts.length} expired catalyst(s), ${pendingDeepDives.length} HOLD without catalyst`;

  return {
    userId,
    checkedAt: now.toISOString(),
    expiredCatalysts,
    pendingDeepDives,
    summary,
  };
}

