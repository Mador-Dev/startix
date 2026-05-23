import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { z } from "zod";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { logger } from "./logger.js";
import { ensureUserRecord } from "./userStore.js";

type PortfolioFile = z.infer<typeof PortfolioFileSchema>;

function requireDatabase(): void {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("APP_DATABASE_URL is required for portfolio state");
  }
}

export async function readPortfolio(userId: string): Promise<PortfolioFile | null> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT body FROM user_portfolios WHERE user_id = $1 LIMIT 1`,
    [userId]
  )) as Array<{ body: unknown }>;
  if (!rows[0]?.body) return null;
  const parsed = PortfolioFileSchema.safeParse(rows[0].body);
  if (!parsed.success) {
    logger.warn(`portfolioStore: invalid portfolio for ${userId}: ${parsed.error.message}`);
    return null;
  }
  return parsed.data;
}

export async function writePortfolio(userId: string, portfolio: PortfolioFile): Promise<void> {
  requireDatabase();
  await ensureUserRecord(userId);
  const parsed = PortfolioFileSchema.parse(portfolio);
  const ds = await getApplicationDataSource();
  await ds.query(
    `INSERT INTO user_portfolios (user_id, body, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       body = EXCLUDED.body,
       updated_at = NOW()`,
    [userId, JSON.stringify(parsed)]
  );
}

export async function deletePortfolio(userId: string): Promise<void> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  await ds.query(`DELETE FROM user_portfolios WHERE user_id = $1`, [userId]);
}
