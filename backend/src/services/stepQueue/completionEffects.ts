import type { DataSource } from "typeorm";
import { buildWorkspace, type UserWorkspace } from "../../middleware/userIsolation.js";
import { StrategySchema } from "../../schemas/index.js";
import { listPortfolioTickers, syncStateToBaselineCoverage } from "../baselineCoverageService.js";
import { logger } from "../logger.js";
import { publishNotification } from "../notificationService.js";
import { resolveConfiguredPath } from "../paths.js";
import { upsertTrackedAsset } from "../trackedAssetService.js";
import { putReportBatch } from "../reportIndexStore.js";
import { promises as fs } from "fs";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const PRODUCT_EFFECTS_VERSION = 4;

interface TerminalJobRow {
  id: string;
  user_id: string;
  action: "full_report" | "deep_dive";
  status: string;
  triggered_at: unknown;
  completed_at: unknown;
  result: Record<string, unknown> | null;
}

interface StrategySnapshot {
  verdict: string;
  confidence: string;
  reasoning: string;
  timeframe: string;
  assetScope: "portfolio" | "tracking" | undefined;
  trackingStatus: "active" | "muted" | "archived" | undefined;
  stance: "candidate" | "watch" | "pass" | "avoid" | null;
  potentialScore: number | null;
  urgencyScore: number | null;
  urgencyLabel: "low" | "medium" | "high" | "extra_high" | null;
  portfolioFitScore: number | null;
  suggestedAllocationPct: number | null;
  suggestedAllocationILS: number | null;
  actionCatalysts: Array<{ description: string; expiresAt: string | null; triggered: boolean }>;
  avoidConditions: string[];
  nextReviewAt: string | null;
}

export interface CompletionEffectsOptions {
  publishNotifications?: boolean;
}

function iso(value: unknown, fallback = new Date()): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

async function readStrategySnapshot(ws: UserWorkspace, ticker: string): Promise<StrategySnapshot | null> {
  try {
    const raw = JSON.parse(await fs.readFile(ws.strategyFile(ticker), "utf-8")) as unknown;
    const parsed = StrategySchema.safeParse(raw);
    if (!parsed.success) return null;
    return {
      verdict: parsed.data.verdict,
      confidence: parsed.data.confidence,
      reasoning: parsed.data.reasoning,
      timeframe: parsed.data.timeframe,
      assetScope: parsed.data.assetScope,
      trackingStatus: parsed.data.trackingStatus,
      stance: parsed.data.stance ?? null,
      potentialScore: parsed.data.potentialScore ?? null,
      urgencyScore: parsed.data.urgencyScore ?? null,
      urgencyLabel: parsed.data.urgencyLabel ?? null,
      portfolioFitScore: parsed.data.portfolioFitScore ?? null,
      suggestedAllocationPct: parsed.data.suggestedAllocationPct ?? null,
      suggestedAllocationILS: parsed.data.suggestedAllocationILS ?? null,
      actionCatalysts: parsed.data.actionCatalysts ?? [],
      avoidConditions: parsed.data.avoidConditions ?? [],
      nextReviewAt: parsed.data.nextReviewAt ?? null,
    };
  } catch {
    return null;
  }
}


async function completedTickers(ds: DataSource, jobId: string): Promise<string[]> {
  const rows = await ds.query(
    `SELECT ticker
       FROM ticker_work_items
      WHERE job_id = $1
        AND status = 'completed'
      ORDER BY position ASC`,
    [jobId]
  ) as Array<{ ticker: string }>;
  return rows.map((row) => row.ticker);
}

async function markProductEffectsApplied(ds: DataSource, jobId: string): Promise<void> {
  await ds.query(
    `UPDATE jobs
        SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
          'productEffectsVersion', $2::int,
          'productEffectsAppliedAt', NOW()
        )
      WHERE id = $1`,
    [jobId, PRODUCT_EFFECTS_VERSION]
  );
}

export async function applyStepQueueCompletionEffects(
  ds: DataSource,
  jobId: string,
  options: CompletionEffectsOptions = {}
): Promise<boolean> {
  const jobs = await ds.query(
    `SELECT id, user_id, action, status, triggered_at, completed_at, result
       FROM jobs
      WHERE id = $1
      LIMIT 1`,
    [jobId]
  ) as TerminalJobRow[];
  const job = jobs[0];
  if (!job) return false;
  if (job.status !== "completed" && job.status !== "partial_completed") return false;
  const appliedVersion = Number(job.result?.["productEffectsVersion"] ?? 0);
  if (Number.isFinite(appliedVersion) && appliedVersion >= PRODUCT_EFFECTS_VERSION) return false;

  const tickers = await completedTickers(ds, job.id);
  if (tickers.length === 0) {
    await markProductEffectsApplied(ds, job.id);
    return true;
  }

  const ws = buildWorkspace(job.user_id, USERS_DIR);
  const completedAt = iso(job.completed_at, new Date());
  const portfolioTickers = new Set(await listPortfolioTickers(ws).catch(() => []));
  const entries: Record<string, Record<string, unknown>> = {};
  for (const ticker of tickers) {
    const strategy = await readStrategySnapshot(ws, ticker);
    if (!strategy) continue;
    const isTrackingDeepDive = job.action === "deep_dive" && !portfolioTickers.has(ticker);
    if (isTrackingDeepDive) {
      await upsertTrackedAsset({
        userId: ws.userId,
        ticker,
        status: strategy.trackingStatus ?? "active",
        createdFromJobId: job.id,
      });
    }
    entries[ticker] = {
      ticker,
      mode: job.action,
      verdict: strategy.verdict,
      confidence: strategy.confidence,
      reasoning: strategy.reasoning,
      timeframe: strategy.timeframe,
      analystTypes: job.action === "deep_dive"
        ? ["fundamentals", "technical", "sentiment", "macro", "risk", "bull", "bear"]
        : ["fundamentals", "technical", "sentiment", "macro", "risk"],
      hasBullCase: job.action === "deep_dive",
      hasBearCase: job.action === "deep_dive",
      assetScope: strategy.assetScope ?? (isTrackingDeepDive ? "tracking" : "portfolio"),
      trackingStatus: isTrackingDeepDive ? strategy.trackingStatus ?? "active" : null,
      stance: strategy.stance ?? null,
      potentialScore: strategy.potentialScore ?? null,
      urgencyScore: strategy.urgencyScore ?? null,
      urgencyLabel: strategy.urgencyLabel ?? null,
      portfolioFitScore: strategy.portfolioFitScore ?? null,
      suggestedAllocationPct: strategy.suggestedAllocationPct ?? null,
      suggestedAllocationILS: strategy.suggestedAllocationILS ?? null,
      actionCatalysts: strategy.actionCatalysts ?? [],
      avoidConditions: strategy.avoidConditions ?? [],
      nextReviewAt: strategy.nextReviewAt ?? null,
    };
  }

  if (Object.keys(entries).length > 0) {
    const batchId = `batch_${job.id}_${job.action}`;
    await putReportBatch({
      batchId,
      userId: ws.userId,
      jobId: job.id,
      mode: job.action,
      triggeredAt: completedAt,
      date: completedAt.slice(0, 10),
      summary: null,
      highlights: null,
      entries: tickers.map((ticker) => ({
        ticker,
        dailySection: null,
        entry: entries[ticker] ?? {},
      })),
    });

    if (options.publishNotifications) {
      await publishNotification({
        userId: ws.userId,
        kind: job.action,
        ...(job.action === "deep_dive"
          ? {
              reasoning: tickers[0]
                ? String(entries[tickers[0]]?.["reasoning"] ?? "Deep dive completed.")
                : "Deep dive completed.",
            }
          : {
              summary: `Refreshed ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}.`,
            }),
        ticker: tickers[0] ?? null,
        batchId,
        actionUrl: `/reports?batch=${encodeURIComponent(batchId)}`,
      });
    }
  }

  await syncStateToBaselineCoverage(ws, {
    lastFullReportAt: job.action === "full_report" ? completedAt : null,
    enqueueBlockingTickers: job.action === "full_report",
  });
  await markProductEffectsApplied(ds, job.id);
  logger.info(`Applied step-queue product effects: job=${job.id} user=${job.user_id} action=${job.action}`);
  return true;
}
