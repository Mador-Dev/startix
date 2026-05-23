import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JsonValue, Confidence, Verdict } from "../types/index.js";
import { validateStrategyFile } from "./validationService.js";
import { updateJob } from "./jobService.js";
import { publishNotification } from "./notificationService.js";
import {
  isBaselineTrustCovered,
  listPortfolioTickers,
  summarizeBaselineCoverage,
  syncStateToBaselineCoverage,
} from "./baselineCoverageService.js";
import { buildStrategyMetadata, type StrategyTrustLevel } from "./strategyBaselineService.js";
import type { Strategy } from "../schemas/index.js";
import { StrategySchema } from "../schemas/index.js";
import { dualWriteStrategy } from "./strategyExportService.js";
import { readReportArtifact } from "./reportArtifactStore.js";
import { readWorkspaceJson, writeWorkspaceJson } from "./workspaceDataIO.js";
import { putReportBatch } from "./reportIndexStore.js";

const FULL_REPORT_STEPS = [
  {
    key: "fundamentals",
    label: "Fundamentals",
    filename: "fundamentals.json",
    analyst: "fundamentals",
  },
  {
    key: "technical",
    label: "Technical Analysis",
    filename: "technical.json",
    analyst: "technical",
  },
  {
    key: "sentiment",
    label: "Sentiment",
    filename: "sentiment.json",
    analyst: "sentiment",
  },
  {
    key: "macro",
    label: "Macro",
    filename: "macro.json",
    analyst: "macro",
  },
  {
    key: "risk",
    label: "Portfolio Risk",
    filename: "risk.json",
    analyst: "risk",
  },
] as const;

interface FullReportTickerState {
  ticker: string;
  status: "pending" | "completed" | "failed";
  completedSteps: number;
  totalSteps: number;
  currentStep: string | null;
  strategyReady: boolean;
  baselineTrust: StrategyTrustLevel;
  failureReason?: string | null;
}

interface FullReportState {
  version: 1;
  jobId: string;
  status: "running" | "completed" | "failed";
  triggeredAt: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalTickers: number;
  completedTickers: string[];
  failedTickers: string[];
  remainingTickers: string[];
  currentTicker: string | null;
  currentStep: string | null;
  completedSteps: number;
  totalSteps: number;
  failureReason?: string | null;
  tickers: FullReportTickerState[];
}

interface StrategySnapshot {
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;
  timeframe: string;
}

function statePath(ws: UserWorkspace): string {
  return path.join(ws.reportsDir, "full_report_state.json");
}

async function readJsonIfExists<T>(userId: string, filePath: string): Promise<T | null> {
  const fromDb = await readWorkspaceJson(userId, filePath);
  if (fromDb !== null) return fromDb as T;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function scanTicker(
  ws: UserWorkspace,
  ticker: string,
  triggeredAt: string
): Promise<{
  ticker: string;
  completedSteps: number;
  currentStep: string | null;
  strategyReady: boolean;
  strategyInvalidTerminal: boolean;
  failureReason: string | null;
}> {
  const cutoff = new Date(triggeredAt).getTime();
  let completedSteps = 0;
  let currentStep: string | null = null;

  for (const step of FULL_REPORT_STEPS) {
    const artifact = await readReportArtifact(ws.userId, ticker, step.key).catch(() => null);
    if (!artifact) {
      currentStep = step.label;
      break;
    }
    completedSteps += 1;
  }

  let strategyReady = false;
  let strategyInvalidTerminal = false;
  let failureReason: string | null = null;
  try {
    const stat = await fs.stat(ws.strategyFile(ticker));
    if (stat.mtimeMs >= cutoff) {
      const validation = await validateStrategyFile(ws.userId, ws.strategyFile(ticker), ticker);
      strategyReady = validation.valid;
      if (!validation.valid && completedSteps === FULL_REPORT_STEPS.length) {
        strategyInvalidTerminal = true;
        failureReason = validation.errors?.join(". ") || "Strategy validation failed after analyst completion";
      }
    }
  } catch {}

  return {
    ticker,
    completedSteps,
    currentStep,
    strategyReady,
    strategyInvalidTerminal,
    failureReason,
  };
}

function buildValidatedFullReportStrategy(strategy: Strategy): Strategy {
  const generatedAt = strategy.metadata?.generatedAt ?? strategy.updatedAt;
  return StrategySchema.parse({
    ...strategy,
    updatedAt: new Date().toISOString(),
    deepDiveTriggeredBy: strategy.deepDiveTriggeredBy ?? "full_report",
    metadata: buildStrategyMetadata(
      "full_report",
      "validated",
      generatedAt,
      strategy.metadata?.userGuidanceApplied ?? false
    ),
  });
}

async function promoteFullReportStrategy(
  ws: UserWorkspace,
  ticker: string
): Promise<{ promoted: boolean; strategy: Strategy | null; error: string | null }> {
  const validation = await validateStrategyFile(ws.userId, ws.strategyFile(ticker), ticker);
  if (!validation.valid || !validation.data) {
    return {
      promoted: false,
      strategy: null,
      error: validation.errors?.join(". ") || "Strategy validation failed",
    };
  }

  try {
    const promoted = buildValidatedFullReportStrategy(validation.data as Strategy);
    await fs.writeFile(ws.strategyFile(ticker), JSON.stringify(promoted, null, 2), "utf-8");

    // Phase 1 dual-write: mirror promotion into the strategies table.
    await dualWriteStrategy(promoted, ws.userId);

    return {
      promoted: true,
      strategy: promoted,
      error: null,
    };
  } catch (error) {
    return {
      promoted: false,
      strategy: null,
      error: error instanceof Error ? error.message : "Failed to promote full-report strategy",
    };
  }
}

async function buildState(
  ws: UserWorkspace,
  job: Job,
  tickers: string[]
): Promise<FullReportState> {
  const startedAt = job.started_at ?? new Date().toISOString();
  const [artifactStates, baselineCoverage] = await Promise.all([
    Promise.all(tickers.map((ticker) => scanTicker(ws, ticker, job.triggered_at))),
    summarizeBaselineCoverage(ws, tickers),
  ]);
  const baselineByTicker = new Map(
    baselineCoverage.tickers.map((item) => [item.ticker, item])
  );
  const tickerStates: FullReportTickerState[] = artifactStates.map((artifactState) => {
    const baseline = baselineByTicker.get(artifactState.ticker);
    const baselineTrust = baseline?.trustLevel ?? "invalid";
    const baselineCovered = isBaselineTrustCovered(baselineTrust);
    const strategyComplete = artifactState.completedSteps === FULL_REPORT_STEPS.length;
    const failed = artifactState.strategyInvalidTerminal;
    const currentStep =
      failed
        ? null
        : artifactState.currentStep ??
          (artifactState.strategyReady
            ? baselineCovered
              ? null
              : "Baseline validation"
            : "Strategy validation");
    const completedSteps =
      strategyComplete && baselineCovered
        ? FULL_REPORT_STEPS.length + 1
        : artifactState.completedSteps;
    const totalSteps = FULL_REPORT_STEPS.length + 1;
    const status = failed ? "failed" : strategyComplete && baselineCovered ? "completed" : "pending";
    return {
      ticker: artifactState.ticker,
      status,
      completedSteps,
      totalSteps,
      currentStep: status === "completed" ? null : currentStep,
      strategyReady: artifactState.strategyReady,
      baselineTrust,
      failureReason: failed ? artifactState.failureReason : null,
    };
  });
  const completedTickers = tickerStates
    .filter((ticker) => ticker.status === "completed")
    .map((ticker) => ticker.ticker);
  const failedTickers = tickerStates
    .filter((ticker) => ticker.status === "failed")
    .map((ticker) => ticker.ticker);
  const remainingTickers = tickerStates
    .filter((ticker) => ticker.status === "pending")
    .map((ticker) => ticker.ticker);
  const activeTicker = tickerStates.find((ticker) => ticker.status === "pending") ?? null;
  const completedAt =
    remainingTickers.length === 0 ? new Date().toISOString() : null;
  const status =
    remainingTickers.length > 0
      ? "running"
      : completedTickers.length > 0
        ? "completed"
        : "failed";
  const failureReason =
    status === "failed" && failedTickers.length > 0
      ? `All tickers failed validation or baseline promotion (${failedTickers.join(", ")})`
      : null;

  return {
    version: 1,
    jobId: job.id,
    status,
    triggeredAt: job.triggered_at,
    startedAt,
    updatedAt: new Date().toISOString(),
    completedAt,
    totalTickers: tickers.length,
    completedTickers,
    failedTickers,
    remainingTickers,
    currentTicker: activeTicker?.ticker ?? null,
    currentStep: activeTicker?.currentStep ?? null,
    completedSteps: tickerStates.reduce((sum, ticker) => sum + ticker.completedSteps, 0),
    totalSteps: tickerStates.reduce((sum, ticker) => sum + ticker.totalSteps, 0),
    failureReason,
    tickers: tickerStates,
  };
}

async function writeFullReportState(ws: UserWorkspace, state: FullReportState): Promise<void> {
  await writeWorkspaceJson(ws.userId, statePath(ws), state);
}

async function writeLegacyProgressFile(
  ws: UserWorkspace,
  state: FullReportState
): Promise<void> {
  const progressPath = path.join(ws.reportsDir, "progress.json");
  if (state.status === "completed") {
    try {
      await fs.unlink(progressPath);
    } catch {}
    return;
  }

  await writeWorkspaceJson(ws.userId, progressPath, {
    startedAt: state.startedAt,
    totalTickers: state.totalTickers,
    completed: state.completedTickers,
    failed: state.failedTickers,
    remaining: state.remainingTickers,
  });
}

async function readStrategySnapshot(
  ws: UserWorkspace,
  ticker: string
): Promise<StrategySnapshot | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(ws.userId, ws.strategyFile(ticker));
  if (!raw) return null;
  if (
    typeof raw["verdict"] !== "string" ||
    typeof raw["confidence"] !== "string" ||
    typeof raw["reasoning"] !== "string" ||
    typeof raw["timeframe"] !== "string"
  ) {
    return null;
  }
  return {
    verdict: raw["verdict"] as Verdict,
    confidence: raw["confidence"] as Confidence,
    reasoning: raw["reasoning"] as string,
    timeframe: raw["timeframe"] as string,
  };
}

async function appendFullReportBatch(
  ws: UserWorkspace,
  job: Job,
  tickers: string[]
): Promise<void> {
  const batchId = `batch_${job.id}_full_report`;
  const triggeredAt = job.completed_at ?? job.triggered_at;

  const entriesWithStrategies = await Promise.all(
    tickers.map(async (ticker) => ({ ticker, strategy: await readStrategySnapshot(ws, ticker) }))
  );

  await putReportBatch({
    batchId,
    userId: ws.userId,
    jobId: job.id,
    mode: "full_report",
    triggeredAt,
    date: triggeredAt.slice(0, 10),
    summary: null,
    highlights: null,
    entries: entriesWithStrategies
      .filter((e) => e.strategy !== null)
      .map(({ ticker, strategy }) => ({
        ticker,
        dailySection: null,
        entry: {
          ticker,
          mode: "full_report",
          verdict: strategy!.verdict,
          confidence: strategy!.confidence,
          reasoning: strategy!.reasoning,
          timeframe: strategy!.timeframe,
          analystTypes: ["fundamentals", "technical", "sentiment", "macro", "risk"],
          hasBullCase: false,
          hasBearCase: false,
        },
      })),
  });

  await publishNotification({
    userId: ws.userId,
    kind: "full_report",
    summary: `Refreshed ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}.`,
    ticker: tickers[0] ?? null,
    batchId,
    actionUrl: `/reports?batch=${encodeURIComponent(batchId)}`,
  });
}

async function updateBootstrapState(
  ws: UserWorkspace,
  state: FullReportState
): Promise<void> {
  await syncStateToBaselineCoverage(ws, {
    lastFullReportAt: state.status === "completed" ? state.completedAt : null,
    enqueueBlockingTickers: state.status === "completed" || state.status === "failed",
  });
}

export async function initializeFullReportJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  if (job.action !== "full_report") return job;

  const tickers = await listPortfolioTickers(ws);
  for (const ticker of tickers) {
    await promoteFullReportStrategy(ws, ticker);
  }
  const state = await buildState(ws, job, tickers);
  await writeFullReportState(ws, state);
  await writeLegacyProgressFile(ws, state);
  await updateBootstrapState(ws, state);

  const nextJob = await updateJob(ws, job.id, {
    status: state.status === "completed" ? "completed" : state.status === "failed" ? "failed" : "pending",
    started_at: state.status === "completed" || state.status === "failed" ? state.startedAt : null,
    completed_at: state.completedAt,
    result:
      state.status === "completed" || state.status === "failed"
        ? ({
            totalTickers: state.totalTickers,
            completedTickers: state.completedTickers.length,
            failedTickers: state.failedTickers.length,
          } as JsonValue)
        : job.result,
    error: state.status === "failed" ? state.failureReason ?? "Full report failed" : null,
  });

  if (state.status === "completed") {
    await appendFullReportBatch(ws, nextJob, state.completedTickers);
  }
  return nextJob;
}

export async function reconcileFullReportJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  if (job.action !== "full_report") return job;

  if (job.status === "completed") {
    const existingState = await readJsonIfExists<FullReportState>(ws.userId, statePath(ws));
    if (existingState?.jobId === job.id && existingState.status === "completed") {
      return job;
    }
  }

  const tickers = await listPortfolioTickers(ws);
  for (const ticker of tickers) {
    await promoteFullReportStrategy(ws, ticker);
  }
  const state = await buildState(ws, job, tickers);
  await writeFullReportState(ws, state);
  await writeLegacyProgressFile(ws, state);
  await updateBootstrapState(ws, state);

  if (state.status === "running") {
    if (job.status === "pending") {
      return updateJob(ws, job.id, {
        status: "running",
        started_at: state.startedAt,
        error: null,
      });
    }
    return job;
  }

  const terminalStatus = state.status === "completed" ? "completed" : "failed";
  const completed = await updateJob(ws, job.id, {
    status: terminalStatus,
    started_at: state.startedAt,
    completed_at: state.completedAt,
    result: {
      totalTickers: state.totalTickers,
      completedTickers: state.completedTickers.length,
      failedTickers: state.failedTickers.length,
    },
    error: state.status === "failed" ? state.failureReason ?? "Full report failed" : null,
  });
  if (state.completedTickers.length > 0) {
    await appendFullReportBatch(ws, completed, state.completedTickers);
  }
  return completed;
}

export async function reconcileFailedFullReportJob(
  ws: UserWorkspace,
  job: Job
): Promise<void> {
  if (job.action !== "full_report" || job.status !== "failed") {
    return;
  }

  const existingState = await readJsonIfExists<FullReportState>(ws.userId, statePath(ws));
  if (existingState && existingState.jobId === job.id && existingState.status !== "completed") {
    const completedAt = job.completed_at ?? existingState.completedAt ?? new Date().toISOString();
    await writeFullReportState(ws, {
      ...existingState,
      status: "failed",
      updatedAt: completedAt,
      completedAt,
      failureReason: job.error ?? existingState.failureReason ?? "Full report failed",
    });
  }

  try {
    await fs.unlink(path.join(ws.reportsDir, "progress.json"));
  } catch {
    // progress file may already be gone
  }
}

export async function getFullReportJobProgress(
  ws: UserWorkspace,
  job: Job
): Promise<{
  pct: number;
  currentTicker: string | null;
  currentStep: string | null;
  completedTickers: string[];
  remainingTickers: string[];
  totalTickers: number;
  completedSteps: number;
  totalSteps: number;
} | null> {
  if (job.action !== "full_report") return null;
  const state = await readJsonIfExists<FullReportState>(ws.userId, statePath(ws));
  if (!state || state.jobId !== job.id) return null;

  const pct =
    state.totalSteps > 0
      ? Math.min(Math.round((state.completedSteps / state.totalSteps) * 100), state.status === "completed" ? 100 : 99)
      : 0;

  return {
    pct,
    currentTicker: state.currentTicker,
    currentStep: state.currentStep,
    completedTickers: state.completedTickers,
    remainingTickers: state.remainingTickers,
    totalTickers: state.totalTickers,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
  };
}
