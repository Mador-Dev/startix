import { EntitySchema } from "typeorm";

export type StrategyAssetScope = "portfolio" | "tracking";
export type StrategyVerdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";
export type StrategyConfidence = "high" | "medium" | "low";
export type StrategyAssetClass =
  | "equity"
  | "etf"
  | "bond"
  | "fund"
  | "crypto"
  | "index"
  | "other";

export interface StrategyCatalystJson {
  description: string;
  expiresAt: string | null;
  triggered: boolean;
}

export interface StrategyEntity {
  userId: string;
  ticker: string;
  version: number;
  assetScope: StrategyAssetScope;
  trackingStatus: string | null;
  verdict: StrategyVerdict;
  confidence: StrategyConfidence;
  reasoning: string;
  timeframe: string;
  positionSizeIls: string;
  positionWeightPct: string;
  entryConditions: string[];
  exitConditions: string[];
  catalysts: StrategyCatalystJson[];
  bullCase: string | null;
  bearCase: string | null;
  lastDeepDiveAt: Date | null;
  deepDiveTriggeredBy: string | null;
  metadata: Record<string, unknown>;
  stance: string | null;
  potentialScore: string | null;
  urgencyScore: string | null;
  urgencyLabel: string | null;
  portfolioFitScore: string | null;
  suggestedAllocationPct: string | null;
  suggestedAllocationIls: string | null;
  actionCatalysts: unknown[];
  avoidConditions: string[];
  nextReviewAt: Date | null;
  assetClass: StrategyAssetClass;
  derivedFromRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const StrategyEntitySchema = new EntitySchema<StrategyEntity>({
  name: "Strategy",
  tableName: "strategies",
  columns: {
    userId: { name: "user_id", type: "varchar", length: 64, primary: true },
    ticker: { type: "varchar", length: 32, primary: true },
    version: { type: "integer", default: 1 },
    assetScope: { name: "asset_scope", type: "varchar", length: 16 },
    trackingStatus: { name: "tracking_status", type: "varchar", length: 16, nullable: true },
    verdict: { type: "varchar", length: 16 },
    confidence: { type: "varchar", length: 8 },
    reasoning: { type: "text" },
    timeframe: { type: "varchar", length: 16 },
    positionSizeIls: { name: "position_size_ils", type: "numeric", precision: 18, scale: 2 },
    positionWeightPct: { name: "position_weight_pct", type: "numeric", precision: 7, scale: 4 },
    entryConditions: { name: "entry_conditions", type: "jsonb" },
    exitConditions: { name: "exit_conditions", type: "jsonb" },
    catalysts: { type: "jsonb" },
    bullCase: { name: "bull_case", type: "text", nullable: true },
    bearCase: { name: "bear_case", type: "text", nullable: true },
    lastDeepDiveAt: { name: "last_deep_dive_at", type: "timestamptz", nullable: true },
    deepDiveTriggeredBy: { name: "deep_dive_triggered_by", type: "varchar", length: 64, nullable: true },
    metadata: { type: "jsonb" },
    stance: { type: "varchar", length: 16, nullable: true },
    potentialScore: { name: "potential_score", type: "numeric", precision: 6, scale: 2, nullable: true },
    urgencyScore: { name: "urgency_score", type: "numeric", precision: 6, scale: 2, nullable: true },
    urgencyLabel: { name: "urgency_label", type: "varchar", length: 16, nullable: true },
    portfolioFitScore: { name: "portfolio_fit_score", type: "numeric", precision: 6, scale: 2, nullable: true },
    suggestedAllocationPct: { name: "suggested_allocation_pct", type: "numeric", precision: 7, scale: 4, nullable: true },
    suggestedAllocationIls: { name: "suggested_allocation_ils", type: "numeric", precision: 18, scale: 2, nullable: true },
    actionCatalysts: { name: "action_catalysts", type: "jsonb" },
    avoidConditions: { name: "avoid_conditions", type: "jsonb" },
    nextReviewAt: { name: "next_review_at", type: "timestamptz", nullable: true },
    assetClass: { name: "asset_class", type: "varchar", length: 16 },
    derivedFromRunId: { name: "derived_from_run_id", type: "uuid", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
    updatedAt: { name: "updated_at", type: "timestamptz" },
  },
});
