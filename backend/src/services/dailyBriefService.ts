import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JsonValue } from "../types/index.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import type { Strategy } from "../schemas/strategy.js";
import { getPricesParallel, getUsdIlsRate } from "./priceService.js";
import { performQuickCheck, type QuickCheckOutcome } from "./quickCheckService.js";
import { updateJob } from "./jobService.js";
import { readState, writeState } from "./stateService.js";
import { publishNotification } from "./notificationService.js";
import { listTrackedAssets } from "./trackedAssetService.js";
import { loadUserStrategy } from "./strategyAccess.js";
import { ensurePointsBudgetAvailable } from "./pointsBudgetService.js";
import { requiresBudgetAdmission } from "./jobAdmissionService.js";
import { admitOrReuseStepQueueJob } from "./stepQueue/admission.js";
import { putReportBatch } from "./reportIndexStore.js";

export type DailyBriefTruthState =
  | "calm_trusted"
  | "action_needed"
  | "coverage_incomplete"
  | "confidence_degraded";

export type DailyBriefDeepDiveQueueStatus =
  | "not_needed"
  | "not_selected"
  | "queued"
  | "suppressed";

export type DailyBriefSection = "portfolio" | "tracking";

const DEFAULT_DAILY_BRIEF_SCOPE = {
  includePortfolio: true,
  includeTracking: true,
  trackingAutoDeepDiveLimit: Number(process.env["DAILY_BRIEF_TRACKING_AUTO_DEEP_DIVE_LIMIT"] ?? 1),
} as const;

interface DailyBriefEntry {
  ticker: string;
  currentILS: number;
  dayChangePct?: number;
  quickCheck: QuickCheckOutcome;
}

interface DailyBriefNarrative {
  truthState: DailyBriefTruthState;
  headline: string;
  today: string;
  tomorrow: string;
  marketView: string;
  securityNote: string;
  dashboardPath: string;
}

export interface DailyBriefResult {
  generatedAt: string;
  truthState: DailyBriefTruthState;
  totalChecked: number;
  escalated: number;
  onTrack: number;
  summary: DailyBriefNarrative;
  highlights: string[];
  portfolio: {
    totalChecked: number;
    escalated: number;
    onTrack: number;
    tickers: DailyBriefResult["tickers"];
  };
  tracking: {
    totalChecked: number;
    actionNeeded: number;
    onWatch: number;
    tickers: TrackingDailyEntry[];
  };
  tickers: Array<{
    ticker: string;
    score: number;
    needsEscalation: boolean;
    escalationReason: string | null;
    verdict: string;
    confidence: string;
    currentILS?: number;
    dayChangePct?: number;
    moveReason?: string;
    deepDiveQueued?: boolean;
    deepDiveJobId?: string | null;
    deepDiveQueueStatus?: DailyBriefDeepDiveQueueStatus;
    deepDiveQueueReason?: string | null;
    dailySection?: DailyBriefSection;
  }>;
}

export interface TrackingDailyEntry {
  ticker: string;
  dailySection: "tracking";
  stance: Strategy["stance"] | null;
  potentialScore: number | null;
  urgencyScore: number | null;
  urgencyLabel: Strategy["urgencyLabel"] | null;
  portfolioFitScore: number | null;
  suggestedAllocationPct: number | null;
  suggestedAllocationILS: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  verdict: string;
  confidence: string;
  reasoning: string;
  deepDiveQueued: boolean;
  deepDiveJobId: string | null;
  deepDiveQueueStatus: DailyBriefDeepDiveQueueStatus;
  deepDiveQueueReason: string | null;
}

const DEFAULT_AUTO_DEEP_DIVE_LIMIT = Number(process.env["DAILY_BRIEF_AUTO_DEEP_DIVE_LIMIT"] ?? 1);

interface DailyBriefTruthSummary {
  truthState: DailyBriefTruthState;
  valid: number;
  provisional: number;
  stale: number;
  invalid: number;
  escalated: Array<{ ticker: string; reason: string | null }>;
}

function formatEscalations(items: Array<{ ticker: string; reason: string | null }>, limit = 3): string {
  return items
    .slice(0, limit)
    .map((item) => `${item.ticker}: ${item.reason ?? "needs deeper review now"}`)
    .join(" | ");
}

export function classifyDailyBriefTruth(entries: DailyBriefEntry[]): DailyBriefTruthSummary {
  let valid = 0;
  let provisional = 0;
  let stale = 0;
  let invalid = 0;

  for (const entry of entries) {
    switch (entry.quickCheck.baseline_trust) {
      case "valid":
        valid += 1;
        break;
      case "provisional":
        provisional += 1;
        break;
      case "stale":
        stale += 1;
        break;
      case "invalid":
        invalid += 1;
        break;
    }
  }

  const escalated = entries
    .filter((entry) => entry.quickCheck.needs_escalation)
    .map((entry) => ({
      ticker: entry.ticker,
      reason: entry.quickCheck.escalation_reason,
    }));

  let truthState: DailyBriefTruthState;
  if (invalid > 0 || provisional > 0) {
    truthState = "coverage_incomplete";
  } else if (escalated.length > 0) {
    truthState = "action_needed";
  } else if (stale > 0) {
    truthState = "confidence_degraded";
  } else {
    truthState = "calm_trusted";
  }

  return {
    truthState,
    valid,
    provisional,
    stale,
    invalid,
    escalated,
  };
}

export function buildDailyBriefNarrative(
  result: Omit<DailyBriefResult, "truthState" | "summary" | "highlights">,
  truth: DailyBriefTruthSummary
): DailyBriefNarrative {
  const topEscalations = result.tickers.filter((item) => item.needsEscalation).slice(0, 4);
  const queuedEscalations = result.tickers.filter((item) => item.deepDiveQueued).slice(0, 4);
  const strongest = result.tickers
    .filter((item) => !item.needsEscalation)
    .slice(0, 3)
    .map((item) => item.ticker);

  let headline: string;
  let today: string;
  let tomorrow: string;
  let marketView: string;
  let securityNote: string;

  if (truth.truthState === "coverage_incomplete") {
    const missing = truth.invalid + truth.provisional;
    headline = `Coverage is incomplete today. ${missing} monitored position${missing === 1 ? "" : "s"} still need a trustworthy baseline before the portfolio can be called calm. ${result.tracking.actionNeeded} tracked idea${result.tracking.actionNeeded === 1 ? "" : "s"} need review.`;
    today =
      truth.escalated.length > 0
        ? `Act on the live pressure first: ${formatEscalations(truth.escalated, 2)}. Separate from that, baseline coverage is still incomplete on part of the monitored slice.`
        : `No calm call today: ${missing} monitored position${missing === 1 ? "" : "s"} still have missing or provisional strategy coverage.`;
    tomorrow = `Tomorrow the priority is to complete baseline coverage before leaning on routine calm-vs-action messaging.`;
    marketView = `From your portfolio’s angle, the issue is trust coverage, not just market movement: the system is still missing enough validated baseline context on part of the monitored slice.`;
    securityNote = `You are not being given false reassurance. The brief is withholding a calm verdict until baseline coverage is complete.`;
  } else if (truth.truthState === "action_needed") {
    headline = `${result.escalated} monitored position${result.escalated === 1 ? "" : "s"} need action today while ${truth.valid} ${truth.valid === 1 ? "position remains" : "positions remain"} under trusted coverage. ${result.tracking.actionNeeded} tracked idea${result.tracking.actionNeeded === 1 ? "" : "s"} need review.`;
    today = `Today’s pressure points are ${formatEscalations(truth.escalated)}.`;
    tomorrow =
      queuedEscalations.length > 0
        ? `Tomorrow the focus is the queued deeper review on ${queuedEscalations.map((item) => item.ticker).join(", ")} and confirming whether any thesis updates are needed.`
        : `Tomorrow the focus is monitoring ${topEscalations.map((item) => item.ticker).join(", ")} and manually deciding whether to start deeper reviews.`;
    marketView = `From your portfolio’s angle, risk is concentrated rather than broad: most monitored names are stable, but the flagged positions need immediate follow-through.`;
    securityNote =
      strongest.length > 0
        ? `Trusted coverage remains in place for ${strongest.join(", ")} while the out-of-tolerance names are escalated instead of being smoothed over.`
        : `Trusted coverage is intact on the non-flagged slice, and the out-of-tolerance names are escalated instead of being ignored.`;
  } else if (truth.truthState === "confidence_degraded") {
    headline = `Coverage is running, but confidence is degraded today. ${truth.stale} monitored position${truth.stale === 1 ? "" : "s"} have stale strategy baselines. ${result.tracking.actionNeeded} tracked idea${result.tracking.actionNeeded === 1 ? "" : "s"} need review.`;
    today = `There is no clean calm verdict yet because part of the monitored slice needs a strategy refresh before the brief can speak with full confidence.`;
    tomorrow = `Tomorrow the priority is refreshing the stale baselines so routine monitoring can return to a trustworthy calm-vs-action read.`;
    marketView = `From your portfolio’s angle, the market picture may be fine, but strategy freshness is lagging behind current conditions.`;
    securityNote = `The brief is staying honest: it is not calling the portfolio calm while baseline confidence is degraded.`;
  } else {
    headline = `Portfolio check is calm today. ${result.totalChecked} monitored position${result.totalChecked === 1 ? "" : "s"} are covered by trusted baseline strategy. ${result.tracking.totalChecked} tracked idea${result.tracking.totalChecked === 1 ? "" : "s"} monitored.`;
    today = `Today there are no urgent thesis breaks across the monitored slice. Core holdings are holding their planned posture under trusted coverage.`;
    tomorrow = `Tomorrow the priority is routine monitoring only unless prices, catalysts, or news create a new escalation trigger.`;
    marketView = `From your portfolio’s angle, the current backdrop supports the plan: no concentrated stress is showing up in the monitored holdings and baseline coverage is healthy.`;
    securityNote =
      strongest.length > 0
        ? `You are not flying blind: ${strongest.join(", ")} remain aligned with plan, and the monitored slice is covered by trusted baseline strategy.`
        : `You are not flying blind: the monitored slice remains within plan and backed by trusted baseline coverage.`;
  }

  return {
    truthState: truth.truthState,
    headline,
    today,
    tomorrow,
    marketView,
    securityNote,
    dashboardPath: "/portfolio",
  };
}

export function buildDailyHighlights(
  result: Omit<DailyBriefResult, "truthState" | "summary" | "highlights">,
  truth: DailyBriefTruthSummary
): string[] {
  const highlights: string[] = [];
  if (truth.truthState === "coverage_incomplete") {
    highlights.push("Coverage incomplete");
    highlights.push(`${truth.invalid + truth.provisional}/${result.totalChecked} need baseline trust`);
  } else if (truth.truthState === "confidence_degraded") {
    highlights.push("Confidence degraded");
    highlights.push(`${truth.stale}/${result.totalChecked} baselines are stale`);
  } else if (truth.truthState === "action_needed") {
    highlights.push("Action needed");
    highlights.push(`${result.escalated} escalated for review`);
    const queued = result.tickers.filter((item) => item.deepDiveQueued).length;
    if (queued > 0) {
      highlights.push(`${queued} deep dive${queued === 1 ? "" : "s"} queued`);
    }
  } else {
    highlights.push("Calm with trusted coverage");
    highlights.push(`${result.onTrack}/${result.totalChecked} on track`);
  }

  if (result.escalated > 0) {
    for (const item of result.tickers.filter((entry) => entry.needsEscalation).slice(0, 2)) {
      highlights.push(`${item.ticker} needs attention`);
    }
  } else if (truth.truthState === "calm_trusted") {
    highlights.push("No urgent thesis breaks");
  }
  if (result.tracking.actionNeeded > 0) {
    highlights.push(`${result.tracking.actionNeeded} tracking review${result.tracking.actionNeeded === 1 ? "" : "s"}`);
  }
  return highlights.slice(0, 4);
}

export function selectDailyBriefAutoDeepDiveTickers(
  entries: DailyBriefEntry[],
  limit = DEFAULT_AUTO_DEEP_DIVE_LIMIT
): string[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];

  return entries
    .filter((entry) => entry.quickCheck.needs_escalation)
    .sort((left, right) => {
      if (left.quickCheck.score !== right.quickCheck.score) {
        return left.quickCheck.score - right.quickCheck.score;
      }
      return right.currentILS - left.currentILS;
    })
    .slice(0, limit)
    .map((entry) => entry.ticker);
}

async function queueTrackingDeepDiveIfNeeded(
  ws: UserWorkspace,
  ticker: string
): Promise<string | null> {
  const budgetGate = await ensurePointsBudgetAvailable(ws.userId);
  if (!budgetGate.allowed) return null;

  const admitted = await admitOrReuseStepQueueJob({
    workspace: ws,
    action: "deep_dive",
    ticker,
    source: "backend_job",
    budgetAdmittedAt: requiresBudgetAdmission({ action: "deep_dive" }) ? new Date() : null,
  });
  return admitted.jobId;
}

export function evaluateTrackedStrategyForDaily(strategy: Strategy): {
  needsReview: boolean;
  reviewReason: string | null;
  sortScore: number;
} {
  const reasons: string[] = [];
  const now = Date.now();
  const dueReview =
    strategy.nextReviewAt !== null &&
    strategy.nextReviewAt !== undefined &&
    new Date(strategy.nextReviewAt).getTime() <= now;
  if (dueReview) {
    reasons.push("scheduled review is due");
  }

  const dueCatalyst = (strategy.actionCatalysts ?? []).find((catalyst) => {
    if (catalyst.triggered || catalyst.expiresAt === null) return false;
    const days = Math.ceil((new Date(catalyst.expiresAt).getTime() - now) / 86400000);
    return days <= 7;
  });
  if (dueCatalyst) {
    reasons.push(`action catalyst is due soon: ${dueCatalyst.description}`);
  }

  const urgencyScore = strategy.urgencyScore ?? 0;
  if (urgencyScore >= 70 || strategy.urgencyLabel === "high" || strategy.urgencyLabel === "extra_high") {
    reasons.push(`urgency is ${strategy.urgencyLabel ?? urgencyScore}`);
  }

  if (strategy.stance === "candidate" && (strategy.potentialScore ?? 0) >= 70) {
    reasons.push("candidate score is strong enough to keep on the action list");
  }

  return {
    needsReview: reasons.length > 0,
    reviewReason: reasons.join(". ") || null,
    sortScore: urgencyScore + (strategy.potentialScore ?? 0) + (dueReview ? 25 : 0) + (dueCatalyst ? 25 : 0),
  };
}

export async function evaluateTrackingDailyEntries(
  ws: UserWorkspace,
  autoDeepDiveLimit = DEFAULT_DAILY_BRIEF_SCOPE.trackingAutoDeepDiveLimit
): Promise<TrackingDailyEntry[]> {
  const trackedAssets = (await listTrackedAssets(ws.userId)).filter((asset) => asset.status !== "archived");
  const evaluated: Array<TrackingDailyEntry & { sortScore: number }> = [];

  for (const asset of trackedAssets) {
    const loaded = await loadUserStrategy(ws.userId, ws.strategyFile(asset.ticker), {
      repair: true,
      tickerHint: asset.ticker,
    });
    if (!loaded.valid || !loaded.strategy) continue;
    const strategy = loaded.strategy;
    const evaluation = evaluateTrackedStrategyForDaily(strategy);
    evaluated.push({
      ticker: asset.ticker,
      dailySection: "tracking",
      stance: strategy.stance ?? null,
      potentialScore: strategy.potentialScore ?? null,
      urgencyScore: strategy.urgencyScore ?? null,
      urgencyLabel: strategy.urgencyLabel ?? null,
      portfolioFitScore: strategy.portfolioFitScore ?? null,
      suggestedAllocationPct: strategy.suggestedAllocationPct ?? null,
      suggestedAllocationILS: strategy.suggestedAllocationILS ?? null,
      needsReview: evaluation.needsReview,
      reviewReason: evaluation.reviewReason,
      verdict: strategy.verdict,
      confidence: strategy.confidence,
      reasoning: strategy.reasoning,
      deepDiveQueued: false,
      deepDiveJobId: null,
      deepDiveQueueStatus: evaluation.needsReview ? "not_selected" : "not_needed",
      deepDiveQueueReason: evaluation.needsReview
        ? `Tracked idea needs review; tracking daily auto-queue limit is ${autoDeepDiveLimit}.`
        : null,
      sortScore: evaluation.sortScore,
    });
  }

  evaluated.sort((a, b) => b.sortScore - a.sortScore);
  const selected = new Set(
    evaluated
      .filter((entry) => entry.needsReview)
      .slice(0, Math.max(0, autoDeepDiveLimit))
      .map((entry) => entry.ticker)
  );

  for (const entry of evaluated) {
    if (!selected.has(entry.ticker)) continue;
    const jobId = await queueTrackingDeepDiveIfNeeded(ws, entry.ticker);
    entry.deepDiveQueued = jobId !== null;
    entry.deepDiveJobId = jobId;
    entry.deepDiveQueueStatus = jobId !== null ? "queued" : "suppressed";
    entry.deepDiveQueueReason = jobId !== null
      ? "Tracked idea review deep dive was queued or already active."
      : "Tracked idea review was selected, but no deep dive could be queued.";
  }

  return evaluated.map(({ sortScore: _sortScore, ...entry }) => entry);
}

async function topPortfolioTickers(
  ws: UserWorkspace,
  limit: number
): Promise<Array<{ ticker: string; currentILS: number; dayChangePct: number }>> {
  const { readPortfolio } = await import("./portfolioStore.js");
  const stored = await readPortfolio(ws.userId);
  if (!stored) throw new Error("portfolio not found");
  const raw = JSON.stringify(stored);
  const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
  const usdIlsRate = await getUsdIlsRate();
  const flat = Object.values(portfolio.accounts).flat();
  const unique = Array.from(
    new Map(flat.map((pos) => [`${pos.ticker}:${pos.exchange}`, pos])).values()
  );
  const prices = await getPricesParallel(
    unique.map((pos) => ({ ticker: pos.ticker, exchange: pos.exchange })),
    usdIlsRate
  );

  const totals = new Map<string, { currentILS: number; weightedChange: number }>();
  for (const pos of flat) {
    const price = prices.get(pos.ticker);
    const livePriceILS = price?.priceILS ?? 0;
    const currentILS = livePriceILS * pos.shares;
    const existing = totals.get(pos.ticker) ?? { currentILS: 0, weightedChange: 0 };
    totals.set(pos.ticker, {
      currentILS: existing.currentILS + currentILS,
      weightedChange: existing.weightedChange + currentILS * (price?.dayChangePct ?? 0),
    });
  }

  return Array.from(totals.entries())
    .map(([ticker, value]) => ({
      ticker,
      currentILS: value.currentILS,
      dayChangePct: value.currentILS > 0
        ? Math.round((value.weightedChange / value.currentILS) * 100) / 100
        : 0,
    }))
    .sort((a, b) => b.currentILS - a.currentILS)
    .slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);
}

export async function getDailyBriefCoverageLimit(_ws: UserWorkspace): Promise<number> {
  // N3: removed the fake `pro` plan check. Coverage limit is now admin-configurable
  // via feature_flags.coverage_limit. Default is 10 (matching the legacy `low` plan cap).
  // The `pro` plan concept is removed entirely per requirement N3.
  const { getFeatureValue } = await import("./featureFlagService.js");
  const limit = await getFeatureValue<number>("coverage_limit");
  if (typeof limit === "number" && limit > 0) return limit;
  return Number.POSITIVE_INFINITY; // no limit if flag is not set or is 0
}

async function appendDailyBriefBatch(
  ws: UserWorkspace,
  job: Job,
  result: DailyBriefResult
): Promise<void> {
  const batchId = `batch_${job.id}_daily_brief`;
  const dashboardPath = `/reports?batch=${encodeURIComponent(batchId)}`;

  const portfolioEntries = result.tickers.map((item) => [
    item.ticker,
    {
      ticker: item.ticker,
      mode: "daily_brief",
      dailySection: "portfolio",
      verdict: item.verdict,
      confidence: item.confidence,
      reasoning: item.escalationReason ?? "On track",
      timeframe: "immediate",
      analystTypes: ["quick_check"],
      hasBullCase: false,
      hasBearCase: false,
      currentILS: item.currentILS,
      dayChangePct: item.dayChangePct,
      moveReason: item.moveReason,
      needsEscalation: item.needsEscalation,
      escalationReason: item.escalationReason,
      deepDiveQueued: item.deepDiveQueued ?? false,
      deepDiveJobId: item.deepDiveJobId ?? null,
      deepDiveQueueStatus: item.deepDiveQueueStatus ?? "not_needed",
      deepDiveQueueReason: item.deepDiveQueueReason ?? null,
    },
  ] as const);

  const trackingEntries = result.tracking.tickers.map((item) => [
    item.ticker,
    {
      ticker: item.ticker,
      mode: "daily_brief",
      dailySection: "tracking",
      verdict: item.verdict,
      confidence: item.confidence,
      reasoning: item.reviewReason ?? item.reasoning,
      timeframe: "watch",
      analystTypes: ["tracking"],
      hasBullCase: false,
      hasBearCase: false,
      needsEscalation: item.needsReview,
      escalationReason: item.reviewReason,
      deepDiveQueued: item.deepDiveQueued,
      deepDiveJobId: item.deepDiveJobId,
      deepDiveQueueStatus: item.deepDiveQueueStatus,
      deepDiveQueueReason: item.deepDiveQueueReason,
      assetScope: "tracking",
      trackingStatus: "active",
      stance: item.stance,
      potentialScore: item.potentialScore,
      urgencyScore: item.urgencyScore,
      urgencyLabel: item.urgencyLabel,
      portfolioFitScore: item.portfolioFitScore,
      suggestedAllocationPct: item.suggestedAllocationPct,
      suggestedAllocationILS: item.suggestedAllocationILS,
    },
  ] as const);

  const allEntries = Object.fromEntries([...portfolioEntries, ...trackingEntries]);
  const allTickers = [...result.tickers.map((t) => t.ticker), ...result.tracking.tickers.map((t) => t.ticker)];

  await putReportBatch({
    batchId,
    userId: ws.userId,
    jobId: job.id,
    mode: "daily_brief",
    triggeredAt: result.generatedAt,
    date: result.generatedAt.slice(0, 10),
    summary: {
      truthState: result.summary.truthState,
      headline: result.summary.headline,
      today: result.summary.today,
      tomorrow: result.summary.tomorrow,
      marketView: result.summary.marketView,
      securityNote: result.summary.securityNote,
      dashboardPath,
    },
    highlights: result.highlights as unknown as Record<string, unknown>,
    entries: allTickers.map((ticker) => ({
      ticker,
      dailySection: (allEntries[ticker] as { dailySection?: string } | undefined)?.dailySection ?? null,
      entry: allEntries[ticker] as Record<string, unknown>,
    })),
  });

  const escalatedTickers = result.tickers
    .filter((item) => item.needsEscalation)
    .slice(0, 4)
    .map((item) => item.ticker);

  await publishNotification({
    userId: ws.userId,
    kind: "daily_brief",
    headline: result.summary.headline,
    summary: escalatedTickers.length > 0 ? result.summary.today : result.summary.securityNote,
    ticker: result.tickers[0]?.ticker ?? null,
    batchId,
    actionUrl: dashboardPath,
  });
}

export async function runDailyBriefJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  const startedAt = new Date().toISOString();
  await updateJob(ws, job.id, {
    status: "running",
    started_at: startedAt,
  });

  try {
    const state = await readState(ws.userId);
    if (state.state !== "ACTIVE") {
      throw new Error("Portfolio is not active for daily briefs");
    }

    const coverageLimit = await getDailyBriefCoverageLimit(ws);
    const topTickers = DEFAULT_DAILY_BRIEF_SCOPE.includePortfolio
      ? await topPortfolioTickers(ws, coverageLimit)
      : [];
    const entries: DailyBriefEntry[] = [];
    for (const item of topTickers) {
      const quickCheck = await performQuickCheck(ws, item.ticker, { queueDeepDive: false });
      entries.push({
        ticker: item.ticker,
        currentILS: item.currentILS,
        dayChangePct: item.dayChangePct,
        quickCheck,
      });
    }

    const autoQueueTickers = new Set(selectDailyBriefAutoDeepDiveTickers(entries));
    for (const entry of entries) {
      if (!autoQueueTickers.has(entry.ticker)) continue;
      entry.quickCheck = await performQuickCheck(ws, entry.ticker, { queueDeepDive: true });
    }

    const trackingEntries = DEFAULT_DAILY_BRIEF_SCOPE.includeTracking
      ? await evaluateTrackingDailyEntries(ws)
      : [];
    const portfolioTickers = entries
      .sort((a, b) => b.currentILS - a.currentILS)
      .map((entry) => ({
        ticker: entry.ticker,
        score: entry.quickCheck.score,
        needsEscalation: entry.quickCheck.needs_escalation,
        escalationReason: entry.quickCheck.escalation_reason,
        verdict: entry.quickCheck.verdict,
        confidence: entry.quickCheck.confidence,
        currentILS: Math.round(entry.currentILS * 100) / 100,
        dayChangePct: entry.dayChangePct ?? 0,
        moveReason:
          Math.abs(entry.dayChangePct ?? 0) >= 1
            ? `Price moved ${(entry.dayChangePct ?? 0) > 0 ? "+" : ""}${entry.dayChangePct ?? 0}% today; no external catalyst attribution is attached yet.`
            : "Price movement was small; no external catalyst attribution is attached yet.",
        deepDiveQueued: entry.quickCheck.escalated_to_job_id !== null,
        deepDiveJobId: entry.quickCheck.escalated_to_job_id,
        deepDiveQueueStatus: !entry.quickCheck.needs_escalation
          ? "not_needed" as const
          : entry.quickCheck.escalated_to_job_id !== null
            ? "queued" as const
            : autoQueueTickers.has(entry.ticker)
              ? "suppressed" as const
              : "not_selected" as const,
        deepDiveQueueReason: !entry.quickCheck.needs_escalation
          ? null
          : entry.quickCheck.escalated_to_job_id !== null
            ? "Deep dive was queued or already active for this ticker."
            : autoQueueTickers.has(entry.ticker)
              ? "Auto-queue selected this ticker, but a matching escalation was already active or previously recorded."
              : `Flagged for attention but not auto-queued; daily auto-queue limit is ${DEFAULT_AUTO_DEEP_DIVE_LIMIT}.`,
        dailySection: "portfolio" as const,
      }));
    const baseResult = {
      generatedAt: new Date().toISOString(),
      totalChecked: entries.length,
      escalated: entries.filter((entry) => entry.quickCheck.needs_escalation).length,
      onTrack: entries.filter((entry) => !entry.quickCheck.needs_escalation).length,
      portfolio: {
        totalChecked: entries.length,
        escalated: entries.filter((entry) => entry.quickCheck.needs_escalation).length,
        onTrack: entries.filter((entry) => !entry.quickCheck.needs_escalation).length,
        tickers: portfolioTickers,
      },
      tracking: {
        totalChecked: trackingEntries.length,
        actionNeeded: trackingEntries.filter((entry) => entry.needsReview).length,
        onWatch: trackingEntries.filter((entry) => !entry.needsReview).length,
        tickers: trackingEntries,
      },
      tickers: portfolioTickers,
    };
    const truth = classifyDailyBriefTruth(entries);
    const result: DailyBriefResult = {
      ...baseResult,
      truthState: truth.truthState,
      summary: buildDailyBriefNarrative(baseResult, truth),
      highlights: buildDailyHighlights(baseResult, truth),
    };

    const completed = await updateJob(ws, job.id, {
      status: "completed",
      completed_at: result.generatedAt,
      result: result as unknown as JsonValue,
      error: null,
    });

    await appendDailyBriefBatch(ws, completed, result);
    await writeState(ws.userId, { lastDailyAt: result.generatedAt });
    return completed;
  } catch (err) {
    return updateJob(ws, job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message.slice(0, 490) : "Daily brief failed",
    });
  }
}
