export interface AnalysisRunEntity {
  id: string;
  jobId: string;
  userId: string;
  ticker: string;
  runType: "bootstrap" | "deep_dive" | "daily" | "quick_check" | "full_report";
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date | null;
  completedAt: Date | null;
  costPoints: number | null;
  progress: {
    pct?: number;
    currentStep?: string | null;
    steps?: Array<{ agent: string; status: string; startedAt?: string; completedAt?: string; error?: string }>;
  };
  createdAt: Date;
}
