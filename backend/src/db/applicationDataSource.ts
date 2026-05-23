import "reflect-metadata";
import { promises as fs } from "fs";
import path from "path";
import { DataSource } from "typeorm";
import { JobEntitySchema } from "./entities/JobEntity.js";
import { ModelTierAssignmentEntitySchema } from "./entities/ModelTierAssignmentEntity.js";
import { ObservabilityRequestEntitySchema } from "./entities/ObservabilityRequestEntity.js";
import { StepLifecycleEventEntitySchema } from "./entities/StepLifecycleEventEntity.js";
import { StepWorkItemEntitySchema } from "./entities/StepWorkItemEntity.js";
import { TickerWorkItemEntitySchema } from "./entities/TickerWorkItemEntity.js";
import { TrackedAssetEntitySchema } from "./entities/TrackedAssetEntity.js";
import { UserPointsBudgetEntitySchema } from "./entities/UserPointsBudgetEntity.js";
import { UserEntitySchema } from "./entities/UserEntity.js";
import { StrategyEntitySchema } from "./entities/StrategyEntity.js";
import { ReportBatchEntitySchema } from "./entities/ReportBatchEntity.js";
import { ReportIndexEntitySchema } from "./entities/ReportIndexEntity.js";
import { NotificationEntitySchema } from "./entities/NotificationEntity.js";
import { EscalationHistoryEntitySchema } from "./entities/EscalationHistoryEntity.js";
import { VerdictActionEntitySchema } from "./entities/VerdictActionEntity.js";
import { TickerSnoozeEntitySchema } from "./entities/TickerSnoozeEntity.js";
import { PortfolioRiskSnapshotEntitySchema } from "./entities/PortfolioRiskSnapshotEntity.js";
import { AdminAuditLogEntitySchema } from "./entities/AdminAuditLogEntity.js";
import { FeatureFlagEntitySchema } from "./entities/FeatureFlagEntity.js";
import { ChannelBindingEntitySchema } from "./entities/ChannelBindingEntity.js";
import { EncryptedSecretEntitySchema } from "./entities/EncryptedSecretEntity.js";
import { ConversationEntitySchema } from "./entities/ConversationEntity.js";
import { ConversationTurnEntitySchema } from "./entities/ConversationTurnEntity.js";
import { ToolCallEntitySchema } from "./entities/ToolCallEntity.js";
import { OutputFilterEventEntitySchema } from "./entities/OutputFilterEventEntity.js";
import { PositionTransactionEntitySchema } from "./entities/PositionTransactionEntity.js";
import { CorporateActionEntitySchema } from "./entities/CorporateActionEntity.js";
import { PilotFeatureReviewEntitySchema } from "./entities/PilotFeatureReviewEntity.js";
import { ImpersonationSessionEntitySchema } from "./entities/ImpersonationSessionEntity.js";
import { logger } from "../services/logger.js";

const APP_DATABASE_URL =
  process.env["APP_DATABASE_URL"] ??
  process.env["OBSERVABILITY_DATABASE_URL"] ??
  "";
const APP_DATABASE_DDL_PATH =
  process.env["APP_DATABASE_DDL_PATH"] ??
  process.env["OBSERVABILITY_DDL_PATH"] ??
  path.resolve(process.cwd(), "../db/application_postgres.sql");

let dataSource: DataSource | null = null;
let ddlApplied = false;

export function isApplicationDatabaseConfigured(): boolean {
  return APP_DATABASE_URL.length > 0;
}

function buildDataSource(): DataSource {
  if (!APP_DATABASE_URL) {
    throw new Error("APP_DATABASE_URL is required");
  }

  const urlWithoutSsl = APP_DATABASE_URL
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]uselibpqcompat=[^&]*/g, "")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");

  return new DataSource({
    type: "postgres",
    url: urlWithoutSsl,
    ssl: false,
    extra: { ssl: false },
    entities: [
      JobEntitySchema,
      ModelTierAssignmentEntitySchema,
      ObservabilityRequestEntitySchema,
      StepLifecycleEventEntitySchema,
      StepWorkItemEntitySchema,
      TickerWorkItemEntitySchema,
      TrackedAssetEntitySchema,
      UserPointsBudgetEntitySchema,
      // Phase 1 (design.md §4.1–4.17):
      UserEntitySchema,
      StrategyEntitySchema,
      ReportBatchEntitySchema,
      ReportIndexEntitySchema,
      NotificationEntitySchema,
      EscalationHistoryEntitySchema,
      VerdictActionEntitySchema,
      TickerSnoozeEntitySchema,
      PortfolioRiskSnapshotEntitySchema,
      AdminAuditLogEntitySchema,
      FeatureFlagEntitySchema,
      ChannelBindingEntitySchema,
      EncryptedSecretEntitySchema,
      // Phase 5 (design.md §4.11–4.12):
      ConversationEntitySchema,
      ConversationTurnEntitySchema,
      ToolCallEntitySchema,
      OutputFilterEventEntitySchema,
      // Phase 7 (design.md §4.6–4.7):
      PositionTransactionEntitySchema,
      CorporateActionEntitySchema,
      // Pilot admin review state:
      PilotFeatureReviewEntitySchema,
      // S07 — read-only user impersonation sessions:
      ImpersonationSessionEntitySchema,
    ],
    synchronize: false,
    logging: false,
  });
}

/**
 * Applies the full DDL file once per backend process on first DB connect.
 * The file is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS); statements
 * you append on deploy are executed on the next startup, while older statements no-op.
 */
async function applyDdl(ds: DataSource): Promise<void> {
  if (ddlApplied) return;
  const ddl = await fs.readFile(APP_DATABASE_DDL_PATH, "utf-8");
  await ds.query(ddl);
  ddlApplied = true;
  logger.info(`Applied application DDL from ${APP_DATABASE_DDL_PATH}`);
}

export async function getApplicationDataSource(): Promise<DataSource> {
  if (!dataSource) {
    dataSource = buildDataSource();
  }

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
    await applyDdl(dataSource);
    logger.info("Application PostgreSQL data source initialized");
  }

  return dataSource;
}

export async function closeApplicationDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }
  dataSource = null;
  ddlApplied = false;
}
