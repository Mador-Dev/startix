import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { PortfolioStateSchema } from "../schemas/portfolio.js";
import type { PortfolioState, PortfolioStateData } from "../types/index.js";
import type { RateLimits } from "../types/index.js";
import { DEFAULT_RATE_LIMITS } from "../types/index.js";
import { logger } from "./logger.js";

export interface UserAuthRecord {
  passwordHash: string;
  tokenVersion: number;
}

function requireDatabase(): void {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("APP_DATABASE_URL is required for user state");
  }
}

const DEFAULT_LIFECYCLE = {
  lastFullReportAt: null,
  lastDailyAt: null,
  pendingDeepDives: [] as string[],
  bootstrapProgress: null,
  onboarding: {
    portfolioSubmittedAt: null,
    positionGuidanceStatus: "not_started" as const,
    positionGuidance: {},
  },
};

export async function ensureUserRecord(
  userId: string,
  options?: {
    displayName?: string;
    passwordHash?: string;
    schedule?: Record<string, unknown>;
  }
): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ds.query(
    `INSERT INTO users (
       user_id, display_name, password_hash, token_version, schedule, lifecycle, state, model_profile, plan, points
     ) VALUES ($1, $2, $3, 0, $4::jsonb, $5::jsonb, 'INCOMPLETE', 'testing', 'pro', 500)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
       schedule = CASE
         WHEN EXCLUDED.schedule::text <> '{}'::text THEN EXCLUDED.schedule
         ELSE users.schedule
       END,
       updated_at = NOW()`,
    [
      userId,
      options?.displayName ?? userId,
      options?.passwordHash ?? "",
      JSON.stringify(
        options?.schedule ?? {
          dailyBriefTime: "08:00",
          weeklyResearchDay: "sunday",
          weeklyResearchTime: "19:00",
          timezone: "Asia/Jerusalem",
        }
      ),
      JSON.stringify(DEFAULT_LIFECYCLE),
    ]
  );
}

export async function readUserAuth(userId: string): Promise<UserAuthRecord | null> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT password_hash, token_version FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ password_hash: string; token_version: number }>;
  if (!rows[0]?.password_hash) return null;
  return {
    passwordHash: rows[0].password_hash,
    tokenVersion: rows[0].token_version ?? 0,
  };
}

export async function writeUserAuth(userId: string, auth: UserAuthRecord): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId, { passwordHash: auth.passwordHash });
  await ds.query(
    `UPDATE users SET
       password_hash = $2,
       token_version = $3,
       updated_at = NOW()
     WHERE user_id = $1`,
    [userId, auth.passwordHash, auth.tokenVersion]
  );
}

export async function getTokenVersion(userId: string): Promise<number> {
  const auth = await readUserAuth(userId);
  return auth?.tokenVersion ?? 0;
}

export async function incrementTokenVersion(userId: string): Promise<number> {
  const current = await getTokenVersion(userId);
  const auth = (await readUserAuth(userId)) ?? { passwordHash: "", tokenVersion: 0 };
  const next = current + 1;
  await writeUserAuth(userId, { ...auth, tokenVersion: next });
  logger.info(`Incremented tokenVersion for ${userId}: now ${next}`);
  return next;
}

export async function getUserRateLimits(userId: string): Promise<RateLimits> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT rate_limits FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ rate_limits: Partial<RateLimits> | null }>;
  const stored = rows[0]?.rate_limits;
  if (stored && typeof stored === "object") {
    return { ...DEFAULT_RATE_LIMITS, ...stored };
  }
  return DEFAULT_RATE_LIMITS;
}

export async function getUserModelTier(userId: string): Promise<string | null> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT model_tier FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ model_tier: string }>;
  return rows[0]?.model_tier ?? null;
}

export async function getUserModelProfile(userId: string): Promise<string> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT model_profile FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ model_profile: string }>;
  return rows[0]?.model_profile ?? "testing";
}

export async function setUserModelProfile(userId: string, modelProfile: string): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId);
  await ds.query(
    `UPDATE users SET model_profile = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, modelProfile]
  );
}

export async function getUserPlan(userId: string): Promise<string> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT plan FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ plan: string }>;
  return rows[0]?.plan ?? "pro";
}

export async function setUserPlan(userId: string, plan: string): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId);
  await ds.query(`UPDATE users SET plan = $2, updated_at = NOW() WHERE user_id = $1`, [userId, plan]);
}

export async function readUserState(userId: string): Promise<PortfolioStateData> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT state, lifecycle FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ state: PortfolioState; lifecycle: Record<string, unknown> | null }>;

  if (!rows[0]) {
    return {
      userId,
      state: "INCOMPLETE",
      ...DEFAULT_LIFECYCLE,
    };
  }

  const lifecycleRaw = rows[0].lifecycle ?? {};
  const merged = {
    userId,
    state:
      (rows[0].state as string) === "UNINITIALIZED"
        ? "INCOMPLETE"
        : rows[0].state,
    lastFullReportAt:
      typeof lifecycleRaw["lastFullReportAt"] === "string" ? lifecycleRaw["lastFullReportAt"] : null,
    lastDailyAt: typeof lifecycleRaw["lastDailyAt"] === "string" ? lifecycleRaw["lastDailyAt"] : null,
    pendingDeepDives: Array.isArray(lifecycleRaw["pendingDeepDives"])
      ? (lifecycleRaw["pendingDeepDives"] as string[])
      : [],
    bootstrapProgress:
      lifecycleRaw["bootstrapProgress"] && typeof lifecycleRaw["bootstrapProgress"] === "object"
        ? (lifecycleRaw["bootstrapProgress"] as PortfolioStateData["bootstrapProgress"])
        : null,
    onboarding:
      lifecycleRaw["onboarding"] && typeof lifecycleRaw["onboarding"] === "object"
        ? (lifecycleRaw["onboarding"] as PortfolioStateData["onboarding"])
        : DEFAULT_LIFECYCLE.onboarding,
  };

  const result = PortfolioStateSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid user lifecycle for ${userId}: ${result.error.message}`);
  }
  return result.data as PortfolioStateData;
}

export async function writeUserState(
  userId: string,
  update: Partial<PortfolioStateData>
): Promise<void> {
  requireDatabase();
  const current = await readUserState(userId);
  const merged: PortfolioStateData = { ...current, ...update, userId };
  const result = PortfolioStateSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid user state after merge: ${result.error.message}`);
  }

  const data = result.data;
  const lifecycle = {
    lastFullReportAt: data.lastFullReportAt,
    lastDailyAt: data.lastDailyAt,
    pendingDeepDives: data.pendingDeepDives ?? [],
    bootstrapProgress: data.bootstrapProgress,
    onboarding: data.onboarding,
  };

  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId);
  await ds.query(
    `UPDATE users SET
       state = $2,
       lifecycle = $3::jsonb,
       updated_at = NOW()
     WHERE user_id = $1`,
    [userId, data.state, JSON.stringify(lifecycle)]
  );
}

export async function setUserModelTier(userId: string, modelTier: string): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId);
  await ds.query(
    `UPDATE users SET model_tier = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, modelTier]
  );
}

export async function updateUserSchedule(
  userId: string,
  schedule: Record<string, unknown>
): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId);
  await ds.query(
    `UPDATE users SET schedule = $2::jsonb, updated_at = NOW() WHERE user_id = $1`,
    [userId, JSON.stringify(schedule)]
  );
}

export async function updateUserDisplayName(userId: string, displayName: string): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ensureUserRecord(userId);
  await ds.query(
    `UPDATE users SET display_name = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, displayName.slice(0, 128)]
  );
}

export async function listUserIds(): Promise<string[]> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(`SELECT user_id FROM users ORDER BY user_id`)) as Array<{
    user_id: string;
  }>;
  return rows.map((r) => r.user_id);
}

export async function userExists(userId: string): Promise<boolean> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT 1 FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as unknown[];
  return rows.length > 0;
}

export async function getUserOnboardingProfile(userId: string): Promise<{
  displayName: string;
  schedule: Record<string, unknown>;
} | null> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT display_name, schedule FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ display_name: string; schedule: Record<string, unknown> }>;
  if (!rows[0]) return null;
  return { displayName: rows[0].display_name, schedule: rows[0].schedule ?? {} };
}
