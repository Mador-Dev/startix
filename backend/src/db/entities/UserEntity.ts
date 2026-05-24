import { EntitySchema } from "typeorm";

export type UserState = "INCOMPLETE" | "BOOTSTRAPPING" | "ACTIVE" | "BLOCKED";
export type UserModelTier = "free" | "cheap" | "balanced" | "expensive";
export type UserLotMethod = "fifo" | "lifo" | "specific_lot";
export type UserRestriction = "readonly" | "blocked" | "suspended" | null;

export interface UserScheduleJson {
  dailyBriefTime: string;
  weeklyResearchDay: string;
  weeklyResearchTime: string;
  timezone: string;
}

export interface UserEntity {
  userId: string;
  displayName: string;
  passwordHash: string;
  tokenVersion: number;
  schedule: UserScheduleJson;
  rateLimits: Record<string, unknown>;
  modelTier: UserModelTier;
  modelProfile: string;
  lotMethod: UserLotMethod;
  maxSinglePositionPct: string;
  stopLossThresholdPct: string;
  state: UserState;
  restriction: UserRestriction;
  /** Current available points balance — updated atomically on every deduction and credit. */
  points: string;
  /** Timestamp of the last daily replenishment; used to gate the once-per-day reset. */
  pointsReplenishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const UserEntitySchema = new EntitySchema<UserEntity>({
  name: "User",
  tableName: "users",
  columns: {
    userId: {
      name: "user_id",
      type: "varchar",
      length: 64,
      primary: true,
    },
    displayName: { name: "display_name", type: "varchar", length: 128 },
    passwordHash: { name: "password_hash", type: "varchar", length: 128 },
    tokenVersion: { name: "token_version", type: "integer", default: 0 },
    schedule: { type: "jsonb" },
    rateLimits: { name: "rate_limits", type: "jsonb" },
    modelTier: { name: "model_tier", type: "varchar", length: 32 },
    modelProfile: { name: "model_profile", type: "varchar", length: 64 },
    lotMethod: { name: "lot_method", type: "varchar", length: 16 },
    maxSinglePositionPct: {
      name: "max_single_position_pct",
      type: "numeric",
      precision: 5,
      scale: 2,
    },
    stopLossThresholdPct: {
      name: "stop_loss_threshold_pct",
      type: "numeric",
      precision: 5,
      scale: 2,
    },
    state: { type: "varchar", length: 32 },
    restriction: { type: "varchar", length: 32, nullable: true },
    points: {
      type: "numeric",
      precision: 12,
      scale: 3,
      default: 500,
    },
    pointsReplenishedAt: {
      name: "points_replenished_at",
      type: "timestamptz",
      nullable: true,
    },
    createdAt: { name: "created_at", type: "timestamptz" },
    updatedAt: { name: "updated_at", type: "timestamptz" },
  },
});
