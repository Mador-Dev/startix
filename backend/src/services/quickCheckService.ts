import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job } from "../types/index.js";
import { getPrice, getUsdIlsRate } from "./priceService.js";
import { updateJob } from "./jobService.js";
import { readState, writeState } from "./stateService.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import type { Strategy } from "../schemas/index.js";
import { runQuickCheckAdvisor } from "./advisorLlmService.js";
import { publishNotification } from "./notificationService.js";
import {
  assessStrategyBaselineForTicker,
  type StrategyTrustLevel,
} from "./strategyBaselineService.js";
import { recordEscalation } from "./escalationHistoryStore.js";
import { logger } from "./logger.js";

/**
 * Stable hash of a sorted signal-set used as the (user, ticker, fingerprint)
 * dedupe key in the `escalation_history` table (design §13.1).
 */
function computeSignalSetFingerprint(signals: string[]): string {
  const canonical = JSON.stringify([...signals].sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
import { ensurePointsBudgetAvailable } from "./pointsBudgetService.js";
import { requiresBudgetAdmission } from "./jobAdmissionService.js";
import { admitOrReuseStepQueueJob } from "./stepQueue/admission.js";
import { putReportBatch } from "./reportIndexStore.js";

interface SentimentSnapshot {
  narrativeShift?: string;
  majorNews?: Array<{
    headline?: string;
    sentiment?: string;
    date?: string;
  }>;
  analystActions?: Array<{ action?: string; date?: string }>;
}

export interface QuickCheckOutcome {
  ticker: string;
  timestamp: string;
  baseline_trust: StrategyTrustLevel;
  verdict: Strategy["verdict"];
  confidence: Strategy["confidence"];
  sentiment_score: number | null;
  catalyst_triggered: boolean;
  unexpected_event: boolean;
  needs_escalation: boolean;
  escalation_reason: string | null;
  escalated_to_job_id: string | null;
  used_briefing: boolean;
  score: number;
  signals: string[];
  strategy_health: string[];
  decision: "safe" | "not_safe";
  advisor_summary: string | null;
  advisor_reasons: string[];
  used_llm: boolean;
}

function scoreSentiment(snapshot: SentimentSnapshot | null): number | null {
  if (!snapshot) return null;
  let score = 0;
  if (snapshot.narrativeShift === "deteriorating") score -= 0.5;
  if (snapshot.narrativeShift === "improving") score += 0.5;
  for (const news of snapshot.majorNews ?? []) {
    if (news.sentiment === "negative") score -= 0.2;
    if (news.sentiment === "positive") score += 0.15;
  }
  return Math.max(-1, Math.min(1, Math.round(score * 100) / 100));
}

function isRecent(isoDate: string | undefined, days: number): boolean {
  if (!isoDate) return false;
  const ms = new Date(isoDate).getTime();
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= days * 24 * 60 * 60 * 1000;
}

function parseThresholds(
  conditions: string[],
  direction: "below" | "above"
): number[] {
  const regex =
    direction === "below"
      ? /\b(?:below|breaks below|drops below|closes below)\s*\$?([0-9]+(?:\.[0-9]+)?)/gi
      : /\b(?:above|breaks above|reclaims|closes above)\s*\$?([0-9]+(?:\.[0-9]+)?)/gi;
  const values: number[] = [];
  for (const condition of conditions) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(condition)) !== null) {
      values.push(Number(match[1]));
    }
  }
  return values.filter((v) => Number.isFinite(v));
}

async function loadSentimentSnapshot(
  ws: UserWorkspace,
  ticker: string
): Promise<SentimentSnapshot | null> {
  try {
    const raw = await fs.readFile(path.join(ws.reportsDir, ticker, "sentiment.json"), "utf-8");
    return JSON.parse(raw) as SentimentSnapshot;
  } catch {
    return null;
  }
}

async function writeQuickCheckArtifact(
  ws: UserWorkspace,
  result: QuickCheckOutcome
): Promise<void> {
  const reportDir = path.join(ws.reportsDir, result.ticker);
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(
    path.join(reportDir, "quick_check.json"),
    JSON.stringify(result, null, 2),
    "utf-8"
  );
}

async function appendQuickCheckBatch(
  ws: UserWorkspace,
  job: Job,
  result: QuickCheckOutcome
): Promise<void> {
  const batchId = `batch_${job.id}_quick_check`;
  await putReportBatch({
    batchId,
    userId: ws.userId,
    jobId: job.id,
    mode: "quick_check",
    triggeredAt: result.timestamp,
    date: result.timestamp.slice(0, 10),
    summary: null,
    highlights: null,
    entries: [{
      ticker: result.ticker,
      dailySection: null,
      entry: {
        ticker: result.ticker,
        mode: "quick_check",
        verdict: result.needs_escalation ? "REDUCE" : "HOLD",
        confidence: result.score >= 80 ? "high" : result.score >= 50 ? "medium" : "low",
        reasoning: result.escalation_reason ?? "Quick check completed without escalation",
        timeframe: "immediate",
        analystTypes: ["quick_check"],
        hasBullCase: false,
        hasBearCase: false,
      },
    }],
  });
  await publishNotification({
    userId: ws.userId,
    kind: "quick_check",
    summary: result.escalation_reason ?? "Quick check completed.",
    ticker: result.ticker,
    batchId,
    actionUrl: `/reports?batch=${encodeURIComponent(batchId)}`,
  });
}

// ─── Escalation dedup ────────────────────────────────────────────────────────
//
// Prevents re-triggering deep dives for the exact same set of signals that
// already caused an escalation. A new deep dive will only be queued when:
//   1. No previous escalation exists for this ticker, OR
//   2. The strategy was updated AFTER the last escalation (deep dive addressed
//      the issue; analyst changed something), OR
//   3. At least one NEW signal is present that wasn't in the last escalation.

interface EscalationRecord {
  timestamp: string;
  signals: string[];  // sorted; used as fingerprint
  jobId: string;
}

type EscalationHistory = Record<string, EscalationRecord>;

function escalationHistoryPath(ws: UserWorkspace): string {
  // ws.reportsDir = .../users/[userId]/data/reports
  // parent          = .../users/[userId]/data
  return path.join(path.resolve(ws.reportsDir, ".."), "escalation_history.json");
}

async function readEscalationHistory(ws: UserWorkspace): Promise<EscalationHistory> {
  try {
    const raw = await fs.readFile(escalationHistoryPath(ws), "utf-8");
    return JSON.parse(raw) as EscalationHistory;
  } catch {
    return {};
  }
}

async function writeEscalationHistory(ws: UserWorkspace, history: EscalationHistory): Promise<void> {
  const filePath = escalationHistoryPath(ws);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
}

async function queueDeepDiveIfNeeded(
  ws: UserWorkspace,
  ticker: string,
  signals: string[],
  strategyUpdatedAt: string | null,
): Promise<string | null> {
  // 1. Dedup: check whether these exact signals were already escalated.
  const history = await readEscalationHistory(ws);
  const last = history[ticker];

  if (last) {
    const stratTs = strategyUpdatedAt ? new Date(strategyUpdatedAt).getTime() : 0;
    const lastTs  = new Date(last.timestamp).getTime();

    // If the strategy was updated AFTER the last escalation, the deep dive
    // ran and the analyst touched the strategy — treat as resolved, allow
    // fresh escalation on the same signals.
    const strategyAddressedIt = stratTs > lastTs;

    if (!strategyAddressedIt) {
      // Block re-escalation if every current signal was already present last time.
      const lastSignals = new Set(last.signals);
      const hasNewSignal = signals.some((s) => !lastSignals.has(s));
      if (!hasNewSignal) {
        return null;  // same signals, strategy unchanged → suppress
      }
      // At least one new signal → fall through and escalate.
    }
    // strategyAddressedIt = true → fall through and escalate.
  }

  // 2. Admit or reuse the database-backed deep dive job.
  const budgetGate = await ensurePointsBudgetAvailable(ws.userId);
  if (!budgetGate.allowed) return null;

  const admitted = await admitOrReuseStepQueueJob({
    workspace: ws,
    action: "deep_dive",
    ticker,
    source: "backend_job",
    budgetAdmittedAt: requiresBudgetAdmission({ action: "deep_dive" }) ? new Date() : null,
  });

  // 3. Persist pendingDeepDives in state.
  const state   = await readState(ws.userId);
  const pending = new Set(state.pendingDeepDives ?? []);
  pending.add(ticker);
  await writeState(ws.userId, { pendingDeepDives: Array.from(pending) });

  // 4. Record escalation fingerprint so the next daily brief can dedup.
  const updatedHistory: EscalationHistory = {
    ...history,
    [ticker]: {
      timestamp: new Date().toISOString(),
      signals:   [...signals].sort(),
      jobId:     admitted.jobId,
    },
  };
  await writeEscalationHistory(ws, updatedHistory);

  // Phase 1 dual-write into Postgres. Same signal-set hashes to the same
  // fingerprint so re-escalation suppression works in both the legacy file
  // path and the DB path.
  try {
    await recordEscalation({
      userId: ws.userId,
      ticker,
      signalSetFingerprint: computeSignalSetFingerprint(signals),
      jobId: admitted.jobId,
      signals: [...signals].sort(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`escalation_history_dual_write_failed user=${ws.userId} ticker=${ticker} error=${message}`);
  }

  return admitted.jobId;
}

export async function performQuickCheck(
  ws: UserWorkspace,
  ticker: string,
  options?: { queueDeepDive?: boolean; jobId?: string | null }
): Promise<QuickCheckOutcome> {
  const [{ strategy, issues, isPortfolioTicker, trustLevel }, sentiment, usdIlsRate] = await Promise.all([
    assessStrategyBaselineForTicker(ws, ticker),
    loadSentimentSnapshot(ws, ticker),
    getUsdIlsRate(),
  ]);

  if (!strategy) {
    const invalidSignals = [...issues];
    const escalatedTo =
      options?.queueDeepDive ?? true
        ? await queueDeepDiveIfNeeded(ws, ticker, invalidSignals, null)
        : null;
    const result: QuickCheckOutcome = {
      ticker,
      timestamp: new Date().toISOString(),
      baseline_trust: "invalid",
      verdict: "HOLD",
      confidence: "low",
      sentiment_score: null,
      catalyst_triggered: false,
      unexpected_event: false,
      needs_escalation: true,
      escalation_reason: invalidSignals.join(". "),
      escalated_to_job_id: escalatedTo,
      used_briefing: false,
      score: 0,
      signals: invalidSignals,
      strategy_health: invalidSignals,
      decision: "not_safe",
      advisor_summary: null,
      advisor_reasons: [],
      used_llm: false,
    };

    await writeQuickCheckArtifact(ws, result);
    return result;
  }

  const portfolioMissing = !isPortfolioTicker;
  const signals: string[] = [];
  let score = 100;

  if (trustLevel === "provisional") {
    signals.push("Strategy baseline is provisional");
    score -= 30;
  } else if (trustLevel === "stale") {
    signals.push("Strategy baseline is stale");
    score -= 20;
  }

  const now = Date.now();
  const expiredCatalysts = strategy.catalysts.filter(
    (c: Strategy["catalysts"][number]) =>
      c.expiresAt !== null && !c.triggered && new Date(c.expiresAt).getTime() < now
  );
  if (expiredCatalysts.length > 0) {
    signals.push(`${expiredCatalysts.length} catalyst(s) expired`);
    score -= 45;
  }

  const hasFutureCatalyst = strategy.catalysts.some(
    (c: Strategy["catalysts"][number]) =>
      c.expiresAt !== null && !c.triggered && new Date(c.expiresAt).getTime() >= now
  );
  if (strategy.verdict === "HOLD" && !hasFutureCatalyst) {
    signals.push("HOLD strategy has no future-dated catalyst");
    score -= 35;
  }

  if (strategy.lastDeepDiveAt === null) {
    const metadataSource = strategy.metadata?.source ?? null;
    if (metadataSource !== "full_report") {
      signals.push("No recorded deep dive");
      score -= 25;
    }
  } else if (strategy.confidence === "low" && !isRecent(strategy.lastDeepDiveAt, 30)) {
    signals.push("Low-confidence strategy is stale");
    score -= 20;
  }

  try {
    const { readPortfolio } = await import("./portfolioStore.js");
    const stored = await readPortfolio(ws.userId);
    if (!stored) throw new Error("portfolio not found");
    const positionRaw = JSON.stringify(stored);
    const portfolio = PortfolioFileSchema.parse(JSON.parse(positionRaw));
    const firstPosition = Object.values(portfolio.accounts)
      .flat()
      .find((pos) => pos.ticker === ticker);
    if (firstPosition) {
      const price = await getPrice(ticker, firstPosition.exchange, usdIlsRate);
      const belowThresholds = parseThresholds(strategy.exitConditions ?? [], "below");
      const aboveThresholds = parseThresholds(strategy.entryConditions ?? [], "above");
      const livePrice = price.priceILS;

      if (
        livePrice > 0 &&
        belowThresholds.some((level) => livePrice < level)
      ) {
        signals.push("Live price is below an exit threshold");
        score -= 25;
      }
      if (
        livePrice > 0 &&
        aboveThresholds.some((level) => livePrice > level)
      ) {
        signals.push("Live price crossed an entry threshold");
        score -= 15;
      }
    }
  } catch {}

  const sentimentScore = scoreSentiment(sentiment);
  const recentNegativeNews =
    (sentiment?.majorNews ?? []).filter(
      (item) => item.sentiment === "negative" && isRecent(item.date, 7)
    ).length;
  const unexpectedEvent =
    (sentiment?.narrativeShift === "deteriorating" && recentNegativeNews > 0) ||
    recentNegativeNews >= 2 ||
    (sentiment?.analystActions ?? []).some((action) => isRecent(action.date, 7));

  if (unexpectedEvent) {
    signals.push("Recent sentiment/news flow deteriorated");
    score -= 25;
  }

  if (portfolioMissing) {
    signals.push("Ticker not found in portfolio");
    score -= 10;
  }

  score = Math.max(0, score);
  const sentimentSummary = sentiment
    ? [
        sentiment.narrativeShift ? `narrative=${sentiment.narrativeShift}` : null,
        (sentiment.majorNews ?? [])
          .slice(0, 3)
          .map((item) => `${item.sentiment ?? "unknown"}: ${item.headline ?? "headline unavailable"}`)
          .join(" | "),
      ]
        .filter(Boolean)
        .join(" ; ")
    : "No recent sentiment artifact found.";

  const advisor = await runQuickCheckAdvisor({
    userId: ws.userId,
    jobId: options?.jobId ?? null,
    ticker,
    verdict: strategy.verdict,
    confidence: strategy.confidence,
    reasoning: strategy.reasoning,
    catalysts: strategy.catalysts,
    signals,
    strategyHealth: issues,
    sentimentSummary,
  });

  const llmRequestsEscalation = advisor?.decision === "not_safe";
  const needsEscalation =
    score < 70 || expiredCatalysts.length > 0 || unexpectedEvent || llmRequestsEscalation;
  const escalationReason = needsEscalation
    ? [
        ...signals,
        ...(advisor?.decision === "not_safe" && advisor.summary ? [advisor.summary] : []),
      ].join(". ")
    : null;
  const escalatedTo =
    needsEscalation && (options?.queueDeepDive ?? true)
      ? await queueDeepDiveIfNeeded(ws, ticker, signals, strategy.updatedAt ?? null)
      : null;

  const result: QuickCheckOutcome = {
    ticker,
    timestamp: new Date().toISOString(),
    baseline_trust: trustLevel,
    verdict: strategy.verdict,
    confidence: strategy.confidence,
    sentiment_score: sentimentScore,
    catalyst_triggered: expiredCatalysts.length > 0,
    unexpected_event: unexpectedEvent,
    needs_escalation: needsEscalation,
    escalation_reason: escalationReason,
    escalated_to_job_id: escalatedTo,
    used_briefing: false,
    score,
    signals,
    strategy_health: issues,
    decision: needsEscalation ? "not_safe" : "safe",
    advisor_summary: advisor?.summary ?? null,
    advisor_reasons: advisor?.reasons ?? [],
    used_llm: advisor !== null,
  };

  await writeQuickCheckArtifact(ws, result);
  return result;
}

export async function runQuickCheckJob(
  ws: UserWorkspace,
  ticker: string,
  job: Job
): Promise<Job> {
  const startedAt = new Date().toISOString();
  await updateJob(ws, job.id, {
    status: "running",
    started_at: startedAt,
  });

  try {
    const result = await performQuickCheck(ws, ticker, {
      queueDeepDive: true,
      jobId: job.id,
    });

    const completed = await updateJob(ws, job.id, {
      status: "completed",
      completed_at: result.timestamp,
      result: {
        outcome: result.needs_escalation ? "trigger_escalation" : "no_action",
        score: result.score,
        ticker,
        escalation_reason: result.escalation_reason,
        escalated_to_job_id: result.escalated_to_job_id,
      },
      error: null,
    });

    await appendQuickCheckBatch(ws, completed, result);
    return completed;
  } catch (err) {
    return updateJob(ws, job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message.slice(0, 490) : "Quick check failed",
    });
  }
}
