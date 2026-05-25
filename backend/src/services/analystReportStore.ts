import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

function requireDatabase(): void {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("APP_DATABASE_URL is required for analyst reports");
  }
}

export async function readLatestAnalystReport(
  userId: string,
  ticker: string,
  analystType: string
): Promise<unknown | null> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT payload FROM analyst_reports
     WHERE user_id = $1 AND ticker = $2 AND analyst_type = $3
     ORDER BY generated_at DESC LIMIT 1`,
    [userId, ticker.toUpperCase(), analystType]
  )) as Array<{ payload: unknown }>;
  return rows[0]?.payload ?? null;
}

export async function listLatestAnalystReports(
  userId: string,
  ticker: string
): Promise<Array<{ analystType: string; payload: unknown; generatedAt: string }>> {
  requireDatabase();
  const ds = await getApplicationDataSource();
  interface Row { analyst_type: string; payload: unknown; generated_at: Date | string }
  const rows = (await ds.query(
    `SELECT DISTINCT ON (analyst_type) analyst_type, payload, generated_at
     FROM analyst_reports
     WHERE user_id = $1 AND ticker = $2
     ORDER BY analyst_type, generated_at DESC`,
    [userId, ticker.toUpperCase()]
  )) as Row[];
  return rows.map((r) => ({
    analystType: r.analyst_type,
    payload: r.payload,
    generatedAt: r.generated_at instanceof Date ? r.generated_at.toISOString() : String(r.generated_at),
  }));
}
