import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { listBatchesWithEntries, type BatchWithEntries } from "./reportIndexStore.js";

const MAX_STORED_EVENTS = 250;
export const FEED_PAGE_SIZE = 15;

export interface StoredBatchEntry {
  ticker: string;
  mode: string;
  verdict: string;
  confidence: string;
  reasoning: string;
  timeframe: string;
  analystTypes: string[];
  hasBullCase: boolean;
  hasBearCase: boolean;
  currentILS?: number;
  dayChangePct?: number;
  moveReason?: string;
  needsEscalation?: boolean;
  escalationReason?: string | null;
  deepDiveQueued?: boolean;
  deepDiveJobId?: string | null;
  deepDiveQueueStatus?: "not_needed" | "not_selected" | "queued" | "suppressed";
  deepDiveQueueReason?: string | null;
  assetScope?: "portfolio" | "tracking";
  trackingStatus?: "active" | "muted" | "archived" | null;
  stance?: "candidate" | "watch" | "pass" | "avoid" | null;
  potentialScore?: number | null;
  urgencyScore?: number | null;
  urgencyLabel?: "low" | "medium" | "high" | "extra_high" | null;
  portfolioFitScore?: number | null;
  suggestedAllocationPct?: number | null;
  suggestedAllocationILS?: number | null;
  actionCatalysts?: Array<{ description: string; expiresAt: string | null; triggered: boolean }>;
  avoidConditions?: string[];
  nextReviewAt?: string | null;
}

export interface StoredBatch {
  batchId: string;
  triggeredAt: string;
  date: string;
  mode: string;
  tickers: string[];
  tickerCount: number;
  jobId: string | null;
  entries: Record<string, StoredBatchEntry>;
  summary?: {
    headline?: string;
    today?: string;
    tomorrow?: string;
    marketView?: string;
    securityNote?: string;
    dashboardPath?: string;
  };
  highlights?: string[];
}

export interface FeedEventRecord {
  id: string;
  kind: "market_news";
  createdAt: string;
  ticker: string;
  title: string;
  summary: string;
  source: string;
  url: string | null;
}

export interface FeedItem {
  id: string;
  createdAt: string;
  kind: "report" | "daily_brief" | "market_news";
  mode: string;
  tone: "emerald" | "amber" | "rose" | "sky" | "slate";
  compact: boolean;
  title: string;
  summary: string;
  tickers: string[];
  tickerCount: number;
  batchId: string | null;
  entries: Record<string, StoredBatchEntry>;
  highlights: string[];
  dailyBrief:
    | {
        headline: string | null;
        today: string | null;
        tomorrow: string | null;
        marketView: string | null;
        securityNote: string | null;
        dashboardPath: string | null;
      }
    | null;
  event:
    | {
        ticker: string;
        source: string;
        url: string | null;
      }
    | null;
}

export interface FeedQuery {
  pageNum: number;
  mode?: string | null;
  search?: string | null;
}

function toneForMode(mode: string): FeedItem["tone"] {
  switch (mode) {
    case "daily_brief":
      return "sky";
    case "deep_dive":
      return "rose";
    case "full_report":
      return "emerald";
    case "new_ideas":
      return "amber";
    default:
      return "amber";
  }
}

function determineReportTone(batch: StoredBatch): FeedItem["tone"] {
  const entries = Object.values(batch.entries);
  const hasNegative = entries.some((entry) => ["REDUCE", "SELL", "CLOSE"].includes(entry.verdict));
  const hasPositive = entries.some((entry) => ["BUY", "ADD"].includes(entry.verdict));

  if (batch.mode === "quick_check") {
    return hasNegative ? "rose" : "emerald";
  }
  if (batch.mode === "daily_brief") {
    return hasNegative ? "rose" : "sky";
  }
  if (batch.mode === "deep_dive" || batch.mode === "full_report") {
    if (hasNegative) return "rose";
    if (hasPositive) return "emerald";
    return "amber";
  }
  if (batch.mode === "new_ideas") {
    return "amber";
  }
  return toneForMode(batch.mode);
}

function summarizeBatch(batch: StoredBatch): string {
  const primaryTicker = batch.tickers[0] ?? null;
  const primaryEntry = primaryTicker ? batch.entries?.[primaryTicker] : null;

  switch (batch.mode) {
    case "quick_check":
      return primaryEntry?.reasoning ?? `Quick check completed for ${primaryTicker ?? "position"}.`;
    case "daily_brief": {
      if (batch.summary?.headline) return batch.summary.headline;
      const escalated = Object.values(batch.entries).filter((entry) =>
        ["REDUCE", "SELL", "CLOSE"].includes(entry.verdict)
      ).length;
      if (escalated > 0) {
        return `${escalated} position${escalated === 1 ? "" : "s"} need closer attention.`;
      }
      return `Daily brief completed across ${batch.tickerCount} position${batch.tickerCount === 1 ? "" : "s"}.`;
    }
    case "deep_dive":
      return primaryEntry?.reasoning ?? `Deep dive refreshed for ${primaryTicker ?? "ticker"}.`;
    case "full_report":
      return `Full report refreshed across ${batch.tickerCount} ticker${batch.tickerCount === 1 ? "" : "s"}.`;
    case "new_ideas":
      return primaryEntry?.reasoning ?? `Generated ${batch.tickerCount} new idea${batch.tickerCount === 1 ? "" : "s"}.`;
    default:
      return `Generated ${batch.mode.replace(/_/g, " ")}.`;
  }
}

function buildHighlights(batch: StoredBatch): string[] {
  if (batch.highlights?.length) return batch.highlights.slice(0, 4);
  if (batch.mode === "daily_brief") {
    const escalated = Object.values(batch.entries)
      .filter((entry) => ["REDUCE", "SELL", "CLOSE"].includes(entry.verdict))
      .map((entry) => `${entry.ticker} needs follow-up`);
    return escalated.slice(0, 3);
  }

  return Object.values(batch.entries)
    .slice(0, 3)
    .map((entry) => `${entry.ticker} · ${entry.verdict} · ${entry.confidence}`);
}

function titleForBatch(batch: StoredBatch): string {
  switch (batch.mode) {
    case "quick_check":
      return `${batch.tickers[0] ?? "Position"} quick check`;
    case "daily_brief":
      return "Daily brief";
    case "deep_dive":
      return `${batch.tickers[0] ?? "Ticker"} deep dive`;
    case "full_report":
      return "Full report";
    case "new_ideas":
      return "New ideas";
    default:
      return batch.mode.replace(/_/g, " ");
  }
}

export function buildReportFeedItems(batches: StoredBatch[]): FeedItem[] {
  return batches.map((batch) => ({
    id: batch.batchId,
    createdAt: batch.triggeredAt,
    kind: batch.mode === "daily_brief" ? "daily_brief" : "report",
    mode: batch.mode,
    tone: determineReportTone(batch),
    compact: batch.mode === "quick_check" || batch.mode === "daily_brief",
    title: titleForBatch(batch),
    summary: summarizeBatch(batch),
    tickers: batch.tickers,
    tickerCount: batch.tickerCount,
    batchId: batch.batchId,
    entries: batch.entries,
    highlights: buildHighlights(batch),
    dailyBrief: batch.mode === "daily_brief"
      ? {
          headline: batch.summary?.headline ?? null,
          today: batch.summary?.today ?? null,
          tomorrow: batch.summary?.tomorrow ?? null,
          marketView: batch.summary?.marketView ?? null,
          securityNote: batch.summary?.securityNote ?? null,
          dashboardPath: batch.summary?.dashboardPath ?? null,
        }
      : null,
    event: null,
  }));
}

export async function listFeedEvents(userId: string, limit = 100): Promise<FeedEventRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  interface Row { id: string; kind: string; ticker: string; title: string; summary: string; source: string; url: string | null; created_at: Date | string }
  const rows = (await ds.query(
    `SELECT id, kind, ticker, title, summary, source, url, created_at
       FROM feed_events WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  )) as Row[];
  return rows.map((r) => ({
    id: r.id,
    kind: "market_news" as const,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
    ticker: r.ticker,
    title: r.title,
    summary: r.summary,
    source: r.source,
    url: r.url,
  }));
}

export async function appendFeedEvent(
  userId: string,
  event: Omit<FeedEventRecord, "id" | "createdAt">
): Promise<FeedEventRecord> {
  const id = `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  if (isApplicationDatabaseConfigured()) {
    const ds = await getApplicationDataSource();
    interface Row { id: string; created_at: Date | string }
    const rows = (await ds.query(
      `INSERT INTO feed_events (id, user_id, kind, ticker, title, summary, source, url)
         VALUES ($1, $2, 'market_news', $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
      [id, userId, event.ticker, event.title, event.summary, event.source, event.url ?? null]
    )) as Row[];
    const row = rows[0]!;
    const record: FeedEventRecord = {
      id: row.id,
      kind: "market_news",
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      ticker: event.ticker,
      title: event.title,
      summary: event.summary,
      source: event.source,
      url: event.url,
    };
    const { publishNotification } = await import("./notificationService.js");
    await publishNotification({
      userId,
      kind: "market_news",
      headline: event.title,
      summary: event.summary,
      ticker: event.ticker,
      batchId: null,
      actionUrl: event.url,
    }).catch(() => undefined);
    return record;
  }

  const record: FeedEventRecord = {
    ...event,
    id,
    kind: "market_news",
    createdAt: new Date().toISOString(),
  };
  return record;
}

function batchWithEntriesToStoredBatch(b: BatchWithEntries): StoredBatch {
  const summaryRaw = b.summary as Record<string, unknown> | null;
  const batch: StoredBatch = {
    batchId: b.batchId,
    triggeredAt: b.triggeredAt,
    date: b.date,
    mode: b.mode,
    tickers: b.tickers,
    tickerCount: b.tickerCount,
    jobId: b.jobId,
    entries: b.entries as unknown as Record<string, StoredBatchEntry>,
  };
  if (summaryRaw) batch.summary = summaryRaw as NonNullable<StoredBatch["summary"]>;
  if (Array.isArray(b.highlights)) batch.highlights = b.highlights as string[];
  return batch;
}

function toEventFeedItem(event: FeedEventRecord): FeedItem {
  return {
    id: event.id,
    createdAt: event.createdAt,
    kind: "market_news",
    mode: "market_news",
    tone: "slate",
    compact: true,
    title: event.title,
    summary: event.summary,
    tickers: [event.ticker],
    tickerCount: 1,
    batchId: null,
    entries: {},
    highlights: [event.ticker, event.source],
    dailyBrief: null,
    event: {
      ticker: event.ticker,
      source: event.source,
      url: event.url,
    },
  };
}

function matchesFeedItem(item: FeedItem, mode: string | null | undefined, search: string | null | undefined): boolean {
  if (mode && mode !== "all") {
    const normalizedMode = mode.toLowerCase();
    if (normalizedMode === "events" && item.kind !== "market_news") return false;
    if (normalizedMode === "reports" && item.kind === "market_news") return false;
    if (normalizedMode !== "events" && normalizedMode !== "reports" && item.mode !== normalizedMode) return false;
  }

  if (!search?.trim()) return true;

  const haystack = [
    item.title,
    item.summary,
    item.mode,
    item.tickers.join(" "),
    ...item.highlights,
    ...Object.values(item.entries).map(
      (entry) => `${entry.ticker} ${entry.reasoning} ${entry.verdict} ${entry.confidence} ${entry.timeframe}`
    ),
  ]
    .join(" ")
    .toLowerCase();

  // Tokenised: every whitespace-separated word must appear somewhere in the haystack.
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

export async function readFeedPage(
  userId: string,
  query: FeedQuery,
): Promise<{
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  appliedMode: string | null;
  appliedSearch: string | null;
  items: FeedItem[];
}> {
  const [rawBatches, events] = await Promise.all([
    listBatchesWithEntries(userId, MAX_STORED_EVENTS),
    listFeedEvents(userId, MAX_STORED_EVENTS),
  ]);
  const batches = rawBatches.map(batchWithEntriesToStoredBatch);

  const allItems = [...events.map(toEventFeedItem), ...buildReportFeedItems(batches)]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter((item) => matchesFeedItem(item, query.mode, query.search));

  const totalItems = allItems.length;
  // When a search query is active, return all matching items on one page so the
  // client can show complete results without requiring the user to paginate.
  const effectivePageSize = query.search?.trim() ? Math.max(totalItems, 1) : FEED_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safePage = Math.min(Math.max(query.pageNum, 1), totalPages);
  const start = (safePage - 1) * effectivePageSize;

  return {
    page: safePage,
    totalPages,
    totalItems,
    pageSize: effectivePageSize,
    appliedMode: query.mode ?? null,
    appliedSearch: query.search ?? null,
    items: allItems.slice(start, start + effectivePageSize),
  };
}
