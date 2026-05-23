import type { Request, Response, NextFunction } from "express";
import { ensureUserProvisioned } from "../services/workspaceService.js";
import { logger } from "../services/logger.js";

/**
 * After Clerk auth, create the user's DB workspace on first request if missing.
 */
export async function ensureUserProvisionedMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = res.locals["userId"] as string | undefined;
  if (!userId) {
    next();
    return;
  }

  try {
    await ensureUserProvisioned(userId);
    next();
  } catch (err) {
    logger.error(
      `Failed to provision user ${userId}: ${err instanceof Error ? err.message : String(err)}`
    );
    next(err);
  }
}
