import type { Request, Response, NextFunction } from "express";
import path from "path";
import { resolveConfiguredPath } from "../services/paths.js";

export class WorkspaceViolationError extends Error {
  constructor(
    public readonly userId: string,
    public readonly attemptedPath: string,
    public readonly workspaceRoot: string
  ) {
    super(
      `Workspace violation: user ${userId} attempted ${attemptedPath} outside ${workspaceRoot}`
    );
    this.name = "WorkspaceViolationError";
  }
}

export interface UserWorkspace {
  userId: string;
  root: string;
  portfolioFile: string;
  configFile: string;
  stateFile: string;
  tickersDir: string;
  reportsDir: string;
  snapshotsDir: string;
  jobsDir: string;
  triggersDir: string;
  userMdFile: string;
  strategyFile: (ticker: string) => string;
  eventsFile: (ticker: string) => string;
  reportFile: (ticker: string, analyst: string) => string;
  snapshotDir: (batchId: string) => string;
  jobFile: (jobId: string) => string;
}

export function buildWorkspace(userId: string, usersDir: string): UserWorkspace {
  const root = path.resolve(usersDir, userId);
  const dataDir = path.join(root, "data");
  return {
    userId,
    root,
    portfolioFile: path.join(dataDir, "portfolio.json"),
    configFile: path.join(dataDir, "config.json"),
    stateFile: path.join(dataDir, "state.json"),
    tickersDir: path.join(dataDir, "tickers"),
    reportsDir: path.join(dataDir, "reports"),
    snapshotsDir: path.join(dataDir, "reports", "snapshots"),
    jobsDir: path.join(dataDir, "jobs"),
    triggersDir: path.join(dataDir, "triggers"),
    userMdFile: path.join(root, "USER.md"),
    strategyFile: (ticker: string) =>
      path.join(dataDir, "tickers", ticker, "strategy.json"),
    eventsFile: (ticker: string) =>
      path.join(dataDir, "tickers", ticker, "events.jsonl"),
    reportFile: (ticker: string, analyst: string) =>
      path.join(dataDir, "reports", ticker, `${analyst}.json`),
    snapshotDir: (batchId: string) =>
      path.join(dataDir, "reports", "snapshots", batchId),
    jobFile: (jobId: string) => path.join(dataDir, "jobs", `${jobId}.json`),
  };
}

export function guardPath(workspace: UserWorkspace, targetPath: string): void {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(workspace.root)) {
    throw new WorkspaceViolationError(
      workspace.userId,
      resolved,
      workspace.root
    );
  }
}

export async function userIsolationMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = res.locals["userId"] as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const usersDir = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
  const ws = buildWorkspace(userId, usersDir);
  res.locals["workspace"] = ws;
  next();
}
