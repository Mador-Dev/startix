export type FeedItemKind = "daily_brief" | "report" | "deep_dive" | "quick_check" | "market_news";
export type FeedItemTone = "emerald" | "amber" | "rose" | "sky" | "slate";

export interface FeedItemEntity {
  id: string;
  userId: string;
  jobId: string | null;
  kind: FeedItemKind;
  title: string;
  summary: string;
  tone: FeedItemTone;
  tickers: string[];
  highlights: string[];
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}
