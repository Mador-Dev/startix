import path from "path";
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { PortfolioStateSchema } from "../schemas/portfolio.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { PositionGuidance } from "../types/index.js";
import { resolveConfiguredPath } from "./paths.js";
import { readState, writeState } from "./stateService.js";
import { writePortfolio } from "./portfolioStore.js";
import { ensureUserRecord } from "./userStore.js";
import { writePersonaMd } from "./personaStore.js";
import { isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const USER_WORKSPACE_TEMPLATE_DIR = resolveConfiguredPath(
  process.env["USER_WORKSPACE_TEMPLATE_DIR"] ?? process.env["USER_AGENT_TEMPLATE_DIR"],
  "../shared/user-workspace"
);
const USER_WORKSPACE_MANIFEST_PATH = path.join(
  USER_WORKSPACE_TEMPLATE_DIR,
  "manifest.json"
);

interface WorkspaceTemplateManifest {
  sharedFiles: string[];
  templatedFiles: Array<{
    source: string;
    target: string;
  }>;
  emptyFiles: string[];
}

export class WorkspaceNotFoundError extends Error {
  constructor(userId: string) {
    super(`Workspace not found: ${userId}`);
    this.name = "WorkspaceNotFoundError";
  }
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadWorkspaceTemplateManifest(): Promise<WorkspaceTemplateManifest> {
  const RETIRED_SHARED_FILES = new Set<string>();

  const fallback: WorkspaceTemplateManifest = {
    sharedFiles: [],
    templatedFiles: [{ source: "USER.md.template", target: "USER.md" }],
    emptyFiles: [],
  };

  const manifest = await safeReadJson<WorkspaceTemplateManifest>(
    USER_WORKSPACE_MANIFEST_PATH
  );
  if (!manifest) {
    logger.warn(
      `Workspace template manifest missing or invalid at ${USER_WORKSPACE_MANIFEST_PATH}; using fallback defaults`
    );
    return fallback;
  }

  return {
    sharedFiles: Array.isArray(manifest.sharedFiles)
      ? manifest.sharedFiles.filter((f) => !RETIRED_SHARED_FILES.has(f))
      : fallback.sharedFiles,
    templatedFiles: Array.isArray(manifest.templatedFiles)
      ? manifest.templatedFiles
      : fallback.templatedFiles,
    emptyFiles: Array.isArray(manifest.emptyFiles)
      ? manifest.emptyFiles.filter((f) => !RETIRED_SHARED_FILES.has(f))
      : fallback.emptyFiles,
  };
}

function renderWorkspaceTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(key, value);
  }
  return rendered;
}


export async function workspaceExists(userId: string): Promise<boolean> {
  const { userExists } = await import("./userStore.js");
  return userExists(userId);
}

/**
 * Ensure a signed-in user has a Postgres-backed workspace row.
 * Safe to call on every authenticated request (no-op when already provisioned).
 */
export async function ensureUserProvisioned(
  userId: string,
  options?: { displayName?: string }
): Promise<{ created: boolean }> {
  if (!isApplicationDatabaseConfigured()) {
    return { created: false };
  }

  const { userExists } = await import("./userStore.js");
  if (await userExists(userId)) {
    if (options?.displayName) {
      const { updateUserDisplayName } = await import("./userStore.js");
      await updateUserDisplayName(userId, options.displayName);
    }
    return { created: false };
  }

  if (options?.displayName) {
    await createUserWorkspace(userId);
    const { updateUserDisplayName } = await import("./userStore.js");
    await updateUserDisplayName(userId, options.displayName);
  } else {
    await createUserWorkspace(userId);
  }

  return { created: true };
}

export async function getWorkspace(userId: string): Promise<UserWorkspace> {
  await ensureUserProvisioned(userId);
  if (isApplicationDatabaseConfigured()) {
    const { userExists } = await import("./userStore.js");
    if (!(await userExists(userId))) {
      throw new WorkspaceNotFoundError(userId);
    }
  }
  return buildWorkspace(userId, USERS_DIR);
}

export async function listWorkspaceUserIds(): Promise<string[]> {
  const { listUserIds } = await import("./userStore.js");
  return listUserIds();
}

export async function createUserWorkspace(
  userId: string
): Promise<UserWorkspace> {
  const { userExists } = await import("./userStore.js");
  if (await userExists(userId)) {
    throw new Error(`Workspace already exists for user: ${userId}`);
  }

  const ws = buildWorkspace(userId, USERS_DIR);
  const templateManifest = await loadWorkspaceTemplateManifest();

  await ensureUserRecord(userId, { displayName: userId });
  await writeState(userId, {
    state: "INCOMPLETE",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "not_started",
      positionGuidance: {},
    },
  });

  let personaMd = [
    "# Investor Profile",
    `# Generated: ${new Date().toISOString()}`,
    "",
    "## Risk profile",
    "riskTolerance: medium",
  ].join("\n");

  for (const templateFile of templateManifest.templatedFiles) {
    if (templateFile.target !== "USER.md") continue;
    try {
      const templatePath = path.join(USER_WORKSPACE_TEMPLATE_DIR, templateFile.source);
      const template = await fs.readFile(templatePath, "utf-8");
      personaMd = renderWorkspaceTemplate(template, {
        "[DISPLAY_NAME]": userId,
        "[DATE]": new Date().toISOString(),
      });
    } catch (err) {
      logger.warn(`Could not render USER.md template for ${userId}: ${err}`);
    }
  }

  await writePersonaMd(userId, personaMd);
  logger.info(`Provisioned Postgres-backed user record: ${userId}`);
  return ws;
}

export async function saveUserPortfolio(
  userId: string,
  portfolio: unknown
): Promise<void> {
  const parsed = PortfolioFileSchema.safeParse(portfolio);
  if (!parsed.success) {
    throw new Error(
      `Invalid portfolio: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
    );
  }

  await writePortfolio(userId, parsed.data);

  const currentState = await readState(userId);
  const validTickers = new Set(
    Object.values(parsed.data.accounts).flat().map((position) => position.ticker)
  );
  const preservedGuidance = Object.fromEntries(
    Object.entries(currentState.onboarding.positionGuidance).filter(([ticker]) => validTickers.has(ticker))
  ) as Record<string, PositionGuidance>;

  await writeState(userId, {
    state: "INCOMPLETE",
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: new Date().toISOString(),
      positionGuidanceStatus: "pending",
      positionGuidance: preservedGuidance,
    },
  });
}


export async function startUserBootstrap(
  userId: string
): Promise<{ totalPositions: number }> {
  const currentState = await readState(userId);
  const { readPortfolio } = await import("./portfolioStore.js");
  const stored = await readPortfolio(userId);
  if (!stored) throw new Error("portfolio not found");
  const portfolio = PortfolioFileSchema.parse(stored);

  const uniquePositions = new Map<string, { ticker: string; exchange: string }>();
  for (const positions of Object.values(portfolio.accounts)) {
    for (const pos of positions) {
      if (!uniquePositions.has(pos.ticker)) {
        uniquePositions.set(pos.ticker, { ticker: pos.ticker, exchange: pos.exchange });
      }
    }
  }

  logger.info(`Initialized portfolio for user ${userId}: ${uniquePositions.size} unique tickers`);

  await writeState(userId, {
    state: "BOOTSTRAPPING",
    bootstrapProgress: {
      total: uniquePositions.size,
      completed: 0,
      completedTickers: [],
    },
    onboarding: {
      ...currentState.onboarding,
      positionGuidanceStatus:
        currentState.onboarding.positionGuidanceStatus === "skipped" ? "skipped" : "completed",
    },
  });
  logger.info(`State transition: INCOMPLETE → BOOTSTRAPPING | reason=bootstrap_started`);
  return { totalPositions: uniquePositions.size };
}

export interface WorkspaceReconciliationResult {
  userId: string;
  checkedAt: string;
  archivedTickers: string[];
  archivedReports: string[];
  removedPendingDeepDives: string[];
  changed: boolean;
}

export async function reconcileWorkspaceIntegrity(
  userId: string
): Promise<WorkspaceReconciliationResult> {
  const checkedAt = new Date().toISOString();

  const result: WorkspaceReconciliationResult = {
    userId,
    checkedAt,
    archivedTickers: [],
    archivedReports: [],
    removedPendingDeepDives: [],
    changed: false,
  };

  const { readPortfolio } = await import("./portfolioStore.js");
  const stored = await readPortfolio(userId).catch(() => null);
  const parsedPortfolio = stored ? PortfolioFileSchema.safeParse(stored) : null;
  if (!parsedPortfolio?.success) {
    return result;
  }

  const validTickers = new Set<string>();
  for (const positions of Object.values(parsedPortfolio.data.accounts)) {
    for (const position of positions) {
      validTickers.add(position.ticker);
    }
  }

  const currentState = await readState(userId);

  const { listStrategies } = await import("./strategyStore.js");
  const strategies = await listStrategies(userId).catch(() => []);
  const knownTickerData = new Set(validTickers);
  for (const s of strategies) {
    knownTickerData.add(s.ticker);
  }

  const nextPendingDeepDives = currentState.pendingDeepDives.filter((ticker) =>
    knownTickerData.has(ticker)
  );
  if (nextPendingDeepDives.length !== currentState.pendingDeepDives.length) {
    result.removedPendingDeepDives = currentState.pendingDeepDives.filter(
      (ticker) => !knownTickerData.has(ticker)
    );
    await writeState(userId, {
      pendingDeepDives: nextPendingDeepDives,
    });
  }

  result.changed = result.removedPendingDeepDives.length > 0;

  if (result.changed) {
    logger.info(
      `Reconciled workspace integrity for ${userId}: removedPendingDeepDives=${result.removedPendingDeepDives.join(",") || "none"}`
    );
  }

  return result;
}

export interface IntegrityResult {
  userId: string;
  checkedAt: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateWorkspaceIntegrity(
  userId: string
): Promise<IntegrityResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkedAt = new Date().toISOString();

  const { userExists } = await import("./userStore.js");
  if (!(await userExists(userId))) {
    errors.push("User does not exist in database");
    return { userId, checkedAt, valid: false, errors, warnings };
  }

  const { readPortfolio } = await import("./portfolioStore.js");
  const portfolio = await readPortfolio(userId).catch(() => null);
  if (!portfolio) {
    errors.push("portfolio missing or invalid in database");
  } else {
    const pfResult = PortfolioFileSchema.safeParse(portfolio);
    if (!pfResult.success) {
      errors.push(
        `portfolio schema error: ${pfResult.error.errors.map((e) => e.message).join("; ")}`
      );
    }
  }

  try {
    const state = await readState(userId);
    const stResult = PortfolioStateSchema.safeParse(state);
    if (!stResult.success) {
      errors.push(
        `user lifecycle schema error: ${stResult.error.errors.map((e) => e.message).join("; ")}`
      );
    }
  } catch (err) {
    errors.push(`user state unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const portfolioTickers = new Set<string>();
  if (portfolio) {
    const pfResult = PortfolioFileSchema.safeParse(portfolio);
    if (pfResult.success) {
      for (const positions of Object.values(pfResult.data.accounts)) {
        for (const pos of positions) {
          portfolioTickers.add(pos.ticker);
        }
      }
    }
  }

  const { listStrategies } = await import("./strategyStore.js");
  const strategies = await listStrategies(userId).catch(() => []);
  const strategyTickers = new Set(strategies.map((s) => s.ticker));

  for (const ticker of strategyTickers) {
    if (!portfolioTickers.has(ticker)) {
      warnings.push(`strategy exists for ${ticker} but ticker not in portfolio`);
    }
  }

  for (const ticker of portfolioTickers) {
    if (!strategyTickers.has(ticker)) {
      warnings.push(`portfolio ticker ${ticker} has no strategy in database`);
    }
  }

  const { readPersonaMd } = await import("./personaStore.js");
  const personaMd = await readPersonaMd(userId).catch(() => null);
  if (!personaMd) {
    warnings.push("persona_md missing — investor profile not configured");
  }

  const valid = errors.length === 0;

  if (valid) {
    logger.info(`Integrity check passed for user: ${userId}`);
  } else {
    logger.warn(`Integrity check failed for user ${userId}: ${errors.join("; ")}`);
  }

  return { userId, checkedAt, valid, errors, warnings };
}
