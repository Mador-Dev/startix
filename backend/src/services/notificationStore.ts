import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type {
  NotificationCategory,
  NotificationChannel,
} from "../db/entities/NotificationEntity.js";
import { unwrapMutationRows } from "./dbUtils.js";

/**
 * Notification store — replaces `users/[id]/data/feed/notifications.json`
 * (design §4.4; A2.1, A2.2).
 *
 * Idempotency on (user_id, batch_id, category) — used to dedupe duplicate
 * publishes from the daily-brief and report-completion paths.
 */

export type { NotificationCategory, NotificationChannel } from "../db/entities/NotificationEntity.js";

export interface NotificationRecord {
  id: string;
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface InsertNotificationInput {
  id: string;
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  title: string;
  body: string;
  ticker?: string | null;
  batchId?: string | null;
  delivered?: boolean;
  deliveredAt?: string | null;
  readAt?: string | null;
  error?: string | null;
}

interface Row {
  id: string;
  user_id: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  title: string;
  body: string;
  ticker: string | null;
  batch_id: string | null;
  delivered: boolean;
  delivered_at: Date | string | null;
  read_at: Date | string | null;
  error: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromRow(row: Row): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    channel: row.channel,
    title: row.title,
    body: row.body,
    ticker: row.ticker,
    batchId: row.batch_id,
    delivered: row.delivered,
    deliveredAt: toIso(row.delivered_at),
    readAt: toIso(row.read_at),
    error: row.error,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

const SELECT_COLUMNS = `id, user_id, category, channel, title, body, ticker, batch_id,
                        delivered, delivered_at, read_at, error, created_at`;

/**
 * Look up an existing notification by the (user, batchId, category, channel)
 * idempotency tuple. Used to dedupe before a publish.
 */
export async function findByBatchKey(
  userId: string,
  batchId: string,
  category: NotificationCategory,
  channel: NotificationChannel
): Promise<NotificationRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM notifications_outbox
      WHERE user_id = $1 AND batch_id = $2 AND category = $3 AND channel = $4
      LIMIT 1`,
    [userId, batchId, category, channel]
  )) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function insertNotification(input: InsertNotificationInput): Promise<NotificationRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("insertNotification requires the application database");
  }
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `INSERT INTO notifications_outbox
       (id, user_id, category, channel, title, body, ticker, batch_id,
        delivered, delivered_at, read_at, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.id,
      input.userId,
      input.category,
      input.channel,
      input.title.slice(0, 256),
      input.body,
      input.ticker ?? null,
      input.batchId ?? null,
      input.delivered ?? false,
      input.deliveredAt ?? null,
      input.readAt ?? null,
      input.error ?? null,
    ]
  )) as Row[];
  return fromRow(rows[0]!);
}

export async function updateDelivery(
  userId: string,
  notificationId: string,
  update: { delivered: boolean; deliveredAt: string | null; error: string | null }
): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  await ds.query(
    `UPDATE notifications_outbox
        SET delivered = $1, delivered_at = $2, error = $3
      WHERE user_id = $4 AND id = $5`,
    [update.delivered, update.deliveredAt, update.error, userId, notificationId]
  );
}

export async function listNotifications(
  userId: string,
  options?: {
    limit?: number;
    channel?: NotificationChannel | null;
    unreadOnly?: boolean;
  }
): Promise<NotificationRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.channel) {
    params.push(options.channel);
    where += ` AND channel = $${params.length}`;
  }
  if (options?.unreadOnly) {
    where += ` AND read_at IS NULL`;
  }
  params.push(options?.limit ?? 50);
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM notifications_outbox WHERE ${where}
      ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  )) as Row[];
  return rows.map(fromRow);
}

export async function markRead(userId: string, ids: string[]): Promise<number> {
  if (!isApplicationDatabaseConfigured() || ids.length === 0) return 0;
  const ds = await getApplicationDataSource();
  const raw = await ds.query(
    `UPDATE notifications_outbox
        SET read_at = NOW()
      WHERE user_id = $1 AND id = ANY($2::varchar[]) AND read_at IS NULL
      RETURNING id`,
    [userId, ids]
  );
  return unwrapMutationRows<{ id: string }>(raw).length;
}

export async function listByBatch(
  userId: string,
  batchId: string,
  category: NotificationCategory
): Promise<NotificationRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM notifications_outbox
      WHERE user_id = $1 AND batch_id = $2 AND category = $3
      ORDER BY created_at DESC`,
    [userId, batchId, category]
  )) as Row[];
  return rows.map(fromRow);
}
