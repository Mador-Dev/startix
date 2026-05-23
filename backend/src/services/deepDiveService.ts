import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JsonValue, Verdict, Confidence } from "../types/index.js";
import { validateReportFile, validateStrategyFile } from "./validationService.js";
import { readState, writeState } from "./stateService.js";
import { updateJob } from "./jobService.js";
import { logger } from "./logger.js";
import { publishNotification } from "./notificationService.js";
import { eventStore } from "./eventStore.js";
import { syncStateToBaselineCoverage } from "./baselineCoverageService.js";
import { putReportBatch } from "./reportIndexStore.js";

export const DEEP_DIVE_STEPS = [
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
  {
    key: "bull_case",
    label: "Bull Researcher",
    filename: "bull_case.json",
    analyst: "bull",
  },
  {
    key: "bear_case",
    label: "Bear Researcher",
    filename: "bear_case.json",
    analyst: "bear",
  },
] as const;

type DeepDiveStepDefinition = (typeof DEEP_DIVE_STEPS)[number];
export type DeepDiveStepKey = DeepDiveStepDefinition["key"];

export interface DeepDiveStepState {
  key: DeepDiveStepKey;
  label: string;
  filename: string;
  status: "pending" | "running" | "completed" | "failed";
  completedAt: string | null;
  detail: string | null;
}

export interface DeepDiveState {
  version: 1;
  ticker: string;
  jobId: string;
  status: "pending" | "paused" | "running" | "completed" | "failed" | "cancelled";
  triggeredAt: string;
  startedAt: string;
  dispatchedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  completedSteps: number;
  totalSteps: number;
  currentStep: string | null;
  strategyReady: boolean;
  lastProgressAt: string | null;
  failureReason?: string | null;
  steps: DeepDiveStepState[];
}

interface StepScanResult {
  steps: DeepDiveStepState[];
  completedSteps: number;
  totalSteps: number;
  nextStep: string | null;
  strategyReady: boolean;
  strategyUpdatedAt: string | null;
  lastProgressAt: string | null;
}

interface StrategySnapshot {
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;
  timeframe: string;
}

interface CompletionEvidence {
  strategy: StrategySnapshot | null;
  strategyUpdatedAt: string | null;
}

function deepDiveStatePath(ws: UserWorkspace, ticker: string): string {
  return path.join(ws.reportsDir, ticker, "deep_dive_state.json");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function appendDeepDiveBatch(
  ws: UserWorkspace,
  job: Job,
  ticker: string,
  strategy: StrategySnapshot
): Promise<void> {
  const batchId = `batch_${job.id}_deep_dive`;
  const triggeredAt = job.completed_at ?? job.triggered_at;
  await putReportBatch({
    batchId,
    userId: ws.userId,
    jobId: job.id,
    mode: "deep_dive",
    triggeredAt,
    date: triggeredAt.slice(0, 10),
    summary: null,
    highlights: null,
    entries: [{
      ticker,
      dailySection: null,
      entry: {
        ticker,
        mode: "deep_dive",
        verdict: strategy.verdict,
        confidence: strategy.confidence,
        reasoning: strategy.reasoning,
        timeframe: strategy.timeframe,
        analystTypes: ["fundamentals", "technical", "sentiment", "macro", "risk", "bull", "bear"],
        hasBullCase: true,
        hasBearCase: true,
      },
    }],
  });
  await publishNotification({
    userId: ws.userId,
    kind: "deep_dive",
    reasoning: strategy.reasoning,
    ticker,
    batchId,
    actionUrl: `/reports?batch=${encodeURIComponent(batchId)}`,
  });
}

async function scanDeepDiveArtifacts(
  ws: UserWorkspace,
  ticker: string,
  triggeredAt: string
): Promise<StepScanResult> {
  const reportDir = path.join(ws.reportsDir, ticker);
  const cutoff = new Date(triggeredAt).getTime();
  const steps = await Promise.all(
    DEEP_DIVE_STEPS.map(async (definition): Promise<DeepDiveStepState> => {
      const filePath = path.join(reportDir, definition.filename);
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          return {
            key: definition.key,
            label: definition.label,
            filename: definition.filename,
            status: "pending",
            completedAt: null,
            detail: "artifact predates current job",
          };
        }

        const validation = await validateReportFile(filePath, definition.analyst);
        if (!validation.valid) {
          return {
            key: definition.key,
            label: definition.label,
            filename: definition.filename,
            status: "pending",
            completedAt: null,
            detail: validation.errors?.[0] ?? "artifact failed validation",
          };
        }

        return {
          key: definition.key,
          label: definition.label,
          filename: definition.filename,
          status: "completed",
          completedAt: stat.mtime.toISOString(),
          detail: null,
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            key: definition.key,
            label: definition.label,
            filename: definition.filename,
            status: "pending",
            completedAt: null,
            detail: null,
          };
        }
        throw err;
      }
    })
  );

  const strategyPath = ws.strategyFile(ticker);
  let strategyReady = false;
  let strategyUpdatedAt: string | null = null;
  try {
    const stat = await fs.stat(strategyPath);
    strategyUpdatedAt = stat.mtime.toISOString();
    if (stat.mtimeMs >= cutoff) {
      const validation = await validateStrategyFile(ws.userId, strategyPath, ticker);
      strategyReady = validation.valid;
    }
  } catch {}

  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const nextStep = steps.find((step) => step.status !== "completed")?.label ?? null;
  const lastProgressAt = [strategyUpdatedAt, ...steps.map((step) => step.completedAt)]
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1) ?? null;
  return {
    steps,
    completedSteps,
    totalSteps: DEEP_DIVE_STEPS.length,
    nextStep,
    strategyReady,
    strategyUpdatedAt,
    lastProgressAt,
  };
}

function deriveDeepDiveStatus(job: Job, scan: StepScanResult): DeepDiveState["status"] {
  if (scan.completedSteps === scan.totalSteps && scan.strategyReady) {
    return "completed";
  }
  if (job.status === "cancelled") {
    return "cancelled";
  }
  if (job.status === "paused") {
    return "paused";
  }
  if (job.status === "failed") {
    return "failed";
  }
  if (job.status === "running" && job.started_at) {
    return "running";
  }
  return "pending";
}

function decorateStepsForStatus(
  steps: DeepDiveStepState[],
  status: DeepDiveState["status"]
): DeepDiveStepState[] {
  let markedActive = false;
  return steps.map((step) => {
    if (step.status === "completed") {
      return step;
    }
    if (markedActive) {
      return step;
    }
    if (status === "running") {
      markedActive = true;
      return { ...step, status: "running" };
    }
    if (status === "failed") {
      markedActive = true;
      return { ...step, status: "failed" };
    }
    return step;
  });
}

async function buildDeepDiveState(ws: UserWorkspace, job: Job): Promise<DeepDiveState> {
  const scan = await scanDeepDiveArtifacts(ws, job.ticker!, job.triggered_at);
  const status = deriveDeepDiveStatus(job, scan);
  const completedAt =
    status === "completed"
      ? scan.strategyUpdatedAt ?? new Date().toISOString()
      : status === "failed" || status === "cancelled"
      ? job.completed_at ?? new Date().toISOString()
      : null;

  return {
    version: 1,
    ticker: job.ticker!,
    jobId: job.id,
    status,
    triggeredAt: job.triggered_at,
    startedAt: job.started_at ?? new Date().toISOString(),
    dispatchedAt: job.started_at ?? null,
    updatedAt: new Date().toISOString(),
    completedAt,
    completedSteps: scan.completedSteps,
    totalSteps: scan.totalSteps,
    currentStep: status === "completed" ? null : scan.nextStep,
    strategyReady: scan.strategyReady,
    lastProgressAt: scan.lastProgressAt,
    failureReason:
      status === "failed" || status === "cancelled" || status === "paused"
        ? job.error ?? null
        : null,
    steps: decorateStepsForStatus(scan.steps, status),
  };
}

async function writeDeepDiveState(
  ws: UserWorkspace,
  ticker: string,
  state: DeepDiveState
): Promise<void> {
  const statePath = deepDiveStatePath(ws, ticker);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

async function readStrategySnapshot(
  ws: UserWorkspace,
  ticker: string
): Promise<StrategySnapshot | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(ws.strategyFile(ticker));
  if (!raw) return null;
  const verdict = raw["verdict"];
  const confidence = raw["confidence"];
  const reasoning = raw["reasoning"];
  const timeframe = raw["timeframe"];
  if (
    typeof verdict !== "string" ||
    typeof confidence !== "string" ||
    typeof reasoning !== "string" ||
    typeof timeframe !== "string"
  ) {
    return null;
  }
  return {
    verdict: verdict as Verdict,
    confidence: confidence as Confidence,
    reasoning,
    timeframe,
  };
}

async function readCompletionEvidence(
  ws: UserWorkspace,
  ticker: string,
  triggeredAt: string
): Promise<CompletionEvidence> {
  const strategyPath = ws.strategyFile(ticker);
  try {
    const stat = await fs.stat(strategyPath);
    if (stat.mtimeMs < new Date(triggeredAt).getTime()) {
      return { strategy: null, strategyUpdatedAt: stat.mtime.toISOString() };
    }
    const strategy = await readStrategySnapshot(ws, ticker);
    if (!strategy) {
      return { strategy: null, strategyUpdatedAt: stat.mtime.toISOString() };
    }
    const validation = await validateStrategyFile(ws.userId, strategyPath, ticker);
    if (!validation.valid) {
      return { strategy: null, strategyUpdatedAt: stat.mtime.toISOString() };
    }
    return {
      strategy,
      strategyUpdatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { strategy: null, strategyUpdatedAt: null };
  }
}

async function syncPendingDeepDiveState(
  ws: UserWorkspace,
  ticker: string,
  done: boolean
): Promise<void> {
  const state = await readState(ws.userId);
  const pending = new Set(state.pendingDeepDives ?? []);
  if (done) {
    pending.delete(ticker);
  } else {
    pending.add(ticker);
  }
  await writeState(ws.userId, { pendingDeepDives: Array.from(pending) });
}

export async function initializeDeepDiveJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  if (job.action !== "deep_dive" || !job.ticker) {
    return job;
  }

  if (job.status === "completed") {
    const existingState = await readJsonIfExists<DeepDiveState>(deepDiveStatePath(ws, job.ticker));
    if (existingState?.jobId === job.id && existingState.status === "completed") {
      return job;
    }
  }

  const state = await buildDeepDiveState(ws, job);

  await writeDeepDiveState(ws, job.ticker, state);
  await syncPendingDeepDiveState(ws, job.ticker, state.status === "completed");

  if (job.status === "pending") {
    job = await updateJob(ws, job.id, {
      status: state.status === "completed" ? "completed" : "pending",
      started_at: state.status === "completed" ? state.startedAt : null,
      completed_at: state.completedAt,
      result:
        state.status === "completed"
          ? ({
              ticker: job.ticker,
              completedSteps: state.completedSteps,
              totalSteps: state.totalSteps,
              strategyReady: state.strategyReady,
            } as JsonValue)
          : job.result,
      error: null,
    });
  }

  return state.status === "completed" ? reconcileDeepDiveJob(ws, job) : job;
}

export async function getDeepDiveJobProgress(
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
  if (job.action !== "deep_dive" || !job.ticker) return null;

  const state = await readJsonIfExists<DeepDiveState>(deepDiveStatePath(ws, job.ticker));
  if (!state || state.jobId !== job.id) {
    const scan = await scanDeepDiveArtifacts(ws, job.ticker, job.triggered_at);
    const pct = Math.round((scan.completedSteps / scan.totalSteps) * 100);
    return {
      pct,
      currentTicker: job.ticker,
      currentStep: scan.nextStep,
      completedTickers: scan.completedSteps === scan.totalSteps ? [job.ticker] : [],
      remainingTickers: scan.completedSteps === scan.totalSteps ? [] : [job.ticker],
      totalTickers: 1,
      completedSteps: scan.completedSteps,
      totalSteps: scan.totalSteps,
    };
  }

  const pct = Math.round((state.completedSteps / state.totalSteps) * 100);
  return {
    pct,
    currentTicker: job.ticker,
    currentStep: state.currentStep,
    completedTickers: state.status === "completed" ? [job.ticker] : [],
    remainingTickers: state.status === "completed" ? [] : [job.ticker],
    totalTickers: 1,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
  };
}

export async function reconcileDeepDiveJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  if (job.action !== "deep_dive" || !job.ticker) {
    return job;
  }

  if (job.status === "completed") {
    const existingState = await readJsonIfExists<DeepDiveState>(deepDiveStatePath(ws, job.ticker));
    if (existingState?.jobId === job.id && existingState.status === "completed") {
      return job;
    }
  }

  const state = await buildDeepDiveState(ws, job);

  if (job.status === "completed" && state.status !== "completed") {
    const completion = await readCompletionEvidence(ws, job.ticker, job.triggered_at);
    if (completion.strategy) {
      const completedAt = job.completed_at ?? completion.strategyUpdatedAt ?? new Date().toISOString();
      const completedState: DeepDiveState = {
        ...state,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        completedSteps: state.totalSteps,
        currentStep: null,
        strategyReady: true,
        lastProgressAt: completion.strategyUpdatedAt ?? state.lastProgressAt,
        failureReason: null,
      };
      await writeDeepDiveState(ws, job.ticker, completedState);
      await syncPendingDeepDiveState(ws, job.ticker, true);
      try {
        await syncStateToBaselineCoverage(ws);
      } catch (err) {
        logger.warn(`Deep dive terminal repair baseline sync failed for ${ws.userId}/${job.ticker}: ${String(err)}`);
      }
      await appendDeepDiveBatch(
        ws,
        {
          ...job,
          status: "completed",
          started_at: job.started_at ?? completedState.startedAt,
          completed_at: completedAt,
        },
        job.ticker,
        completion.strategy
      );
      return updateJob(ws, job.id, {
        status: "completed",
        started_at: job.started_at ?? completedState.startedAt,
        completed_at: completedAt,
        result:
          typeof job.result === "object" && job.result !== null
            ? job.result
            : {
                ticker: job.ticker,
                completedSteps: completedState.completedSteps,
                totalSteps: completedState.totalSteps,
                strategyReady: true,
                verdict: completion.strategy.verdict,
                confidence: completion.strategy.confidence,
              },
        error: null,
      });
    }
  }

  await writeDeepDiveState(ws, job.ticker, state);

  if (state.status !== "completed") {
    await syncPendingDeepDiveState(ws, job.ticker, false);
    if (job.status === "pending" && state.status === "running") {
      return updateJob(ws, job.id, {
        status: "running",
        started_at: state.startedAt,
        error: null,
      });
    }
    if (job.status !== state.status && state.status === "pending") {
      return updateJob(ws, job.id, {
        status: "pending",
        started_at: null,
        completed_at: null,
        error: null,
      });
    }
    return job;
  }

  const strategy = await readStrategySnapshot(ws, job.ticker);
  if (!strategy) {
    logger.warn(`Deep dive completion missing strategy snapshot for ${job.ticker}`);
    return job;
  }

  const completedJob = await updateJob(ws, job.id, {
    status: "completed",
    started_at: state.startedAt,
    completed_at: state.completedAt,
    result: {
      ticker: job.ticker,
      completedSteps: state.completedSteps,
      totalSteps: state.totalSteps,
      strategyReady: true,
      verdict: strategy.verdict,
      confidence: strategy.confidence,
    },
    error: null,
  });

  await syncPendingDeepDiveState(ws, job.ticker, true);
  try {
    await syncStateToBaselineCoverage(ws);
  } catch (err) {
    logger.warn(`Deep dive completed but baseline state sync failed for ${ws.userId}/${job.ticker}: ${String(err)}`);
  }
  await appendDeepDiveBatch(ws, completedJob, job.ticker, strategy);
  return completedJob;
}

export async function markDeepDiveJobFailed(
  ws: UserWorkspace,
  job: Job,
  reason: string,
  completedAt = new Date().toISOString()
): Promise<Job> {
  if (job.action !== "deep_dive" || !job.ticker) {
    return updateJob(ws, job.id, {
      status: "failed",
      completed_at: completedAt,
      error: reason.slice(0, 490),
    });
  }

  const existingState = await readJsonIfExists<DeepDiveState>(deepDiveStatePath(ws, job.ticker));
  if (existingState && existingState.jobId === job.id) {
    await writeDeepDiveState(ws, job.ticker, {
      ...existingState,
      status: "failed",
      steps: decorateStepsForStatus(existingState.steps, "failed"),
      updatedAt: completedAt,
      completedAt,
      lastProgressAt: existingState.lastProgressAt,
      failureReason: reason,
    });
  }

  await syncPendingDeepDiveState(ws, job.ticker, true);

  return updateJob(ws, job.id, {
    status: "failed",
    completed_at: completedAt,
    error: reason.slice(0, 490),
  });
}

export async function markDeepDiveJobCancelled(
  ws: UserWorkspace,
  job: Job,
  reason: string,
  completedAt = new Date().toISOString()
): Promise<Job> {
  if (job.action !== "deep_dive" || !job.ticker) {
    return updateJob(ws, job.id, {
      status: "cancelled",
      completed_at: completedAt,
      error: reason.slice(0, 490),
    });
  }

  const existingState = await readJsonIfExists<DeepDiveState>(deepDiveStatePath(ws, job.ticker));
  if (existingState && existingState.jobId === job.id) {
    await writeDeepDiveState(ws, job.ticker, {
      ...existingState,
      status: "cancelled",
      updatedAt: completedAt,
      completedAt,
      failureReason: reason,
    });
  }

  await syncPendingDeepDiveState(ws, job.ticker, true);

  return updateJob(ws, job.id, {
    status: "cancelled",
    completed_at: completedAt,
    error: reason.slice(0, 490),
  });
}

export async function markDeepDiveJobPaused(
  ws: UserWorkspace,
  job: Job,
  reason: string
): Promise<Job> {
  if (job.action !== "deep_dive" || !job.ticker) {
    return updateJob(ws, job.id, {
      status: "paused",
      error: reason.slice(0, 490),
    });
  }

  const state = await buildDeepDiveState(ws, {
    ...job,
    status: "paused",
    error: reason,
  });
  await writeDeepDiveState(ws, job.ticker, state);
  await syncPendingDeepDiveState(ws, job.ticker, false);

  return updateJob(ws, job.id, {
    status: "paused",
    error: reason.slice(0, 490),
  });
}

export async function detectDeepDiveExecutionFailureSignal(
  userId: string,
  job: Job
): Promise<string | null> {
  if (job.action !== "deep_dive" || !job.ticker || job.status !== "running" || !job.started_at) {
    return null;
  }

  const rejection = await eventStore.getLatestJobRejection({
    userId,
    jobId: job.id,
    sinceIso: job.started_at,
  });
  if (rejection?.rejectionReason === "points_budget_exhausted") {
    return "Deep dive paused because the daily points budget was exhausted";
  }
  if (rejection?.rejectionReason === "rate_limit") {
    return "Failed before any deep-dive artifact was written — rate_limit";
  }
  return null;
}

export async function reconcileFailedDeepDiveJob(
  ws: UserWorkspace,
  job: Job
): Promise<void> {
  if (job.action !== "deep_dive" || !job.ticker || job.status !== "failed") {
    return;
  }

  const existingState = await readJsonIfExists<DeepDiveState>(deepDiveStatePath(ws, job.ticker));
  if (existingState && existingState.jobId === job.id && existingState.status !== "completed") {
    await writeDeepDiveState(ws, job.ticker, {
      ...existingState,
      status: "failed",
      updatedAt: job.completed_at ?? new Date().toISOString(),
      completedAt: job.completed_at ?? existingState.completedAt ?? new Date().toISOString(),
      failureReason: job.error ?? existingState.failureReason ?? "Deep dive failed",
    });
  }

  await syncPendingDeepDiveState(ws, job.ticker, true);
}
