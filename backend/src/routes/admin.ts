import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import { isApplicationDatabaseConfigured, getApplicationDataSource } from "../db/applicationDataSource.js";
import { createUserWorkspace, validateWorkspaceIntegrity, workspaceExists } from "../services/workspaceService.js";
import { hashPassword } from "../middleware/auth.js";
import { logger } from "../services/logger.js";
import {
  listProfiles, createProfile, updateProfile, deleteProfile,
  getUserProfileStatus, setUserProfile,
  getSystemAgentProfileStatus, setSystemAgentProfile,
} from "../services/profileService.js";
import { getAdminDefaults, updateAdminDefaults, MODEL_TIERS, isModelTier, type AdminDefaultsPatch } from "../services/adminDefaultsService.js";
import type { ModelTier } from "../services/adminDefaultsService.js";
import {
  getUserControl, setUserControl, clearUserControl,
  getSystemControl, setSystemControl,
  incrementTokenVersion,
} from "../services/controlService.js";
import {
  getEffectiveDailyPointsBudget,
  grantUserPointsCredit,
  setUserDailyPointsBudget,
} from "../services/pointsBudgetService.js";
import { updateJob, listJobs } from "../services/jobService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { listSupportMessages, updateSupportMessageStatus } from "../services/supportService.js";
import { getActiveUserEligibility } from "../services/stateService.js";
import type { ProfileDefinition } from "../schemas/profile.js";

const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
const ADMIN_KEY = process.env["ADMIN_KEY"] ?? "";
const SYSTEM_AGENT_ID = "main";

const router = Router();

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-admin-key"];
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

router.use(adminAuth);

type AdminHandler = (req: Request, res: Response) => Promise<void>;

function handler(fn: AdminHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
}

function requireDatabase(res: Response): boolean {
  if (isApplicationDatabaseConfigured()) return true;
  res.status(503).json({ error: "application_database_unavailable" });
  return false;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

router.get(
  "/defaults",
  handler(async (_req, res) => {
    res.json({ defaults: await getAdminDefaults() });
  })
);

router.patch(
  "/defaults",
  handler(async (req, res) => {
    const body = req.body as { modelTier?: unknown; pointsBudget?: { dailyBudgetPoints?: unknown }; updatedBy?: string };
    try {
      const patch: AdminDefaultsPatch = {};
      if (body.modelTier !== undefined) patch.modelTier = body.modelTier as ModelTier;
      if (body.pointsBudget !== undefined) {
        patch.pointsBudget = { dailyBudgetPoints: Number(body.pointsBudget.dailyBudgetPoints) };
      }
      const defaults = await updateAdminDefaults(patch, typeof body.updatedBy === "string" ? body.updatedBy : "admin-ui");
      res.json({ defaults });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid_defaults" });
    }
  })
);

// ── Support ───────────────────────────────────────────────────────────────────

router.get(
  "/support/messages",
  handler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100), 1), 500);
    const messages = await listSupportMessages(limit);
    res.json({ messages });
  })
);

router.patch(
  "/support/messages/:messageId",
  handler(async (req, res) => {
    const messageId = req.params.messageId as string;
    const status = (req.body as { status?: string }).status;
    if (status !== "open" && status !== "closed") {
      res.status(400).json({ error: "status must be open or closed" });
      return;
    }
    const message = await updateSupportMessageStatus(messageId, status);
    if (!message) { res.status(404).json({ error: "message_not_found" }); return; }
    res.json({ message });
  })
);

// ── Users ─────────────────────────────────────────────────────────────────────

router.get(
  "/users",
  handler(async (_req, res) => {
    let entries: string[] = [];
    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
    } catch { entries = []; }

    const users = await Promise.all(
      entries.map(async (userId) => {
        const userRoot = path.join(USERS_DIR, userId);
        const profilePath = path.join(userRoot, "profile.json");
        const statePath = path.join(userRoot, "data", "state.json");
        const portfolioPath = path.join(userRoot, "data", "portfolio.json");

        let displayName = userId, createdAt = "";
        const schedule = { dailyBriefTime: "08:00", weeklyResearchDay: "sunday", weeklyResearchTime: "19:00", timezone: "Asia/Jerusalem" };

        try {
          const profile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
          displayName = profile.displayName ?? userId;
          createdAt = profile.createdAt ?? "";
          if (profile.schedule) Object.assign(schedule, profile.schedule);
        } catch { /* no profile */ }

        let state = "UNKNOWN";
        try { state = JSON.parse(await fs.readFile(statePath, "utf-8")).state ?? "UNKNOWN"; } catch { /* no state */ }

        let portfolioLoaded = false;
        try { await fs.access(portfolioPath); portfolioLoaded = true; } catch { /* no portfolio */ }

        const [profileStatus, userCtrl, activeEligibility, integrity] = await Promise.all([
          getUserProfileStatus(userId),
          getUserControl(userId),
          state === "ACTIVE" ? getActiveUserEligibility(userId) : Promise.resolve({ eligible: true, reason: null }),
          validateWorkspaceIntegrity(userId),
        ]);

        return {
          userId, displayName, state, portfolioLoaded, createdAt, schedule,
          modelProfile: profileStatus.name,
          profileBroken: profileStatus.broken,
          profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
          restriction: userCtrl.restriction,
          eligibilityIssue: activeEligibility.eligible ? null : activeEligibility.reason,
          integrityValid: integrity.valid,
          integrityErrors: integrity.errors,
          integrityWarnings: integrity.warnings,
        };
      })
    );

    res.json({ users });
  })
);

router.post(
  "/users",
  handler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? userId).trim();
    const schedule = (body.schedule as Record<string, string>) ?? {
      dailyBriefTime: "08:00", weeklyResearchDay: "sunday", weeklyResearchTime: "19:00", timezone: "Asia/Jerusalem",
    };
    const defaults = await getAdminDefaults();
    const modelTier = isModelTier(body.modelTier) ? body.modelTier : defaults.modelTier;

    if (!/^[a-zA-Z0-9-]{4,32}$/.test(userId)) { res.status(400).json({ error: "userId must be 4-32 alphanumeric or hyphens" }); return; }
    if (password.length < 8) { res.status(400).json({ error: "password must be at least 8 characters" }); return; }
    if (await workspaceExists(userId)) { res.status(409).json({ error: "User already exists" }); return; }

    const ws = await createUserWorkspace(userId);
    const hash = await hashPassword(password);
    const { writeUserAuth } = await import("../services/userStore.js");
    await writeUserAuth(userId, { passwordHash: hash, tokenVersion: 0 });

    await fs.writeFile(
      path.join(ws.root, "profile.json"),
      JSON.stringify({ userId, displayName, schedule, createdAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );

    if (isApplicationDatabaseConfigured()) {
      const ds = await getApplicationDataSource();
      await ds.query(
        `INSERT INTO users (user_id, display_name, password_hash, schedule, model_tier, model_profile, state, points, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'testing', 'INCOMPLETE', 500, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, displayName, hash, JSON.stringify(schedule), modelTier]
      );
    }

    try { await setUserProfile(userId, "testing"); } catch (err) {
      logger.warn(`Failed to apply default model profile for ${userId}: ${err}`);
    }

    res.status(201).json({ userId, created: true });
  })
);

router.delete(
  "/users/:userId",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    if (userId === "main" || userId === "admin") { res.status(400).json({ error: "Cannot delete system user" }); return; }

    const userRoot = path.join(USERS_DIR, userId);
    const archiveDir = path.join(USERS_DIR, ".archived");
    try {
      await fs.access(userRoot);
      await fs.mkdir(archiveDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.rename(userRoot, path.join(archiveDir, `${userId}_${ts}`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(`Failed to archive ${userId}`, { err });
        res.status(500).json({ error: "Failed to delete workspace" }); return;
      }
    }
    res.json({ deleted: true });
  })
);

router.patch(
  "/users/:userId/points-budget",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    const dailyBudgetPoints = Number((req.body as { dailyBudgetPoints?: unknown }).dailyBudgetPoints);
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    try {
      const value = await setUserDailyPointsBudget(userId, dailyBudgetPoints);
      res.json({ userId, pointsBudget: { dailyBudgetPoints: value } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid_points_budget" });
    }
  })
);

router.post(
  "/users/:userId/budget/credit",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    const body = req.body as { points?: unknown; note?: unknown; refId?: unknown };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    try {
      await grantUserPointsCredit(
        userId,
        Number(body.points),
        typeof body.note === "string" ? body.note : null,
        typeof body.refId === "string" ? body.refId : null
      );
      res.status(201).json({ granted: true, userId, pointsBudget: { dailyBudgetPoints: await getEffectiveDailyPointsBudget(userId) } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid_points_credit" });
    }
  })
);

router.patch(
  "/users/:userId/model-tier",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    const { modelTier } = req.body as { modelTier?: unknown };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    if (!isModelTier(modelTier)) {
      res.status(400).json({ error: `modelTier must be one of ${MODEL_TIERS.join(", ")}` }); return;
    }
    if (isApplicationDatabaseConfigured()) {
      const ds = await getApplicationDataSource();
      await ds.query(`UPDATE users SET model_tier = $1, updated_at = NOW() WHERE user_id = $2`, [modelTier, userId]);
    }
    res.json({ userId, modelTier });
  })
);

router.post(
  "/users/:userId/telegram",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { botToken, telegramChatId } = req.body as { botToken: string; telegramChatId: string };
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) { res.status(400).json({ error: "Invalid bot token format" }); return; }
    try {
      if (isApplicationDatabaseConfigured()) {
        const ds = await getApplicationDataSource();
        await ds.query(
          `UPDATE users SET telegram_chat_id = $1, telegram_bot_token = $2 WHERE user_id = $3`,
          [telegramChatId, botToken, userId]
        );
      }
    } catch (err) {
      logger.error(`Failed to update Telegram for ${userId}`, { err });
      res.status(500).json({ error: "Failed to update Telegram" }); return;
    }
    res.json({ updated: true });
  })
);

// ── Status / system ───────────────────────────────────────────────────────────

router.get(
  "/status",
  handler(async (_req, res) => {
    let totalUsers = 0;
    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      totalUsers = dirents.filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
    } catch { /* ignore */ }
    res.json({ totalUsers });
  })
);

router.get(
  "/system-agent",
  handler(async (_req, res) => {
    const profileStatus = await getSystemAgentProfileStatus();
    res.json({
      agentId: SYSTEM_AGENT_ID, workspace: process.cwd(),
      modelProfile: profileStatus.name,
      profileBroken: profileStatus.broken,
      profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
    });
  })
);

// ── Profiles ──────────────────────────────────────────────────────────────────

router.get("/profiles", handler(async (_req, res) => { res.json({ profiles: await listProfiles() }); }));

router.post(
  "/profiles",
  handler(async (req, res) => {
    const { name, definition } = req.body as { name?: string; definition?: ProfileDefinition };
    if (!name || !definition) { res.status(400).json({ error: "name and definition required" }); return; }
    try { await createProfile(name, definition); } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create profile";
      res.status(msg.includes("already exists") ? 409 : 400).json({ error: msg }); return;
    }
    res.status(201).json({ created: true, name });
  })
);

router.patch(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    try { await updateProfile(name, req.body as ProfileDefinition); } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile";
      res.status(msg.includes("not found") ? 404 : 400).json({ error: msg }); return;
    }
    res.json({ updated: true, name });
  })
);

router.delete(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    try { await deleteProfile(name); } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete profile";
      const status = msg.includes("not found") ? 404 : msg.includes("still on it") || msg.includes("reserved") ? 409 : 400;
      res.status(status).json({ error: msg }); return;
    }
    res.json({ deleted: true, name });
  })
);

router.patch(
  "/users/:userId/profile",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) { res.status(400).json({ error: "profileName required" }); return; }
    try { await setUserProfile(userId, profileName); } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      res.status(msg.includes("not found") ? 404 : 400).json({ error: msg }); return;
    }
    res.json({ updated: true, userId, profileName });
  })
);

router.patch(
  "/system-agent/profile",
  handler(async (req, res) => {
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) { res.status(400).json({ error: "profileName required" }); return; }
    try { await setSystemAgentProfile(profileName); } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      res.status(msg.includes("not found") ? 404 : 400).json({ error: msg }); return;
    }
    res.json({ updated: true, agentId: SYSTEM_AGENT_ID, profileName });
  })
);

// ── System / per-user control ─────────────────────────────────────────────────

router.get("/system", handler(async (_req, res) => { res.json(await getSystemControl()); }));

router.patch(
  "/system",
  handler(async (req, res) => {
    const body = req.body as {
      locked?: boolean; lockReason?: string; lockedUntil?: string | null;
      broadcast?: { text: string; type: string; dismissible?: boolean; expiresAt?: string | null } | null;
    };
    const patch: Record<string, unknown> = {};
    if (body.locked !== undefined) { patch["locked"] = body.locked; patch["lockedAt"] = body.locked ? new Date().toISOString() : null; }
    if (body.lockReason !== undefined) patch["lockReason"] = body.lockReason;
    if ("lockedUntil" in body) patch["lockedUntil"] = body.lockedUntil ?? null;
    if ("broadcast" in body) patch["broadcast"] = body.broadcast ?? null;
    await setSystemControl(patch);
    res.json({ updated: true, system: await getSystemControl() });
  })
);

router.patch(
  "/users/:userId/control",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const body = req.body as {
      restriction?: "readonly" | "blocked" | "suspended"; reason?: string;
      restrictedUntil?: string | null;
      banner?: { text: string; type: string; dismissible?: boolean; expiresAt?: string | null } | null;
    };
    if (!body.restriction) { res.status(400).json({ error: "restriction required" }); return; }
    await setUserControl(userId, {
      restriction: body.restriction, reason: body.reason ?? "",
      restrictedAt: new Date().toISOString(), restrictedUntil: body.restrictedUntil ?? null,
      banner: body.banner as Parameters<typeof setUserControl>[1]["banner"] ?? null,
    });
    res.json({ updated: true, userId, control: await getUserControl(userId) });
  })
);

router.delete(
  "/users/:userId/control",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    await clearUserControl(userId);
    res.json({ cleared: true, userId });
  })
);

router.post(
  "/users/:userId/force-logout",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    await incrementTokenVersion(userId);
    res.json({ invalidated: true, userId });
  })
);

// ── Job management ────────────────────────────────────────────────────────────

router.get(
  "/users/:userId/jobs",
  handler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const jobs = await listJobs(ws, 100);
    res.json({ jobs });
  })
);

router.post(
  "/users/:userId/jobs/:jobId/kill",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    try {
      await updateJob(ws, jobId, { status: "failed", completed_at: new Date().toISOString(), error: "Killed by admin" });
      res.json({ killed: true, userId, jobId });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  })
);

router.delete(
  "/users/:userId/jobs/:jobId",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await updateJob(ws, jobId, { status: "cancelled", completed_at: new Date().toISOString(), error: "Cancelled by admin" });
    res.json({ cancelled: true, job });
  })
);

// ── Readiness / diagnostics ───────────────────────────────────────────────────

router.get(
  "/users/:userId/readiness",
  handler(async (req, res) => {
    if (!requireDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = String(req.params["userId"] ?? "");
    if (!userId) { res.status(400).json({ error: "missing_user_id" }); return; }

    const [userRows, jobFailRows, notifRows, convRows] = await Promise.all([
      ds.query(`SELECT user_id, display_name, state, model_tier, restriction FROM users WHERE user_id = $1 LIMIT 1`, [userId]) as Promise<Array<Record<string, unknown>>>,
      ds.query(`SELECT COUNT(*) AS count FROM jobs WHERE user_id = $1 AND status = 'failed' AND triggered_at > NOW() - INTERVAL '24 hours'`, [userId]) as Promise<Array<{ count: string }>>,
      ds.query(`SELECT COUNT(*) AS count FROM notifications_outbox WHERE user_id = $1 AND channel = 'telegram' AND delivered = false AND created_at > NOW() - INTERVAL '24 hours'`, [userId]) as Promise<Array<{ count: string }>>,
      ds.query(`SELECT COUNT(*) AS count FROM conversations WHERE user_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`, [userId]) as Promise<Array<{ count: string }>>,
    ]);

    const user = userRows[0];
    if (!user) { res.status(404).json({ error: "user_not_found" }); return; }

    const lastBriefRows = await ds.query(
      `SELECT MAX(triggered_at) AS last_at FROM jobs WHERE user_id = $1 AND action = 'daily_brief' AND status = 'completed'`, [userId]
    ) as Array<{ last_at: string | null }>;

    const lastTelegramRows = await ds.query(
      `SELECT MAX(delivered_at) AS last_at FROM notifications_outbox WHERE user_id = $1 AND channel = 'telegram' AND delivered = true`, [userId]
    ) as Array<{ last_at: string | null }>;

    res.json({
      userId, displayName: user["display_name"], state: user["state"],
      modelTier: user["model_tier"], restriction: user["restriction"] ?? null,
      jobFailures24h: parseInt(jobFailRows[0]?.count ?? "0", 10),
      telegramUndelivered24h: parseInt(notifRows[0]?.count ?? "0", 10),
      chatConversations24h: parseInt(convRows[0]?.count ?? "0", 10),
      lastDailyBriefAt: lastBriefRows[0]?.last_at ?? null,
      lastTelegramDeliveryAt: lastTelegramRows[0]?.last_at ?? null,
    });
  })
);

router.get(
  "/users/:userId/job-failures",
  handler(async (req, res) => {
    if (!requireDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = String(req.params["userId"] ?? "");
    const windowHours = Math.min(Math.max(Number(req.query["windowHours"] ?? 24), 1), 168);

    const [countRows, recentRows] = await Promise.all([
      ds.query(
        `SELECT action, COUNT(*) AS count FROM jobs WHERE user_id = $1 AND status = 'failed' AND triggered_at > NOW() - ($2 || ' hours')::INTERVAL GROUP BY action ORDER BY count DESC`,
        [userId, String(windowHours)]
      ) as Promise<Array<{ action: string; count: string }>>,
      ds.query(
        `SELECT id, action, status, failure_reason, triggered_at, completed_at FROM jobs WHERE user_id = $1 AND status = 'failed' AND triggered_at > NOW() - ($2 || ' hours')::INTERVAL ORDER BY triggered_at DESC LIMIT 5`,
        [userId, String(windowHours)]
      ) as Promise<Array<Record<string, unknown>>>,
    ]);

    res.json({
      userId, windowHours,
      byAction: countRows.map((r) => ({ action: r.action, count: parseInt(r.count, 10) })),
      recent: recentRows.map((r) => ({
        jobId: r["id"], action: r["action"],
        failureReason: (r["failure_reason"] as string | null)?.slice(0, 256) ?? null,
        triggeredAt: r["triggered_at"], completedAt: r["completed_at"] ?? null,
      })),
    });
  })
);

router.get(
  "/notifications/failures",
  handler(async (req, res) => {
    if (!requireDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const since = typeof req.query["since"] === "string" ? req.query["since"] : null;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const params: unknown[] = [];
    const wheres: string[] = ["delivered = false"];
    if (userId) { params.push(userId); wheres.push(`user_id = $${params.length}`); }
    if (since) { params.push(since); wheres.push(`created_at >= $${params.length}`); }
    params.push(limit);

    const rows = await ds.query(
      `SELECT id, user_id, category, channel, title, ticker, batch_id, error, created_at FROM notifications_outbox WHERE ${wheres.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({ failures: rows.map((r) => ({ id: r["id"], userId: r["user_id"], category: r["category"], channel: r["channel"], title: (r["title"] as string | null)?.slice(0, 128) ?? null, ticker: r["ticker"] ?? null, batchId: r["batch_id"] ?? null, error: (r["error"] as string | null)?.slice(0, 256) ?? null, createdAt: r["created_at"] })), count: rows.length });
  })
);

router.get(
  "/conversations",
  handler(async (req, res) => {
    if (!requireDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const since = typeof req.query["since"] === "string" ? req.query["since"] : null;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const params: unknown[] = [];
    const wheres: string[] = [];
    if (userId) { params.push(userId); wheres.push(`user_id = $${params.length}`); }
    if (since) { params.push(since); wheres.push(`started_at >= $${params.length}`); }
    params.push(limit);

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const rows = await ds.query(
      `SELECT id, user_id, channel, started_at, ended_at, turn_count, total_tokens_in, total_tokens_out, total_cost_usd, termination_reason, tool_call_count, model FROM conversations ${where} ORDER BY started_at DESC LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({ conversations: rows, count: rows.length });
  })
);

export default router;
