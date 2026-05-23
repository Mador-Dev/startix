import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

/**
 * Report index store — replaces `data/reports/index/meta.json` and
 * `data/reports/index/page-NNN.json` (A2.1, A2.2; design §4.3).
 *
 * Two related tables:
 *   • report_batches — one row per (job, run) with summary + highlights
 *   • report_index   — one row per (batch, ticker) with the per-ticker entry
 *
 * Writes are wrapped in a transaction so a partial insert cannot leave the
 * batch row without its index entries.
 */

export interface ReportBatchRecord {
  batchId: string;
  userId: string;
  jobId: string;
  mode: string;
  triggeredAt: string;
  date: string;
  tickerCount: number;
  summary: Record<string, unknown> | null;
  highlights: Record<string, unknown> | null;
  createdAt: string;
}

export interface ReportIndexRecord {
  batchId: string;
  ticker: string;
  dailySection: string | null;
  entry: Record<string, unknown>;
}

export interface PutReportBatchInput {
  batchId: string;
  userId: string;
  jobId: string;
  mode: string;
  triggeredAt: string;
  /** ISO date (YYYY-MM-DD); defaults to the date portion of triggeredAt. */
  date?: string;
  summary?: Record<string, unknown> | null;
  highlights?: Record<string, unknown> | null;
  /** Per-ticker entries. Order is preserved when listed back out. */
  entries: Array<{ ticker: string; dailySection?: string | null; entry: Record<string, unknown> }>;
}

interface BatchRow {
  batch_id: string;
  user_id: string;
  job_id: string;
  mode: string;
  triggered_at: Date | string;
  date: Date | string;
  ticker_count: number;
  summary: Record<string, unknown> | null;
  highlights: Record<string, unknown> | null;
  created_at: Date | string;
}

interface IndexRow {
  batch_id: string;
  ticker: string;
  daily_section: string | null;
  entry: Record<string, unknown>;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toDateString(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function batchFromRow(row: BatchRow): ReportBatchRecord {
  return {
    batchId: row.batch_id,
    userId: row.user_id,
    jobId: row.job_id,
    mode: row.mode,
    triggeredAt: toIso(row.triggered_at),
    date: toDateString(row.date),
    tickerCount: row.ticker_count,
    summary: row.summary,
    highlights: row.highlights,
    createdAt: toIso(row.created_at),
  };
}

function indexFromRow(row: IndexRow): ReportIndexRecord {
  return {
    batchId: row.batch_id,
    ticker: row.ticker,
    dailySection: row.daily_section,
    entry: row.entry,
  };
}

export async function putReportBatch(input: PutReportBatchInput): Promise<ReportBatchRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("putReportBatch requires the application database");
  }
  const ds = await getApplicationDataSource();
  const date = input.date ?? toDateString(input.triggeredAt);

  return ds.transaction(async (manager) => {
    const batchRows = (await manager.query(
      `INSERT INTO report_batches
         (batch_id, user_id, job_id, mode, triggered_at, date, ticker_count, summary, highlights, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
       ON CONFLICT (batch_id) DO UPDATE SET
         mode = EXCLUDED.mode,
         triggered_at = EXCLUDED.triggered_at,
         date = EXCLUDED.date,
         ticker_count = EXCLUDED.ticker_count,
         summary = EXCLUDED.summary,
         highlights = EXCLUDED.highlights
       RETURNING batch_id, user_id, job_id, mode, triggered_at, date,
                 ticker_count, summary, highlights, created_at`,
      [
        input.batchId,
        input.userId,
        input.jobId,
        input.mode,
        input.triggeredAt,
        date,
        input.entries.length,
        input.summary === undefined || input.summary === null ? null : JSON.stringify(input.summary),
        input.highlights === undefined || input.highlights === null
          ? null
          : JSON.stringify(input.highlights),
      ]
    )) as BatchRow[];

    // Replace all index entries for this batch, in case the caller is rewriting.
    await manager.query(`DELETE FROM report_index WHERE batch_id = $1`, [input.batchId]);

    for (const entry of input.entries) {
      await manager.query(
        `INSERT INTO report_index (batch_id, ticker, daily_section, entry)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [input.batchId, entry.ticker.toUpperCase(), entry.dailySection ?? null, JSON.stringify(entry.entry)]
      );
    }

    return batchFromRow(batchRows[0]!);
  });
}

export async function readReportBatchForUser(userId: string, batchId: string): Promise<ReportBatchRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT batch_id, user_id, job_id, mode, triggered_at, date,
            ticker_count, summary, highlights, created_at
       FROM report_batches
      WHERE batch_id = $1 AND user_id = $2
      LIMIT 1`,
    [batchId, userId]
  )) as BatchRow[];
  return rows[0] ? batchFromRow(rows[0]) : null;
}

export async function listReportBatches(
  userId: string,
  options?: { mode?: string; limit?: number }
): Promise<ReportBatchRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.mode) {
    params.push(options.mode);
    where += ` AND mode = $${params.length}`;
  }
  params.push(options?.limit ?? 50);
  const rows = (await ds.query(
    `SELECT batch_id, user_id, job_id, mode, triggered_at, date,
            ticker_count, summary, highlights, created_at
       FROM report_batches WHERE ${where}
       ORDER BY triggered_at DESC
       LIMIT $${params.length}`,
    params
  )) as BatchRow[];
  return rows.map(batchFromRow);
}

export async function listReportIndex(batchId: string): Promise<ReportIndexRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT batch_id, ticker, daily_section, entry
       FROM report_index WHERE batch_id = $1
       ORDER BY ticker ASC`,
    [batchId]
  )) as IndexRow[];
  return rows.map(indexFromRow);
}

export interface BatchWithEntries {
  batchId: string;
  jobId: string;
  mode: string;
  triggeredAt: string;
  date: string;
  tickerCount: number;
  summary: Record<string, unknown> | null;
  highlights: Record<string, unknown> | null;
  tickers: string[];
  entries: Record<string, Record<string, unknown>>;
}

export async function listBatchesWithEntries(
  userId: string,
  limit = 100
): Promise<BatchWithEntries[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();

  interface JoinRow {
    batch_id: string;
    job_id: string;
    mode: string;
    triggered_at: Date | string;
    date: Date | string;
    ticker_count: number;
    summary: Record<string, unknown> | null;
    highlights: Record<string, unknown> | null;
    ticker: string | null;
    daily_section: string | null;
    entry: Record<string, unknown> | null;
  }

  const rows = (await ds.query(
    `SELECT rb.batch_id, rb.job_id, rb.mode, rb.triggered_at, rb.date,
            rb.ticker_count, rb.summary, rb.highlights,
            ri.ticker, ri.daily_section, ri.entry
       FROM (
         SELECT * FROM report_batches WHERE user_id = $1
         ORDER BY triggered_at DESC LIMIT $2
       ) rb
       LEFT JOIN report_index ri ON ri.batch_id = rb.batch_id
       ORDER BY rb.triggered_at DESC, rb.batch_id, ri.ticker`,
    [userId, limit]
  )) as JoinRow[];

  const batchMap = new Map<string, BatchWithEntries>();
  for (const row of rows) {
    if (!batchMap.has(row.batch_id)) {
      batchMap.set(row.batch_id, {
        batchId: row.batch_id,
        jobId: row.job_id,
        mode: row.mode,
        triggeredAt: toIso(row.triggered_at),
        date: toDateString(row.date),
        tickerCount: row.ticker_count,
        summary: row.summary,
        highlights: row.highlights,
        tickers: [],
        entries: {},
      });
    }
    if (row.ticker && row.entry) {
      const b = batchMap.get(row.batch_id)!;
      b.tickers.push(row.ticker);
      b.entries[row.ticker] = row.entry;
    }
  }

  return [...batchMap.values()];
}

export async function getReportMeta(userId: string): Promise<{
  totalBatches: number;
  totalPages: number;
  lastUpdated: string | null;
  newestBatchId: string | null;
}> {
  if (!isApplicationDatabaseConfigured()) {
    return { totalBatches: 0, totalPages: 0, lastUpdated: null, newestBatchId: null };
  }
  const ds = await getApplicationDataSource();
  const countRows = (await ds.query(
    `SELECT COUNT(*) AS total FROM report_batches WHERE user_id = $1`,
    [userId]
  )) as Array<{ total: string }>;
  const latestRows = (await ds.query(
    `SELECT batch_id, triggered_at FROM report_batches WHERE user_id = $1
       ORDER BY triggered_at DESC LIMIT 1`,
    [userId]
  )) as Array<{ batch_id: string; triggered_at: Date | string }>;

  const totalBatches = parseInt(countRows[0]?.total ?? "0", 10);
  const PAGE_SIZE = 10;
  return {
    totalBatches,
    totalPages: Math.max(1, Math.ceil(totalBatches / PAGE_SIZE)),
    lastUpdated: latestRows[0] ? toIso(latestRows[0].triggered_at) : null,
    newestBatchId: latestRows[0]?.batch_id ?? null,
  };
}

export async function listBatchesPage(
  userId: string,
  pageNum: number,
  pageSize = 10
): Promise<{ page: number; totalPages: number; batches: BatchWithEntries[] }> {
  if (!isApplicationDatabaseConfigured()) {
    return { page: pageNum, totalPages: 1, batches: [] };
  }
  const ds = await getApplicationDataSource();
  const countRows = (await ds.query(
    `SELECT COUNT(*) AS total FROM report_batches WHERE user_id = $1`,
    [userId]
  )) as Array<{ total: string }>;
  const total = parseInt(countRows[0]?.total ?? "0", 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(pageNum, 1), totalPages);
  const offset = (safePage - 1) * pageSize;

  interface JoinRow {
    batch_id: string;
    job_id: string;
    mode: string;
    triggered_at: Date | string;
    date: Date | string;
    ticker_count: number;
    summary: Record<string, unknown> | null;
    highlights: Record<string, unknown> | null;
    ticker: string | null;
    daily_section: string | null;
    entry: Record<string, unknown> | null;
  }

  const rows = (await ds.query(
    `SELECT rb.batch_id, rb.job_id, rb.mode, rb.triggered_at, rb.date,
            rb.ticker_count, rb.summary, rb.highlights,
            ri.ticker, ri.daily_section, ri.entry
       FROM (
         SELECT * FROM report_batches WHERE user_id = $1
         ORDER BY triggered_at DESC LIMIT $2 OFFSET $3
       ) rb
       LEFT JOIN report_index ri ON ri.batch_id = rb.batch_id
       ORDER BY rb.triggered_at DESC, rb.batch_id, ri.ticker`,
    [userId, pageSize, offset]
  )) as JoinRow[];

  const batchMap = new Map<string, BatchWithEntries>();
  for (const row of rows) {
    if (!batchMap.has(row.batch_id)) {
      batchMap.set(row.batch_id, {
        batchId: row.batch_id,
        jobId: row.job_id,
        mode: row.mode,
        triggeredAt: toIso(row.triggered_at),
        date: toDateString(row.date),
        tickerCount: row.ticker_count,
        summary: row.summary,
        highlights: row.highlights,
        tickers: [],
        entries: {},
      });
    }
    if (row.ticker && row.entry) {
      const b = batchMap.get(row.batch_id)!;
      b.tickers.push(row.ticker);
      b.entries[row.ticker] = row.entry;
    }
  }

  return { page: safePage, totalPages, batches: [...batchMap.values()] };
}
