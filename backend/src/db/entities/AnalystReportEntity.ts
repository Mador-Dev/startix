export type AnalystType =
  | "fundamentals"
  | "technical"
  | "sentiment"
  | "macro"
  | "risk"
  | "bull"
  | "bear"
  | "debate"
  | "quick_check";

export interface AnalystReportEntity {
  id: string;
  analysisRunId: string;
  userId: string;
  ticker: string;
  analystType: AnalystType;
  round: number | null;
  payload: unknown;
  sources: string[];
  generatedAt: Date;
}
