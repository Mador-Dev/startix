import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

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

interface FeedItemRow {
  id: string;
  job_id: string | null;
  kind: string;
  title: string;
  summary: string;
  tone: string;
  tickers: string[];
  highlights: unknown;
  payload: unknown;
  created_at: Date | string;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function rowToFeedItem(row: FeedItemRow): FeedItem {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
  const kind = row.kind as FeedItem["kind"];
  const mode = typeof payload["mode"] === "string" ? payload["mode"] : row.kind;
  const entries = payload["entries"] && typeof payload["entries"] === "object" && !Array.isArray(payload["entries"])
    ? (payload["entries"] as Record<string, StoredBatchEntry>)
    : {};
  const dailyBriefData = payload["dailyBrief"] && typeof payload["dailyBrief"] === "object" && !Array.isArray(payload["dailyBrief"])
    ? (payload["dailyBrief"] as Record<string, unknown>)
    : null;
  return {
    id: row.id,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    kind,
    mode,
    tone: (row.tone as FeedItem["tone"]) ?? "amber",
    compact: mode === "quick_check" || mode === "daily_brief",
    title: row.title,
    summary: row.summary,
    tickers: asStringArray(row.tickers),
    tickerCount: asStringArray(row.tickers).length,
    batchId: row.job_id ?? row.id,
    entries,
    highlights: asStringArray(row.highlights),
    dailyBrief: kind === "daily_brief" && dailyBriefData
      ? {
          headline: typeof dailyBriefData["headline"] === "string" ? dailyBriefData["headline"] : null,
          today: typeof dailyBriefData["today"] === "string" ? dailyBriefData["today"] : null,
          tomorrow: typeof dailyBriefData["tomorrow"] === "string" ? dailyBriefData["tomorrow"] : null,
          marketView: typeof dailyBriefData["marketView"] === "string" ? dailyBriefData["marketView"] : null,
          securityNote: typeof dailyBriefData["securityNote"] === "string" ? dailyBriefData["securityNote"] : null,
          dashboardPath: typeof dailyBriefData["dashboardPath"] === "string" ? dailyBriefData["dashboardPath"] : null,
        }
      : null,
    event: null,
  };
}

async function listFeedItems(userId: string, limit = MAX_STORED_EVENTS): Promise<FeedItem[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT id, job_id, kind, title, summary, tone, tickers, highlights, payload, created_at
       FROM feed_items
      WHERE user_id = $1
        AND kind IN ('daily_brief', 'report', 'deep_dive', 'quick_check')
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  )) as FeedItemRow[];
  return rows.map(rowToFeedItem);
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
  const reportItems = await listFeedItems(userId, MAX_STORED_EVENTS);
  const events = await listFeedEvents(userId, MAX_STORED_EVENTS);

  const allItems = [...reportItems, ...events.map(toEventFeedItem)]
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
