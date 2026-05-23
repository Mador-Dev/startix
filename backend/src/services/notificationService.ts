import { NotificationPreferencesSchema, type NotificationPreferences } from "../schemas/notifications.js";
import { logger } from "./logger.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { getStoredWhatsAppConnection, getUserChannelConnectivity } from "./channelService.js";
import {
  composeNotification,
  renderTelegramNotification,
  renderWebNotification,
  type ComposedNotification,
  type SemanticNotificationRequest,
} from "./notificationComposer.js";
import {
  insertNotification as dbInsertNotification,
  updateDelivery as dbUpdateDelivery,
  listNotifications as dbListNotifications,
  markRead as dbMarkRead,
  listByBatch as dbListByBatch,
} from "./notificationStore.js";
import { sendTelegramMessage } from "./telegramDelivery.js";

const WHATSAPP_GRAPH_VERSION = process.env["WHATSAPP_GRAPH_VERSION"] ?? "v17.0";

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = NotificationPreferencesSchema.parse({
  primaryChannel: "telegram",
  enabledChannels: {
    telegram: true,
    web: true,
    whatsapp: false,
  },
  categories: {
    dailyBriefs: true,
    reportRuns: true,
    marketNews: true,
  },
});

export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const connectivity = await getUserChannelConnectivity(userId);
  let base = DEFAULT_NOTIFICATION_PREFERENCES;
  if (isApplicationDatabaseConfigured()) {
    try {
      const ds = await getApplicationDataSource();
      const rows = (await ds.query(
        `SELECT notification_preferences FROM users WHERE user_id = $1`,
        [userId]
      )) as Array<{ notification_preferences: unknown }>;
      const prefs = rows[0]?.notification_preferences;
      if (prefs && typeof prefs === "object" && Object.keys(prefs as object).length > 0) {
        const result = NotificationPreferencesSchema.safeParse(prefs);
        if (result.success) base = result.data;
      }
    } catch {}
  }
  return {
    ...base,
    primaryChannel:
      base.primaryChannel === "telegram" && !connectivity.telegram.connected ? "web"
      : base.primaryChannel === "whatsapp" && !connectivity.whatsapp.connected ? "web"
      : base.primaryChannel,
    enabledChannels: {
      ...base.enabledChannels,
      telegram: base.enabledChannels.telegram && connectivity.telegram.connected,
      whatsapp: base.enabledChannels.whatsapp && connectivity.whatsapp.connected,
    },
  };
}

export async function setNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences
): Promise<NotificationPreferences> {
  const validated = NotificationPreferencesSchema.parse(preferences);
  const connectivity = await getUserChannelConnectivity(userId);
  const nextPrimaryChannel =
    validated.primaryChannel === "telegram" && !connectivity.telegram.connected ? "web"
    : validated.primaryChannel === "whatsapp" && !connectivity.whatsapp.connected ? "web"
    : validated.primaryChannel;
  const normalized = {
    ...validated,
    primaryChannel: nextPrimaryChannel,
    enabledChannels: {
      ...validated.enabledChannels,
      telegram: validated.enabledChannels.telegram && connectivity.telegram.connected,
      whatsapp: validated.enabledChannels.whatsapp && connectivity.whatsapp.connected,
    },
  } satisfies NotificationPreferences;

  if (isApplicationDatabaseConfigured()) {
    const ds = await getApplicationDataSource();
    await ds.query(
      `UPDATE users SET notification_preferences = $1::jsonb WHERE user_id = $2`,
      [JSON.stringify(normalized), userId]
    );
  }
  return normalized;
}

export interface NotificationEnvelope {
  id: string;
  userId: string;
  category: "daily_brief" | "report" | "market_news";
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
  channel: "telegram" | "web" | "whatsapp";
  createdAt: string;
  delivered: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
}

export interface NotificationPublishRequest extends SemanticNotificationRequest {
  userId: string;
}

function categoryEnabled(preferences: NotificationPreferences, category: NotificationEnvelope["category"]): boolean {
  if (category === "daily_brief") return preferences.categories.dailyBriefs;
  if (category === "report") return preferences.categories.reportRuns;
  return preferences.categories.marketNews;
}

function logNotificationEvent(
  level: "info" | "warn",
  fields: Record<string, string | number | boolean | null | string[]>
): void {
  logger[level](JSON.stringify({ event: "notification_publication", ...fields }));
}

function renderRecordContent(
  composed: ComposedNotification,
  channel: NotificationEnvelope["channel"]
): Pick<NotificationEnvelope, "category" | "title" | "body" | "ticker" | "batchId"> {
  if (channel === "telegram") {
    const telegram = renderTelegramNotification(composed);
    return {
      category: composed.category,
      title: composed.title,
      body: telegram.text,
      ticker: composed.ticker,
      batchId: composed.batchId,
    };
  }

  const web = renderWebNotification(composed);
  return {
    category: web.category,
    title: web.title,
    body: web.body,
    ticker: web.ticker,
    batchId: web.batchId,
  };
}

async function getTelegramTarget(userId: string): Promise<{ botToken: string; chatId: string } | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  try {
    const ds = await getApplicationDataSource();
    const [bindingRows, secretRows] = await Promise.all([
      ds.query(
        `SELECT channel_identifier FROM channel_bindings
          WHERE user_id = $1 AND channel = 'telegram' AND unbound_at IS NULL
          LIMIT 1`,
        [userId]
      ) as Promise<Array<{ channel_identifier: string }>>,
      ds.query(
        `SELECT ciphertext FROM encrypted_secrets
          WHERE user_id = $1 AND secret_kind = 'telegram_bot_token'
          LIMIT 1`,
        [userId]
      ) as Promise<Array<{ ciphertext: Buffer }>>,
    ]);
    const chatId = bindingRows[0]?.channel_identifier;
    const botToken = secretRows[0]?.ciphertext?.toString("utf-8");
    if (!chatId || !botToken) return null;
    return { botToken, chatId };
  } catch {
    return null;
  }
}

async function deliverTelegram(record: NotificationEnvelope): Promise<{ delivered: boolean; error: string | null; attemptedChunks: number }> {
  const target = await getTelegramTarget(record.userId);
  if (!target) {
    return { delivered: false, error: "telegram target not configured", attemptedChunks: 0 };
  }

  const result = await sendTelegramMessage({
    botToken: target.botToken,
    chatId: target.chatId,
    text: record.body,
  });

  return {
    delivered: result.delivered,
    error: result.error,
    attemptedChunks: result.attemptedChunks,
  };
}

async function deliverWhatsApp(record: NotificationEnvelope): Promise<{ delivered: boolean; error: string | null }> {
  const target = await getStoredWhatsAppConnection(record.userId);
  if (!target) {
    return { delivered: false, error: "whatsapp target not configured" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${target.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: target.recipientPhone,
          type: "text",
          text: {
            preview_url: false,
            body: `${record.title}\n${record.body}`.slice(0, 4096),
          },
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      return { delivered: false, error: `whatsapp send failed: ${body.slice(0, 140)}` };
    }

    return { delivered: true, error: null };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message.slice(0, 140) : "whatsapp send failed",
    };
  }
}

function buildCandidateChannels(
  preferences: NotificationPreferences,
  connectivity: Awaited<ReturnType<typeof getUserChannelConnectivity>>
): Array<NotificationEnvelope["channel"]> {
  const connectedChannels: Array<NotificationEnvelope["channel"]> = [];

  if (preferences.enabledChannels.web && connectivity.web.connected) connectedChannels.push("web");
  if (preferences.enabledChannels.telegram && connectivity.telegram.connected) connectedChannels.push("telegram");
  if (preferences.enabledChannels.whatsapp && connectivity.whatsapp.connected) connectedChannels.push("whatsapp");

  if (preferences.primaryChannel === "none") return connectedChannels;

  if (connectedChannels.includes(preferences.primaryChannel as NotificationEnvelope["channel"])) {
    connectedChannels.sort((left, right) => {
      if (left === preferences.primaryChannel) return -1;
      if (right === preferences.primaryChannel) return 1;
      return 0;
    });
  }

  return connectedChannels;
}

export async function publishNotification(
  request: NotificationPublishRequest
): Promise<NotificationEnvelope[]> {
  const composed = composeNotification(request);
  const preferences = await getNotificationPreferences(request.userId);
  if (!categoryEnabled(preferences, composed.category)) {
    logNotificationEvent("info", {
      decision: "category_disabled",
      userId: request.userId,
      semanticKind: composed.kind,
      category: composed.category,
      batchId: composed.batchId,
      channels: [],
    });
    return [];
  }

  if (composed.batchId) {
    const existing = await dbListByBatch(request.userId, composed.batchId, composed.category);
    if (existing.length > 0) {
      logNotificationEvent("info", {
        decision: "duplicate_batch",
        userId: request.userId,
        semanticKind: composed.kind,
        category: composed.category,
        batchId: composed.batchId,
        channels: existing.map((item) => item.channel),
      });
      return existing as NotificationEnvelope[];
    }
  }

  const connectivity = await getUserChannelConnectivity(request.userId);
  const candidateChannels = buildCandidateChannels(preferences, connectivity);

  const createdAt = new Date().toISOString();
  const records: NotificationEnvelope[] = candidateChannels.map((channel) => ({
    id: `ntf_${Date.now()}_${channel}_${Math.random().toString(16).slice(2, 8)}`,
    userId: request.userId,
    createdAt,
    delivered: channel === "web",
    deliveredAt: channel === "web" ? createdAt : null,
    readAt: null,
    error: channel === "web" ? null : "pending delivery",
    channel,
    ...renderRecordContent(composed, channel),
  }));

  const deliveryOutcomes: string[] = [];

  for (const record of records) {
    await dbInsertNotification({
      id: record.id,
      userId: record.userId,
      category: record.category,
      channel: record.channel,
      title: record.title,
      body: record.body,
      ticker: record.ticker,
      batchId: record.batchId,
      delivered: record.delivered,
      deliveredAt: record.deliveredAt,
      readAt: record.readAt,
      error: record.error,
    });

    if (record.channel === "telegram") {
      const result = await deliverTelegram(record);
      const deliveredAtIso = result.delivered ? new Date().toISOString() : null;
      deliveryOutcomes.push(`telegram:${result.delivered ? "delivered" : "failed"}:${result.attemptedChunks}`);
      await dbUpdateDelivery(record.userId, record.id, {
        delivered: result.delivered,
        deliveredAt: deliveredAtIso,
        error: result.error,
      });
      record.delivered = result.delivered;
      record.deliveredAt = deliveredAtIso;
      record.error = result.error;
    }
    if (record.channel === "whatsapp") {
      const result = await deliverWhatsApp(record);
      const deliveredAtIso = result.delivered ? new Date().toISOString() : null;
      deliveryOutcomes.push(`whatsapp:${result.delivered ? "delivered" : "failed"}`);
      await dbUpdateDelivery(record.userId, record.id, {
        delivered: result.delivered,
        deliveredAt: deliveredAtIso,
        error: result.error,
      });
      record.delivered = result.delivered;
      record.deliveredAt = deliveredAtIso;
      record.error = result.error;
    }
  }

  logNotificationEvent("info", {
    decision: records.length > 0 ? "published" : "no_channels",
    userId: request.userId,
    semanticKind: composed.kind,
    category: composed.category,
    batchId: composed.batchId,
    channels: candidateChannels,
    deliveryOutcome: deliveryOutcomes.join(",") || (records.length > 0 ? "web:delivered" : "none"),
  });
  return records;
}

export async function listNotifications(
  userId: string,
  options?: { limit?: number; channel?: NotificationEnvelope["channel"] | null; unreadOnly?: boolean }
): Promise<NotificationEnvelope[]> {
  return dbListNotifications(userId, options) as Promise<NotificationEnvelope[]>;
}

export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  return dbMarkRead(userId, ids);
}

export { DEFAULT_NOTIFICATION_PREFERENCES };
