export type Verdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";
export type Confidence = "high" | "medium" | "low";
export type Exchange = "TASE" | "NYSE" | "NASDAQ" | "LSE" | "XETRA" | "EURONEXT" | "OTHER";
export type AssetType = "stock" | "etf" | "crypto" | "fund" | "bond" | "index" | "other";

export interface TickerSelection {
  symbol: string;
  shortName: string;
  exchange: Exchange;
  exchDisp: string;
  flag: string;
  price: number | null;
  currency: string;
  assetType: AssetType;
}

export interface SearchResponse {
  results: TickerSelection[];
  error?: string | null;
}

export interface SupportMessageCreate {
  subject: string;
  message: string;
  source?: string;
  page?: string;
}

export interface SupportMessageRecord extends SupportMessageCreate {
  id: string;
  userId: string;
  createdAt: string;
  status: "open" | "closed";
}
export type JobStatus = "pending" | "paused" | "running" | "completed" | "partial_completed" | "failed" | "cancelled" | "superseded";
export type JobAction =
 | "daily_brief" | "full_report" | "deep_dive"
 | "new_ideas" | "quick_check" | "switch_production" | "switch_testing";
export type PortfolioState = "INCOMPLETE" | "BOOTSTRAPPING" | "ACTIVE" | "BLOCKED";

export type PositionGuidanceHorizon = "unspecified" | "days" | "weeks" | "months" | "years";

export interface PositionGuidance {
 thesis: string;
 horizon: PositionGuidanceHorizon;
 addOn: string;
 reduceOn: string;
 notes: string;
}

export interface PositionRow {
 ticker: string;
 exchange: Exchange;
 shares: number;
 accounts: string[];
 accountBreakdown: Array<{
  account: string;
  shares: number;
  avgPriceILS: number;
 }>;
 avgPriceILS: number;
 livePriceILS: number;
 currentILS: number;
 costILS: number;
 plILS: number;
 plPct: number;
 dayChangeILS: number;
 dayChangePct: number;
 weightPct: number;
 priceStale: boolean;
}

export interface PortfolioResponse {
 updatedAt: string;
 usdIlsRate: number;
 totalILS: number;
 totalCostILS: number;
 totalPlILS: number;
 totalPlPct: number;
 totalDayChangeILS: number;
 totalDayChangePct: number;
 accounts: string[];
 positions: PositionRow[];
}

export interface StrategyCatalyst {
 description: string;
 expiresAt: string | null;
 triggered: boolean;
}

export type StrategyScope = "portfolio" | "tracking";
export type TrackingStatus = "active" | "muted" | "archived";
export type TrackingStance = "candidate" | "watch" | "pass" | "avoid";
export type UrgencyLabel = "low" | "medium" | "high" | "extra_high";

export interface StrategyRow {
 ticker: string;
 inPortfolio: boolean;
 scope?: StrategyScope;
 trackingStatus?: TrackingStatus | null;
 verdict: Verdict;
 confidence: Confidence;
 reasoning: string;
 timeframe: string;
 positionSizeILS: number;
 positionWeightPct: number;
 entryConditions: string[];
 exitConditions: string[];
 catalysts: StrategyCatalyst[];
 actionCatalysts?: StrategyCatalyst[];
 avoidConditions?: string[];
 bullCase?: string | null;
 bearCase?: string | null;
 hasExpiredCatalysts: boolean;
 lastDeepDiveAt: string | null;
 updatedAt: string;
 version: number;
 stance?: TrackingStance | null;
 potentialScore?: number | null;
 urgencyScore?: number | null;
 urgencyLabel?: UrgencyLabel | null;
 portfolioFitScore?: number | null;
 suggestedAllocationPct?: number | null;
 suggestedAllocationILS?: number | null;
 nextReviewAt?: string | null;
}

export interface StrategiesResponse {
 updatedAt: string;
 strategies: StrategyRow[];
}

export interface VerdictRow {
 ticker: string;
 verdict: Verdict;
 confidence: Confidence;
 timeframe: string;
 reasoning: string;
 positionSizeILS: number;
 positionWeightPct: number;
 entryConditions: string[];
 exitConditions: string[];
 catalysts: StrategyCatalyst[];
 lastDeepDiveAt: string | null;
 updatedAt: string;
 hasExpiredCatalysts: boolean;
}

export interface VerdictsResponse {
 updatedAt: string;
 verdicts: VerdictRow[];
}

export interface JobProgress {
 pct: number;
 currentTicker: string | null;
 currentStep: string | null;
 completedTickers: string[];
 remainingTickers: string[];
 totalTickers: number;
 completedSteps: number;
 totalSteps: number;
}

export type JsonValue =
 | string
 | number
 | boolean
 | null
 | JsonValue[]
 | { [key: string]: JsonValue };

export interface Job {
 id: string;
 action: JobAction;
 ticker: string | null;
 status: JobStatus;
 triggered_at: string;
 started_at: string | null;
 completed_at: string | null;
 result: JsonValue;
 error: string | null;
 progress?: JobProgress | null;
}

export interface JobsResponse { jobs: Job[]; }
export interface TriggerResponse { jobId: string; job: Job; }

export interface TickerConditionResult {
 ticker: string;
 needsEscalation: boolean;
 escalationReasons: string[];
 escalationDetails: string[];
 lastDeepDiveAt: string | null;
 daysSinceDeepDive: number | null;
 verdict: string;
 confidence: string;
 expiredCatalysts: Array<{
 description: string;
 expiredAt: string;
 daysOverdue: number;
 }>;
 onTrack: boolean;
}

export interface ConditionReport {
 userId: string;
 generatedAt: string;
 totalTickers: number;
 needsEscalation: TickerConditionResult[];
 onTrack: TickerConditionResult[];
 errors: Array<{ ticker: string; error: string }>;
 summary: string;
}

export interface RateLimit {
 maxPerPeriod: number;
 periodHours: number;
}

export interface RateLimits {
 full_report: RateLimit;
 daily_brief: RateLimit;
 deep_dive: RateLimit;
 new_ideas: RateLimit;
 quick_check: RateLimit;
}

export interface AgentHealth {
 healthy: boolean;
 consecutiveErrors: number;
 lastError: string | null;
 lastErrorReason: string | null;
 lastRunAt: string | null;
 classification?: "healthy" | "degraded" | "restricted" | "inactive";
 statusReason?: string | null;
 operational?: boolean;
}

export interface Schedule {
 dailyBriefTime: string;
 weeklyResearchDay: string;
 weeklyResearchTime: string;
 timezone: string;
}

export type NotificationChannel = "telegram" | "web" | "none" | "whatsapp";

export interface NotificationPreferences {
 primaryChannel: NotificationChannel;
 enabledChannels: {
  telegram: boolean;
  web: boolean;
  whatsapp: boolean;
 };
 categories: {
  dailyBriefs: boolean;
  reportRuns: boolean;
  marketNews: boolean;
 };
}

export interface ChannelStatus {
 connected: boolean;
 target: string | null;
}

export interface ChannelConnectivity {
 telegram: ChannelStatus;
 whatsapp: ChannelStatus;
 web: ChannelStatus;
}

export interface FeedItemEntry {
 ticker: string;
 mode: string;
 verdict: string;
 confidence: string;
 reasoning: string;
 timeframe: string;
 analystTypes: string[];
 hasBullCase: boolean;
 hasBearCase: boolean;
 currentILS?: number;
 dayChangePct?: number;
 moveReason?: string;
 needsEscalation?: boolean;
 escalationReason?: string | null;
 deepDiveQueued?: boolean;
 deepDiveJobId?: string | null;
 deepDiveQueueStatus?: "not_needed" | "not_selected" | "queued" | "suppressed";
 deepDiveQueueReason?: string | null;
 dailySection?: "portfolio" | "tracking";
 assetScope?: StrategyScope;
 trackingStatus?: TrackingStatus | null;
 stance?: TrackingStance | null;
 potentialScore?: number | null;
 urgencyScore?: number | null;
 urgencyLabel?: UrgencyLabel | null;
 portfolioFitScore?: number | null;
 suggestedAllocationPct?: number | null;
 suggestedAllocationILS?: number | null;
 actionCatalysts?: StrategyCatalyst[];
 avoidConditions?: string[];
 nextReviewAt?: string | null;
}

export interface FeedItem {
 id: string;
 createdAt: string;
 kind: "daily_brief" | "report" | "market_news";
 title: string;
 summary: string;
 mode: string;
 tone: "emerald" | "amber" | "rose" | "sky" | "slate";
 compact: boolean;
 batchId: string | null;
 tickers: string[];
 tickerCount: number;
 entries: Record<string, FeedItemEntry>;
 highlights: string[];
 dailyBrief: {
  headline: string | null;
  today: string | null;
  tomorrow: string | null;
  marketView: string | null;
  securityNote: string | null;
  dashboardPath: string | null;
 } | null;
 event: {
  ticker: string;
  source: string;
  url: string | null;
 } | null;
}

export interface FeedPageResponse {
 page: number;
 totalPages: number;
 totalItems: number;
 pageSize: number;
 appliedMode: string | null;
 appliedSearch: string | null;
 items: FeedItem[];
}

export interface OnboardStatus {
 userId: string;
 state: PortfolioState;
 displayName: string | null;
 telegramChatId: string | null;
 bootstrapProgress: {
 total: number;
 completed: number;
 completedTickers: string[];
 pct: number;
 } | null;
 portfolioLoaded: boolean;
 guidanceStepPending: boolean;
 positionGuidanceCount: number;
 readyForTrading: boolean;
 schedule: Schedule | null;
 notifications: NotificationPreferences;
 telegramConnected: boolean;
 connectivity: ChannelConnectivity;
}

export interface SummaryStripProps {
  totalILS: number;
  totalPlILS: number;
  totalPlPct: number;
  totalDayChangeILS: number;
  totalDayChangePct: number;
  usdIlsRate: number;
  updatedAt: string;
}

// ============================================================
// Today screen — pilot v1
// ============================================================

export type AttentionReason =
  | "catalyst_expired"
  | "verdict_close"
  | "verdict_sell"
  | "verdict_reduce";

export interface ExpiredCatalystInfo {
  description: string;
  daysAgo: number;
}

export interface AttentionItem {
  ticker: string;
  verdict: Verdict;
  reason: AttentionReason;
  reasoningSnippet: string;
  expiredCatalyst: ExpiredCatalystInfo | null;
}

export interface HealthScoreBreakdown {
  freshness: number;   // 0..25
  catalyst: number;    // 0..25
  exit: number;        // 0..20
  confidence: number;  // 0..15
  dayMove: number;     // 0..15
}

export interface HealthScore {
  score: number; // 0..100, integer
  breakdown: HealthScoreBreakdown;
}

export type HealthLabel = "healthy" | "steady" | "watch";

export interface ClosedPositionRecord {
  ticker: string;
  closedAt: string;       // ISO date string
  exitReason: string;
  exitNote: string;
  finalPlPct: number;
  finalPlILS: number;
  shares: number;
  avgPriceILS: number;
}
