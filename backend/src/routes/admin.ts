import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { isApplicationDatabaseConfigured, getApplicationDataSource } from "../db/applicationDataSource.js";
import { admitOrReuseStepQueueJob } from "../services/stepQueue/admission.js";
import { ensurePointsBudgetAvailable } from "../services/pointsBudgetService.js";
import { requiresBudgetAdmission } from "../services/jobAdmissionService.js";
import { createUserWorkspace, validateWorkspaceIntegrity, workspaceExists } from "../services/workspaceService.js";
import { hashPassword } from "../middleware/auth.js";
import { logger } from "../services/logger.js";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getUserProfileStatus,
  setUserProfile,
  getSystemAgentProfileStatus,
  setSystemAgentProfile,
} from "../services/profileService.js";
import type { PointsBudgetConfig } from "../types/index.js";
import type { ProfileDefinition } from "../schemas/profile.js";
import { eventStore } from "../services/eventStore.js";
import {
  getUserControl,
  setUserControl,
  clearUserControl,
  getSystemControl,
  setSystemControl,
  incrementTokenVersion,
} from "../services/controlService.js";
import { updateJob, listJobs, getJob } from "../services/jobService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import type { JobAction } from "../types/index.js";
import { connectUserTelegramChannel } from "../services/channelService.js";
import { listSupportMessages, updateSupportMessageStatus } from "../services/supportService.js";
import { getActiveUserEligibility } from "../services/stateService.js";
import { markDeepDiveJobCancelled } from "../services/deepDiveService.js";
import {
  getUserPointsBalanceSnapshot,
  getUserPointsBudget,
  setUserPointsBudget,
} from "../services/pointsBudgetService.js";
const SYSTEM_AGENT_ID = "main";
import {
  ensureDefaultModelTierAssignments,
  isModelTier,
  readUserModelTier,
  writeUserModelTier,
} from "../services/stepQueue/modelTier.js";
import { MODEL_TIERS, STEP_KINDS } from "../services/stepQueue/types.js";
import type { ModelTier, StepKind, JobAction as StepQueueJobAction } from "../services/stepQueue/types.js";
import { getAdminDefaults, updateAdminDefaults, type AdminDefaultsPatch } from "../services/adminDefaultsService.js";
import {
  listPilotFeaturesWithReviews,
  upsertPilotFeatureReview,
  PilotFeatureReviewServiceError,
  type PilotFeatureWithReview,
  type UpsertPilotFeatureReviewInput,
} from "../services/pilotFeatureReviewService.js";
import {
  PilotFeatureReviewStatusSchema,
  PilotFeatureSurfaceSchema,
  type PilotFeatureReviewStatus,
  type PilotFeatureSurface,
} from "../schemas/pilotFeature.js";

const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
const ADMIN_KEY = process.env["ADMIN_KEY"] ?? "";
const PILOT_FEATURE_DEFAULT_LIMIT = 50;
const PILOT_FEATURE_MAX_LIMIT = 200;
const PILOT_FEATURE_MAX_ADMIN_COMMENT_LENGTH = 2_000;
const PILOT_FEATURE_MAX_UPDATED_BY_LENGTH = 128;

interface PilotFeatureAdminRouteDeps {
  databaseConfigured: () => boolean;
  listPilotFeaturesWithReviews: typeof listPilotFeaturesWithReviews;
  upsertPilotFeatureReview: typeof upsertPilotFeatureReview;
}

const defaultPilotFeatureAdminRouteDeps: PilotFeatureAdminRouteDeps = {
  databaseConfigured: isApplicationDatabaseConfigured,
  listPilotFeaturesWithReviews,
  upsertPilotFeatureReview,
};

let pilotFeatureAdminRouteDeps: PilotFeatureAdminRouteDeps = defaultPilotFeatureAdminRouteDeps;

export function setPilotFeatureAdminRouteDepsForTest(deps: PilotFeatureAdminRouteDeps | null): void {
  pilotFeatureAdminRouteDeps = deps ?? defaultPilotFeatureAdminRouteDeps;
}

const router = Router();

// Check admin key
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

// GET /api/admin/defaults
router.get(
  "/defaults",
  handler(async (_req, res) => {
    res.json({ defaults: await getAdminDefaults() });
  })
);

// PATCH /api/admin/defaults
router.patch(
  "/defaults",
  handler(async (req, res) => {
    const body = req.body as {
      modelTier?: unknown;
      pointsBudget?: Partial<PointsBudgetConfig>;
      updatedBy?: string;
    };
    try {
      const patch: AdminDefaultsPatch = {};
      if (body.modelTier !== undefined) patch.modelTier = body.modelTier as ModelTier;
      if (body.pointsBudget !== undefined) patch.pointsBudget = body.pointsBudget;
      const defaults = await updateAdminDefaults(
        patch,
        typeof body.updatedBy === "string" ? body.updatedBy : "admin-ui"
      );
      res.json({ defaults });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid_defaults" });
    }
  })
);

const PilotFeatureReviewPatchSchema = z.object({
  status: PilotFeatureReviewStatusSchema.optional(),
  adminComment: z.string().max(PILOT_FEATURE_MAX_ADMIN_COMMENT_LENGTH).nullable().optional(),
  incorrectDescription: z.boolean().optional(),
  updatedBy: z.string().trim().min(1).max(PILOT_FEATURE_MAX_UPDATED_BY_LENGTH).optional(),
}).strict();

function firstQueryValue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return null;
}

function parsePilotFeatureListQuery(req: Request):
  | { ok: true; surface?: PilotFeatureSurface; status?: PilotFeatureReviewStatus; limit: number; offset: number }
  | { ok: false; message: string } {
  const rawSurface = firstQueryValue(req.query["surface"]);
  const rawStatus = firstQueryValue(req.query["status"]);
  const rawLimit = firstQueryValue(req.query["limit"]);
  const rawOffset = firstQueryValue(req.query["offset"]);

  const parsedSurface = rawSurface === undefined ? undefined : PilotFeatureSurfaceSchema.safeParse(rawSurface);
  if (rawSurface === null || (parsedSurface && !parsedSurface.success)) {
    return { ok: false, message: "surface must be one of admin, operator, telegram, web" };
  }

  const parsedStatus = rawStatus === undefined ? undefined : PilotFeatureReviewStatusSchema.safeParse(rawStatus);
  if (rawStatus === null || (parsedStatus && !parsedStatus.success)) {
    return { ok: false, message: "status must be one of unreviewed, needs_fix, beta, hidden, ready" };
  }

  const limitNumber = rawLimit === undefined ? PILOT_FEATURE_DEFAULT_LIMIT : Number(rawLimit);
  if (rawLimit === null || !Number.isFinite(limitNumber)) {
    return { ok: false, message: "limit must be a number" };
  }
  const offsetNumber = rawOffset === undefined ? 0 : Number(rawOffset);
  if (rawOffset === null || !Number.isFinite(offsetNumber)) {
    return { ok: false, message: "offset must be a number" };
  }

  return {
    ok: true,
    ...(parsedSurface?.success ? { surface: parsedSurface.data } : {}),
    ...(parsedStatus?.success ? { status: parsedStatus.data } : {}),
    limit: Math.min(Math.max(Math.trunc(limitNumber), 1), PILOT_FEATURE_MAX_LIMIT),
    offset: Math.max(Math.trunc(offsetNumber), 0),
  };
}

function serviceErrorToHttp(error: PilotFeatureReviewServiceError): {
  status: number;
  body: Record<string, unknown>;
  safeReason: string;
} {
  switch (error.code) {
    case "INVALID_REVIEW_INPUT":
      return {
        status: 422,
        body: { error: "invalid_pilot_feature_review", details: error.details },
        safeReason: error.code,
      };
    case "UNKNOWN_FEATURE_ID":
      return {
        status: 404,
        body: { error: "pilot_feature_not_found" },
        safeReason: error.code,
      };
    case "DATABASE_UNAVAILABLE":
      return {
        status: 503,
        body: { error: "application_database_unavailable", databaseAvailable: false },
        safeReason: error.code,
      };
    case "CATALOG_LOAD_FAILED":
      return {
        status: 503,
        body: { error: "pilot_feature_catalog_unavailable" },
        safeReason: error.code,
      };
  }
}

function respondPilotFeatureServiceError(
  res: Response,
  error: PilotFeatureReviewServiceError,
  context: "list" | "patch",
  featureId?: string
): void {
  const mapped = serviceErrorToHttp(error);
  logger.warn(
    `pilot_feature_admin_${context}_failed feature_id=${featureId ?? "<list>"} reason=${mapped.safeReason}`
  );
  res.status(mapped.status).json(mapped.body);
}

function filterPilotFeatures(
  features: PilotFeatureWithReview[],
  filters: { surface?: PilotFeatureSurface; status?: PilotFeatureReviewStatus }
): PilotFeatureWithReview[] {
  return features.filter((feature) => {
    if (filters.surface && feature.surface !== filters.surface) return false;
    if (filters.status && feature.review.status !== filters.status) return false;
    return true;
  });
}

router.get(
  "/pilot-features",
  handler(async (req, res) => {
    const parsed = parsePilotFeatureListQuery(req);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_pilot_feature_filter", message: parsed.message });
      return;
    }

    if (!pilotFeatureAdminRouteDeps.databaseConfigured()) {
      logger.warn("pilot_feature_admin_list_failed feature_id=<list> reason=DATABASE_UNAVAILABLE");
      res.status(503).json({ error: "application_database_unavailable", databaseAvailable: false });
      return;
    }

    try {
      const features = await pilotFeatureAdminRouteDeps.listPilotFeaturesWithReviews();
      const filtered = filterPilotFeatures(features, parsed);
      const items = filtered.slice(parsed.offset, parsed.offset + parsed.limit);
      res.json({
        items,
        total: filtered.length,
        limit: parsed.limit,
        offset: parsed.offset,
        databaseAvailable: true,
      });
    } catch (error) {
      if (error instanceof PilotFeatureReviewServiceError) {
        respondPilotFeatureServiceError(res, error, "list");
        return;
      }
      logger.warn("pilot_feature_admin_list_failed feature_id=<list> reason=UNEXPECTED_ERROR");
      throw error;
    }
  })
);

router.patch(
  "/pilot-features/:featureId/review",
  handler(async (req, res) => {
    const featureId = String(req.params.featureId ?? "").trim();
    if (!featureId) {
      res.status(400).json({ error: "feature_id_required" });
      return;
    }

    const parsedBody = PilotFeatureReviewPatchSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(422).json({ error: "invalid_pilot_feature_review" });
      return;
    }

    if (!pilotFeatureAdminRouteDeps.databaseConfigured()) {
      logger.warn(`pilot_feature_admin_patch_failed feature_id=${featureId} reason=DATABASE_UNAVAILABLE`);
      res.status(503).json({ error: "application_database_unavailable", databaseAvailable: false });
      return;
    }

    try {
      const currentFeature = (await pilotFeatureAdminRouteDeps.listPilotFeaturesWithReviews())
        .find((feature) => feature.id === featureId);
      if (!currentFeature) {
        logger.warn(`pilot_feature_admin_patch_failed feature_id=${featureId} reason=UNKNOWN_FEATURE_ID`);
        res.status(404).json({ error: "pilot_feature_not_found" });
        return;
      }

      const patch = parsedBody.data;
      const input: UpsertPilotFeatureReviewInput = {
        featureId,
        status: patch.status ?? currentFeature.review.status,
        adminComment: Object.prototype.hasOwnProperty.call(patch, "adminComment")
          ? patch.adminComment ?? null
          : currentFeature.review.adminComment,
        incorrectDescription: Object.prototype.hasOwnProperty.call(patch, "incorrectDescription")
          ? patch.incorrectDescription ?? false
          : currentFeature.review.incorrectDescription,
        updatedBy: patch.updatedBy ?? "admin-ui",
      };
      const feature = await pilotFeatureAdminRouteDeps.upsertPilotFeatureReview(input);
      res.json({ feature });
    } catch (error) {
      if (error instanceof PilotFeatureReviewServiceError) {
        respondPilotFeatureServiceError(res, error, "patch", featureId);
        return;
      }
      logger.warn(`pilot_feature_admin_patch_failed feature_id=${featureId} reason=UNEXPECTED_ERROR`);
      throw error;
    }
  })
);

function mutationRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    Array.isArray(result[0]) &&
    (typeof result[1] === "number" || result.length === 2)
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? result as T[] : [];
}

function parseIsoRange(req: Request, res: Response): { from: Date; to: Date } | null {
  const fromRaw = typeof req.query["from"] === "string" ? req.query["from"] : "";
  const toRaw = typeof req.query["to"] === "string" ? req.query["to"] : "";
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (!fromRaw || !toRaw || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "valid from and to ISO timestamps required" });
    return null;
  }
  if (from >= to) {
    res.status(400).json({ error: "from must be before to" });
    return null;
  }
  const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxRangeMs) {
    res.status(400).json({ error: "range too large; maximum is 366 days" });
    return null;
  }
  return { from, to };
}

async function patchUserPointsBudget(req: Request, res: Response): Promise<void> {
  const userId = req.params.userId as string;
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<PointsBudgetConfig> = {};
  if (typeof body["dailyBudgetPoints"] !== "undefined") {
    updates.dailyBudgetPoints = Number(body["dailyBudgetPoints"]);
  }

  try {
    const pointsBudget = await setUserPointsBudget(userId, updates);
    res.json({ userId, pointsBudget });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "User not found" });
  }
}

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
    if (!message) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }

    res.json({ message });
  })
);

// GET /api/admin/users
router.get(
  "/users",
  handler(async (_req, res) => {
    let entries: string[] = [];
    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
    } catch {
      entries = [];
    }

    const defaults = await getAdminDefaults();
    const users = await Promise.all(
      entries.map(async (userId) => {
        const userRoot = path.join(USERS_DIR, userId);
        const profilePath = path.join(userRoot, "profile.json");
        const statePath = path.join(userRoot, "data", "state.json");
        const portfolioPath = path.join(userRoot, "data", "portfolio.json");

        let displayName = userId;
        let createdAt = "";
        let modelTier: ModelTier = defaults.modelTier;
        const schedule = { dailyBriefTime: "08:00", weeklyResearchDay: "sunday", weeklyResearchTime: "19:00", timezone: "Asia/Jerusalem" };

        try {
          const profile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
          displayName = profile.displayName ?? userId;
          createdAt = profile.createdAt ?? "";
          if (profile.schedule) Object.assign(schedule, profile.schedule);
          modelTier = isModelTier(profile.modelTier) ? profile.modelTier : modelTier;
        } catch { /* no profile */ }

        let pointsBudget: PointsBudgetConfig = { ...defaults.pointsBudget };
        try {
          pointsBudget = await getUserPointsBudget(userId);
        } catch {
          pointsBudget = { ...defaults.pointsBudget };
        }

        let state = "UNKNOWN";
        try {
          const st = JSON.parse(await fs.readFile(statePath, "utf-8"));
          state = st.state ?? "UNKNOWN";
        } catch { /* no state */ }

        let portfolioLoaded = false;
        try {
          await fs.access(portfolioPath);
          portfolioLoaded = true;
        } catch { /* no portfolio */ }

        const [profileStatus, userCtrl, activeEligibility, integrity] = await Promise.all([
          getUserProfileStatus(userId),
          getUserControl(userId),
          state === "ACTIVE"
            ? getActiveUserEligibility(userId)
            : Promise.resolve({ eligible: true, reason: null }),
          validateWorkspaceIntegrity(userId),
        ]);

        return {
          userId,
          displayName,
          state,
          portfolioLoaded,
          hasTelegram: false,
          telegramChatId: undefined,
          createdAt,
          schedule,
          pointsBudget,
          modelTier,
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

// POST /api/admin/users
router.post(
  "/users",
  handler(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const userId = String(body.userId ?? "").trim();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? userId).trim();
    const schedule = (body.schedule as Record<string, string>) ?? {
      dailyBriefTime: "08:00",
      weeklyResearchDay: "sunday",
      weeklyResearchTime: "19:00",
      timezone: "Asia/Jerusalem",
    };
    const defaults = await getAdminDefaults();
    const modelTier = isModelTier(body.modelTier) ? body.modelTier : defaults.modelTier;
    const pointsBudget = {
      dailyBudgetPoints: Number(
        (body.pointsBudget as Partial<PointsBudgetConfig> | undefined)?.dailyBudgetPoints ??
          defaults.pointsBudget.dailyBudgetPoints
      ),
    };

    if (!/^[a-zA-Z0-9-]{4,32}$/.test(userId)) {
      res.status(400).json({ error: "userId must be 4-32 alphanumeric or hyphens" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    if (await workspaceExists(userId)) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    const ws = await createUserWorkspace(userId);

    const hash = await hashPassword(password);
    const { writeUserAuth } = await import("../services/userStore.js");
    await writeUserAuth(userId, { passwordHash: hash, tokenVersion: 0 });

    // profile.json must exist before setUserPointsBudget (which calls ensureUserProfileExists)
    await fs.writeFile(
      path.join(ws.root, "profile.json"),
      JSON.stringify({ userId, displayName, schedule, createdAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );

    if (isApplicationDatabaseConfigured()) {
      const ds = await getApplicationDataSource();
      await ds.query(
        `INSERT INTO users (user_id, display_name, password_hash, schedule, model_tier, model_profile, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'testing', 'INCOMPLETE', NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [
          userId,
          displayName,
          hash,
          JSON.stringify(schedule),
          modelTier,
        ]
      );
    }

    await setUserPointsBudget(userId, pointsBudget);

    try {
      await setUserProfile(userId, "testing");
    } catch (err) {
      logger.warn(`Failed to apply default model profile for ${userId}: ${err}`);
    }

    res.status(201).json({ userId, created: true });
  })
);

// DELETE /api/admin/users/:userId
router.delete(
  "/users/:userId",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }

    if (userId === "main" || userId === "admin") {
      res.status(400).json({ error: "Cannot delete system user" });
      return;
    }

    const userRoot = path.join(USERS_DIR, userId);
    const archiveDir = path.join(USERS_DIR, ".archived");

    try {
      await fs.access(userRoot);
      // Workspace exists — archive it
      await fs.mkdir(archiveDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.rename(userRoot, path.join(archiveDir, `${userId}_${ts}`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(`Failed to archive ${userId}`, { err });
        res.status(500).json({ error: "Failed to delete workspace" });
        return;
      }
      // Workspace already gone — treat as success
      logger.info(`Workspace already absent for ${userId}, skipping archive`);
    }

    res.json({ deleted: true });
  })
);

// PATCH /api/admin/users/:userId/points-budget
router.patch(
  "/users/:userId/points-budget",
  handler(patchUserPointsBudget)
);

// POST /api/admin/users/:userId/budget/credit — grant a one-time temporary credit
router.post(
  "/users/:userId/budget/credit",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    if (!requireStepQueueDatabase(res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const points = Number(body["points"]);
    const note = typeof body["note"] === "string" ? body["note"].slice(0, 200) : null;
    if (!Number.isFinite(points) || points <= 0) {
      res.status(400).json({ error: "points must be a positive number" });
      return;
    }

    const ds = await getApplicationDataSource();
    const { randomUUID } = await import("crypto");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await ds.query(
      `INSERT INTO user_points_credits (id, user_id, points, note, granted_by, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, 'admin', NOW(), $5)`,
      [randomUUID(), userId, points, note, expiresAt]
    );
    logger.info(`Admin granted ${points} credit points to ${userId} (expires ${expiresAt})`);
    res.json({ ok: true, userId, points, expiresAt, note });
  })
);

// PATCH /api/admin/users/:userId/model-tier
router.patch(
  "/users/:userId/model-tier",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    const modelTier = (req.body as { modelTier?: unknown }).modelTier;
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    if (!isModelTier(modelTier)) {
      res.status(400).json({ error: `modelTier must be one of ${MODEL_TIERS.join(", ")}` });
      return;
    }
    await writeUserModelTier(userId, modelTier);
    res.json({ userId, modelTier: await readUserModelTier(userId) });
  })
);

// POST /api/admin/users/:userId/telegram
router.post(
  "/users/:userId/telegram",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { botToken, telegramChatId } = req.body as { botToken: string; telegramChatId: string };

    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
      res.status(400).json({ error: "Invalid bot token format" });
      return;
    }

    try {
      await connectUserTelegramChannel(userId, botToken, telegramChatId);
    } catch (err) {
      logger.error(`Failed to update Telegram for ${userId}`, { err });
      res.status(500).json({ error: "Failed to update Telegram" });
      return;
    }
    res.json({ updated: true });
  })
);

// GET /api/admin/status
router.get(
  "/status",
  handler(async (_req, res) => {
    let totalUsers = 0;

    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      totalUsers = dirents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
    } catch { /* ignore */ }

    res.json({ totalUsers });
  })
);

router.get(
  "/system-agent",
  handler(async (_req, res) => {
    const profileStatus = await getSystemAgentProfileStatus();

    res.json({
      agentId: SYSTEM_AGENT_ID,
      workspace: process.cwd(),
      configured: false,
      hasTelegram: false,
      telegramAccountId: undefined,
      modelProfile: profileStatus.name,
      profileBroken: profileStatus.broken,
      profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
    });
  })
);

// GET /api/admin/profiles
router.get(
  "/profiles",
  handler(async (_req, res) => {
    const profiles = await listProfiles();
    res.json({ profiles });
  })
);

// POST /api/admin/profiles
router.post(
  "/profiles",
  handler(async (req, res) => {
    const body = req.body as { name?: string; definition?: ProfileDefinition };
    const name = String(body.name ?? "").trim();
    const def = body.definition;
    if (!name || !def) {
      res.status(400).json({ error: "name and definition required" });
      return;
    }
    try {
      await createProfile(name, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create profile";
      const status = msg.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.status(201).json({ created: true, name });
  })
);

// PATCH /api/admin/profiles/:name
router.patch(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    const def = req.body as ProfileDefinition;
    try {
      await updateProfile(name, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, name });
  })
);

// DELETE /api/admin/profiles/:name
router.delete(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    try {
      await deleteProfile(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete profile";
      const status = msg.includes("not found") ? 404 : msg.includes("still on it") || msg.includes("reserved") ? 409 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ deleted: true, name });
  })
);

// PATCH /api/admin/users/:userId/profile
router.patch(
  "/users/:userId/profile",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) { res.status(400).json({ error: "profileName required" }); return; }
    try {
      await setUserProfile(userId, profileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, userId, profileName });
  })
);

router.patch(
  "/system-agent/profile",
  handler(async (req, res) => {
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) {
      res.status(400).json({ error: "profileName required" });
      return;
    }
    try {
      await setSystemAgentProfile(profileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, agentId: SYSTEM_AGENT_ID, profileName });
  })
);

// ── Observability routes ──────────────────────────────────────────────────────

// GET /api/admin/observability/summary — all users, today's aggregate totals
router.get(
  "/observability/summary",
  handler(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const users = await eventStore.getDailySummary(today);
    res.json({ date: today, users });
  })
);

// GET /api/admin/observability/range — arbitrary UTC range aggregate from Postgres
router.get(
  "/observability/range",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const range = parseIsoRange(req, res);
    if (!range) return;

    const ds = await getApplicationDataSource();
    const users = await ds.query(
      `SELECT
         user_id AS "userId",
         COUNT(*)::int AS "requestCount",
         COALESCE(SUM(tokens_in), 0)::int AS "totalTokensIn",
         COALESCE(SUM(tokens_out), 0)::int AS "totalTokensOut",
         COALESCE(ROUND(SUM(cost_usd), 6), 0)::float AS "totalCostUsd",
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS "successCount",
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS "errorCount",
         SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END)::int AS "timeoutCount",
         SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END)::int AS "rejectedCount",
         SUM(CASE
           WHEN purpose = 'empty from earlier version'
             OR attribution_source = 'empty from earlier version'
           THEN 1 ELSE 0 END)::int AS "unattributedCount"
       FROM llm_requests
       WHERE occurred_at >= $1::timestamptz
         AND occurred_at < $2::timestamptz
       GROUP BY user_id
       ORDER BY "totalCostUsd" DESC`,
      [range.from.toISOString(), range.to.toISOString()]
    ) as Array<Record<string, unknown>>;

    res.json({ from: range.from.toISOString(), to: range.to.toISOString(), users });
  })
);

// GET /api/admin/observability/users/:userId — 7-day history + last 20 requests
router.get(
  "/observability/users/:userId",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 20), 1), 100);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
    const now = new Date();
    const pointsBudget = await getUserPointsBudget(userId);
    const [history, recentPage] = await Promise.all([
      eventStore.getUserDailyHistory(userId, 7),
      eventStore.getRecentActivityPage(userId, limit, offset),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const todaySummary =
      history.find((entry) => entry.date === today) ?? {
        userId,
        date: today,
        requestCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostUsd: 0,
        successCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        rejectedCount: 0,
        unattributedCount: 0,
      };
    const balance = await getUserPointsBalanceSnapshot(userId, now);
    res.json({
      userId,
      todaySummary,
      history,
      recent: recentPage.events,
      recentTotal: recentPage.total,
      recentLimit: recentPage.limit,
      recentOffset: recentPage.offset,
      pointsBudget,
      pointsBalance: balance,
    });
  })
);

// GET /api/admin/observability/all — all users, last 7 days (for charts)
router.get(
  "/observability/all",
  handler(async (_req, res) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const summaries = await Promise.all(
      days.map((date) => eventStore.getDailySummary(date))
    );
    res.json({ days: days.map((date, i) => ({ date, users: summaries[i] })) });
  })
);

// ── Step queue admin routes ─────────────────────────────────────────────────

function requireStepQueueDatabase(res: Response): boolean {
  if (isApplicationDatabaseConfigured()) return true;
  res.status(503).json({ error: "application_database_unavailable" });
  return false;
}

router.get(
  "/step-queue/jobs",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50), 1), 200);
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : null;
    const params: unknown[] = [];
    const where: string[] = [];
    if (userId) {
      params.push(userId);
      where.push(`j.user_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }
    params.push(limit);
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT
         j.*,
         COUNT(DISTINCT t.id)::int AS ticker_count,
         COUNT(DISTINCT s.id)::int AS step_count,
         COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed')::int AS completed_steps,
         COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'failed')::int AS failed_steps
       FROM jobs j
       LEFT JOIN ticker_work_items t ON t.job_id = j.id
       LEFT JOIN step_work_items s ON s.job_id = j.id
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY j.id
       ORDER BY j.triggered_at DESC
       LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;
    res.json({ jobs: rows });
  })
);

router.get(
  "/step-queue/jobs/:jobId",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const jobId = req.params.jobId as string;
    const ds = await getApplicationDataSource();
    const jobs = await ds.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]) as Array<Record<string, unknown>>;
    const job = jobs[0];
    if (!job) {
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    const [tickers, steps, events] = await Promise.all([
      ds.query(`SELECT * FROM ticker_work_items WHERE job_id = $1 ORDER BY position ASC`, [jobId]),
      ds.query(`SELECT * FROM step_work_items WHERE job_id = $1 ORDER BY created_at ASC`, [jobId]),
      ds.query(
        `SELECT e.*
           FROM step_lifecycle_events e
           JOIN step_work_items s ON s.id = e.step_id
          WHERE s.job_id = $1
          ORDER BY e.occurred_at ASC`,
        [jobId]
      ),
    ]);
    res.json({ job, tickers, steps, events });
  })
);

router.post(
  "/step-queue/jobs/:jobId/pause",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const jobId = String(req.params["jobId"] ?? "");
    if (!jobId) { res.status(400).json({ error: "jobId required" }); return; }
    const ds = await getApplicationDataSource();
    const result = await ds.query(
      `UPDATE jobs SET status = 'paused', paused_at = NOW(), pause_reason = 'Paused by admin'
       WHERE id = $1 AND status IN ('running', 'pending')
       RETURNING id, status`,
      [jobId]
    );
    const rows = mutationRows<{ id: string; status: string }>(result);
    if (rows.length === 0) {
      res.status(404).json({ error: "job_not_found_or_not_pausable" });
      return;
    }
    res.json({ jobId, status: "paused" });
  })
);

router.post(
  "/step-queue/jobs/:jobId/resume",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const jobId = String(req.params["jobId"] ?? "");
    if (!jobId) { res.status(400).json({ error: "jobId required" }); return; }
    const ds = await getApplicationDataSource();
    const result = await ds.query(
      `UPDATE jobs SET status = 'running', paused_at = NULL, pause_reason = NULL
       WHERE id = $1 AND status = 'paused'
       RETURNING id, status`,
      [jobId]
    );
    const rows = mutationRows<{ id: string; status: string }>(result);
    if (rows.length === 0) {
      res.status(404).json({ error: "job_not_found_or_not_paused" });
      return;
    }
    res.json({ jobId, status: "running" });
  })
);

router.get(
  "/step-queue/models",
  handler(async (_req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();
    await ensureDefaultModelTierAssignments(ds);
    const rows = await ds.query(
      `SELECT tier, step_kind, model, fallback, updated_at, updated_by
         FROM model_tier_assignments
        ORDER BY tier, step_kind`
    ) as Array<Record<string, unknown>>;
    res.json({ tiers: MODEL_TIERS, stepKinds: STEP_KINDS, assignments: rows });
  })
);

router.put(
  "/step-queue/models/:tier/:stepKind",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const tier = req.params.tier as ModelTier;
    const stepKind = req.params.stepKind as StepKind;
    if (!(MODEL_TIERS as readonly string[]).includes(tier) || !(STEP_KINDS as readonly string[]).includes(stepKind)) {
      res.status(400).json({ error: "invalid_tier_or_step_kind" });
      return;
    }
    const body = req.body as { model?: string; fallback?: string | null; updatedBy?: string };
    const model = String(body.model ?? "").trim();
    if (!model) {
      res.status(400).json({ error: "model required" });
      return;
    }
    const fallback = typeof body.fallback === "string" && body.fallback.trim() ? body.fallback.trim() : null;
    const updatedBy = String(body.updatedBy ?? "admin").slice(0, 128);
    const ds = await getApplicationDataSource();
    const result = await ds.query(
      `INSERT INTO model_tier_assignments (tier, step_kind, model, fallback, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (tier, step_kind)
       DO UPDATE SET model = EXCLUDED.model,
                     fallback = EXCLUDED.fallback,
                     updated_at = NOW(),
                     updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [tier, stepKind, model, fallback, updatedBy]
    );
    const rows = mutationRows<Record<string, unknown>>(result);
    res.json({ assignment: rows[0] });
  })
);

router.get(
  "/step-queue/cost",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const hasExplicitRange = typeof req.query["from"] === "string" || typeof req.query["to"] === "string";
    const now = new Date();
    const days = Math.min(Math.max(Number(req.query["days"] ?? 7), 1), 90);
    const range = hasExplicitRange
      ? parseIsoRange(req, res)
      : { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: now };
    if (!range) return;
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT
         user_id,
         ticker,
         analyst AS step_kind,
         to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS request_count,
         COALESCE(SUM(tokens_in), 0)::int AS tokens_in,
         COALESCE(SUM(tokens_out), 0)::int AS tokens_out,
         COALESCE(ROUND(SUM(cost_usd), 6), 0) AS cost_usd,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS success_count,
         SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END)::int AS error_count
       FROM llm_requests
       WHERE purpose = 'step_queue'
         AND occurred_at >= $1::timestamptz
         AND occurred_at < $2::timestamptz
       GROUP BY user_id, ticker, analyst, day
       ORDER BY day DESC, cost_usd DESC`,
      [range.from.toISOString(), range.to.toISOString()]
    ) as Array<Record<string, unknown>>;
    res.json({ days: hasExplicitRange ? null : days, from: range.from.toISOString(), to: range.to.toISOString(), rows });
  })
);

// ── System control ────────────────────────────────────────────────────────────

// GET /api/admin/system — read system-wide control state
router.get(
  "/system",
  handler(async (_req, res) => {
    const ctrl = await getSystemControl();
    res.json(ctrl);
  })
);

// PATCH /api/admin/system — lock/unlock, set broadcast
router.patch(
  "/system",
  handler(async (req, res) => {
    const body = req.body as {
      locked?: boolean;
      lockReason?: string;
      lockedUntil?: string | null;
      broadcast?: { text: string; type: string; dismissible?: boolean; expiresAt?: string | null } | null;
    };
    const patch: Record<string, unknown> = {};
    if (body.locked !== undefined) {
      patch["locked"]   = body.locked;
      patch["lockedAt"] = body.locked ? new Date().toISOString() : null;
    }
    if (body.lockReason !== undefined) patch["lockReason"]  = body.lockReason;
    if ("lockedUntil" in body)          patch["lockedUntil"] = body.lockedUntil ?? null;
    if ("broadcast" in body)            patch["broadcast"]   = body.broadcast ?? null;
    await setSystemControl(patch);
    res.json({ updated: true, system: await getSystemControl() });
  })
);

// ── Per-user control ──────────────────────────────────────────────────────────

// PATCH /api/admin/users/:userId/control — set restriction
router.patch(
  "/users/:userId/control",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const body = req.body as {
      restriction?: "readonly" | "blocked" | "suspended";
      reason?: string;
      restrictedUntil?: string | null;
      banner?: { text: string; type: string; dismissible?: boolean; expiresAt?: string | null } | null;
    };
    if (!body.restriction) { res.status(400).json({ error: "restriction required" }); return; }
    await setUserControl(userId, {
      restriction:     body.restriction,
      reason:          body.reason ?? "",
      restrictedAt:    new Date().toISOString(),
      restrictedUntil: body.restrictedUntil ?? null,
      banner:          body.banner as Parameters<typeof setUserControl>[1]["banner"] ?? null,
    });
    res.json({ updated: true, userId, control: await getUserControl(userId) });
  })
);

// DELETE /api/admin/users/:userId/control — remove all restrictions
router.delete(
  "/users/:userId/control",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    await clearUserControl(userId);
    res.json({ cleared: true, userId });
  })
);

// POST /api/admin/users/:userId/force-logout — invalidate all active sessions
router.post(
  "/users/:userId/force-logout",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    await incrementTokenVersion(userId);
    res.json({ invalidated: true, userId });
  })
);

// POST /api/admin/users/:userId/jobs/:jobId/kill — force-fail a running job
router.post(
  "/users/:userId/jobs/:jobId/kill",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    try {
      await updateJob(ws, jobId, {
        status:       "failed",
        completed_at: new Date().toISOString(),
        error:        "Killed by admin",
      });
      // Also remove trigger file if it exists (pending job killed before pickup)
      try { await fs.unlink(path.join(ws.triggersDir, `${jobId}.json`)); } catch { /* ok */ }
      res.json({ killed: true, userId, jobId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: msg });
    }
  })
);

// ── Admin job control ─────────────────────────────────────────────────────────

const VALID_JOB_ACTIONS: JobAction[] = [
  "daily_brief", "full_report", "deep_dive", "new_ideas", "quick_check", "switch_production", "switch_testing",
];

// GET /api/admin/users/:userId/jobs — list all jobs for a user
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

// POST /api/admin/users/:userId/jobs — admin creates a job (bypasses rate limits)
router.post(
  "/users/:userId/jobs",
  handler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const { action, ticker } = req.body as { action?: string; ticker?: string };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    if (!action || !VALID_JOB_ACTIONS.includes(action as JobAction)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_JOB_ACTIONS.join(", ")}` });
      return;
    }
    if ((action === "deep_dive" || action === "quick_check") && !ticker) {
      res.status(400).json({ error: `${action} requires ticker` });
      return;
    }
    if (action === "switch_production" || action === "switch_testing") {
      res.status(400).json({ error: `${action} is not a step-queue action — use the profile switch endpoint` });
      return;
    }
    if (!requireStepQueueDatabase(res)) return;
    const ws = buildWorkspace(userId, USERS_DIR);
    const budgetGate = await ensurePointsBudgetAvailable(userId);
    if (!budgetGate.allowed) {
      res.status(202).json({ error: "points_budget_exhausted", reason: budgetGate.reason });
      return;
    }
    const admitted = await admitOrReuseStepQueueJob({
      workspace: ws,
      action: action as StepQueueJobAction,
      ticker,
      source: "admin",
      budgetAdmittedAt: requiresBudgetAdmission({ action: action as JobAction }) ? new Date() : null,
    });
    res.status(admitted.reused ? 200 : 201).json({
      jobId: admitted.jobId,
      stepQueue: true,
      reused: admitted.reused,
      tickerCount: admitted.tickerCount,
      stepCount: admitted.stepCount,
    });
  })
);

// PATCH /api/admin/users/:userId/jobs/:jobId — edit a pending job
router.patch(
  "/users/:userId/jobs/:jobId",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, jobId);
    if (job.status !== "pending") {
      res.status(409).json({ error: "Only pending jobs can be edited" });
      return;
    }
    const { action, ticker } = req.body as { action?: string; ticker?: string };
    if (action && !VALID_JOB_ACTIONS.includes(action as JobAction)) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }
    const ds = await getApplicationDataSource();
    if (action) {
      await ds.query(
        `UPDATE jobs SET action = $1 WHERE id = $2 AND user_id = $3`,
        [action, jobId, userId]
      );
    }
    if (ticker !== undefined) {
      await ds.query(
        `UPDATE ticker_work_items SET ticker = $1 WHERE job_id = $2 AND user_id = $3`,
        [ticker || null, jobId, userId]
      );
    }
    const updated = await getJob(ws, jobId);
    res.json({ job: updated });
  })
);

// DELETE /api/admin/users/:userId/jobs/:jobId — cancel a job
router.delete(
  "/users/:userId/jobs/:jobId",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const existing = await getJob(ws, jobId);
    const job = existing.action === "deep_dive"
      ? await markDeepDiveJobCancelled(ws, existing, "Cancelled by admin")
      : await updateJob(ws, jobId, {
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error: "Cancelled by admin",
        });
    res.json({ cancelled: true, job });
  })
);

// POST /api/admin/users/:userId/jobs/:jobId/continue — retry a job via step queue
router.post(
  "/users/:userId/jobs/:jobId/continue",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    if (!requireStepQueueDatabase(res)) return;
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, jobId);
    if (job.action === "switch_production" || job.action === "switch_testing") {
      res.status(400).json({ error: `${job.action} is not a step-queue action — cannot continue via step queue` });
      return;
    }
    const admitted = await admitOrReuseStepQueueJob({
      workspace: ws,
      action: job.action as StepQueueJobAction,
      ticker: job.ticker ?? undefined,
      source: "admin",
      budgetAdmittedAt: requiresBudgetAdmission({ action: job.action as JobAction }) ? new Date() : null,
    });
    res.json({ continued: true, userId, previousJobId: jobId, newJobId: admitted.jobId, reused: admitted.reused });
  })
);

// ── Impersonation routes (S07) ───────────────────────────────────────────────
// Mounted here so they inherit the adminAuth middleware applied to the whole router.
import impersonationRouter from "./adminImpersonation.js";
router.use(impersonationRouter);

// ── GET /api/admin/users/:userId/readiness ───────────────────────────────────

router.get(
  "/users/:userId/readiness",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = String(req.params["userId"] ?? "");
    if (!userId) { res.status(400).json({ error: "missing_user_id" }); return; }

    const [userRows, jobFailRows, notifRows, convRows] = await Promise.all([
      ds.query(
        `SELECT user_id, display_name, state, model_tier, restriction FROM users WHERE user_id = $1 LIMIT 1`,
        [userId]
      ) as Promise<Array<Record<string, unknown>>>,
      ds.query(
        `SELECT COUNT(*) AS count FROM jobs
         WHERE user_id = $1 AND status = 'failed'
           AND triggered_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      ) as Promise<Array<{ count: string }>>,
      ds.query(
        `SELECT COUNT(*) AS count FROM notifications_outbox
         WHERE user_id = $1 AND channel = 'telegram' AND delivered = false
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      ) as Promise<Array<{ count: string }>>,
      ds.query(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE user_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      ) as Promise<Array<{ count: string }>>,
    ]);

    const user = userRows[0];
    if (!user) { res.status(404).json({ error: "user_not_found" }); return; }

    // Points balance
    const balanceRows = await ds.query(
      `SELECT COALESCE(b.daily_budget_points, 0) AS budget,
              COALESCE(SUM(r.cost_usd * 100), 0) AS used_points
       FROM user_points_budgets b
       LEFT JOIN llm_requests r ON r.user_id = b.user_id
         AND r.occurred_at > NOW() - INTERVAL '24 hours'
       WHERE b.user_id = $1
       GROUP BY b.daily_budget_points`,
      [userId]
    ) as Array<{ budget: string; used_points: string }>;

    const budget = parseFloat(balanceRows[0]?.budget ?? "0");
    const usedPoints = parseFloat(balanceRows[0]?.used_points ?? "0");

    // Last daily brief
    const lastBriefRows = await ds.query(
      `SELECT MAX(triggered_at) AS last_at FROM report_batches
       WHERE user_id = $1 AND mode = 'daily_brief'`,
      [userId]
    ) as Array<{ last_at: string | null }>;

    // Last successful Telegram delivery
    const lastTelegramRows = await ds.query(
      `SELECT MAX(delivered_at) AS last_at FROM notifications_outbox
       WHERE user_id = $1 AND channel = 'telegram' AND delivered = true`,
      [userId]
    ) as Array<{ last_at: string | null }>;

    res.json({
      userId,
      displayName: user["display_name"],
      state: user["state"],
      modelTier: user["model_tier"],
      restriction: user["restriction"] ?? null,
      jobFailures24h: parseInt(jobFailRows[0]?.count ?? "0", 10),
      telegramUndelivered24h: parseInt(notifRows[0]?.count ?? "0", 10),
      chatConversations24h: parseInt(convRows[0]?.count ?? "0", 10),
      pointsBudget: budget,
      pointsUsed: usedPoints,
      pointsRemaining: Math.max(0, budget - usedPoints),
      lastDailyBriefAt: lastBriefRows[0]?.last_at ?? null,
      lastTelegramDeliveryAt: lastTelegramRows[0]?.last_at ?? null,
    });
  })
);

// ── GET /api/admin/users/:userId/job-failures ────────────────────────────────

router.get(
  "/users/:userId/job-failures",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = String(req.params["userId"] ?? "");
    const windowHours = Math.min(Math.max(Number(req.query["windowHours"] ?? 24), 1), 168);

    const [countRows, recentRows] = await Promise.all([
      ds.query(
        `SELECT action, COUNT(*) AS count FROM jobs
         WHERE user_id = $1 AND status = 'failed'
           AND triggered_at > NOW() - ($2 || ' hours')::INTERVAL
         GROUP BY action ORDER BY count DESC`,
        [userId, String(windowHours)]
      ) as Promise<Array<{ action: string; count: string }>>,
      ds.query(
        `SELECT id, action, status, failure_reason, triggered_at, completed_at
         FROM jobs
         WHERE user_id = $1 AND status = 'failed'
           AND triggered_at > NOW() - ($2 || ' hours')::INTERVAL
         ORDER BY triggered_at DESC LIMIT 5`,
        [userId, String(windowHours)]
      ) as Promise<Array<Record<string, unknown>>>,
    ]);

    res.json({
      userId,
      windowHours,
      byAction: countRows.map((r) => ({ action: r.action, count: parseInt(r.count, 10) })),
      recent: recentRows.map((r) => ({
        jobId: r["id"],
        action: r["action"],
        failureReason: (r["failure_reason"] as string | null)?.slice(0, 256) ?? null,
        triggeredAt: r["triggered_at"],
        completedAt: r["completed_at"] ?? null,
      })),
    });
  })
);

// ── GET /api/admin/notifications/failures ────────────────────────────────────

router.get(
  "/notifications/failures",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
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
      `SELECT id, user_id, category, channel, title, ticker, batch_id, error, created_at
       FROM notifications_outbox
       WHERE ${wheres.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({
      failures: rows.map((r) => ({
        id: r["id"],
        userId: r["user_id"],
        category: r["category"],
        channel: r["channel"],
        title: (r["title"] as string | null)?.slice(0, 128) ?? null,
        ticker: r["ticker"] ?? null,
        batchId: r["batch_id"] ?? null,
        error: (r["error"] as string | null)?.slice(0, 256) ?? null,
        createdAt: r["created_at"],
      })),
      count: rows.length,
    });
  })
);

// ── GET /api/admin/output-filter-events ──────────────────────────────────────

router.get(
  "/output-filter-events",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const since = typeof req.query["since"] === "string" ? req.query["since"] : null;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const params: unknown[] = [];
    const wheres: string[] = [];
    if (userId) {
      params.push(userId);
      wheres.push(`c.user_id = $${params.length}`);
    }
    if (since) {
      params.push(since);
      wheres.push(`e.occurred_at >= $${params.length}`);
    }
    params.push(limit);

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const rows = await ds.query(
      `SELECT e.id, e.conversation_id, c.user_id, e.turn_index, e.pattern,
              e.site_of_match, e.original_length_chars, e.occurred_at
       FROM output_filter_events e
       JOIN conversations c ON c.id = e.conversation_id
       ${where}
       ORDER BY e.occurred_at DESC
       LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({ events: rows, count: rows.length });
  })
);

// ── GET /api/admin/audit ──────────────────────────────────────────────────────

router.get(
  "/audit",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();

    const since = typeof req.query["since"] === "string" ? req.query["since"] : null;
    const action = typeof req.query["action"] === "string" ? req.query["action"] : null;
    const impersonatorId = typeof req.query["impersonatorId"] === "string" ? req.query["impersonatorId"] : null;
    const targetUserId = typeof req.query["targetUserId"] === "string" ? req.query["targetUserId"] : null;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 500);

    const params: unknown[] = [];
    const wheres: string[] = [];
    if (since) { params.push(since); wheres.push(`occurred_at >= $${params.length}`); }
    if (action) { params.push(action); wheres.push(`action_type = $${params.length}`); }
    if (impersonatorId) { params.push(impersonatorId); wheres.push(`actor_admin_id = $${params.length}`); }
    if (targetUserId) { params.push(targetUserId); wheres.push(`target_user_id = $${params.length}`); }
    params.push(limit);

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const rows = await ds.query(
      `SELECT id, actor_admin_id, action_type, target_user_id, args_json,
              result_status, request_id, ip_address, occurred_at
       FROM admin_audit_log
       ${where}
       ORDER BY occurred_at DESC
       LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({
      events: rows.map((r) => ({
        id: r["id"],
        actorAdminId: r["actor_admin_id"],
        actionType: r["action_type"],
        targetUserId: r["target_user_id"] ?? null,
        argsJson: r["args_json"] ?? null,
        resultStatus: r["result_status"],
        requestId: r["request_id"],
        // Never return raw IP — return null (already hashed at write time for impersonation)
        occurredAt: r["occurred_at"],
      })),
      count: rows.length,
    });
  })
);

// ── GET /api/admin/conversations ─────────────────────────────────────────────
// Admin observability for chat conversations (C2.4).

router.get(
  "/conversations",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();

    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const channel = typeof req.query["channel"] === "string" ? req.query["channel"] : null;
    const terminationReason = typeof req.query["terminationReason"] === "string" ? req.query["terminationReason"] : null;
    const since = typeof req.query["since"] === "string" ? req.query["since"] : null;
    const until = typeof req.query["until"] === "string" ? req.query["until"] : null;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const params: unknown[] = [];
    const wheres: string[] = [];
    if (userId) { params.push(userId); wheres.push(`user_id = $${params.length}`); }
    if (channel) { params.push(channel); wheres.push(`channel = $${params.length}`); }
    if (terminationReason) { params.push(terminationReason); wheres.push(`termination_reason = $${params.length}`); }
    if (since) { params.push(since); wheres.push(`started_at >= $${params.length}`); }
    if (until) { params.push(until); wheres.push(`started_at < $${params.length}`); }
    params.push(limit);

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const rows = await ds.query(
      `SELECT id, user_id, channel, started_at, ended_at, turn_count,
              total_tokens_in, total_tokens_out, total_cost_usd,
              termination_reason, tool_call_count, model
         FROM conversations ${where}
         ORDER BY started_at DESC
         LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({ conversations: rows, count: rows.length });
  })
);

export default router;
