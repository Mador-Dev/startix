import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle } from "lucide-react";
import { triggerJob, fetchJobs } from "../api/jobs";
import { Card } from "../components/ui/Card";
import { JobCard } from "../components/jobs/JobCard";
import { SupersededJobBanner } from "../components/jobs/SupersededJobBanner";
import { Spinner } from "../components/ui/Spinner";
import { useToastStore } from "../store/toastStore";
import { usePreferencesStore } from "../store/preferencesStore";
import { t } from "../store/i18n";
import { TickerSearch } from "../components/ui/TickerSearch";
import type { Job, JobAction, TickerSelection } from "../types/api";

function ActionCard({
  icon,
  title,
  description,
  action,
  tickerRequired,
  onTrigger,
  blocked = false,
  blockedReason,
}: {
  icon: string;
  title: string;
  description: string;
  action: JobAction;
  tickerRequired?: boolean;
  onTrigger: (job: Job) => void;
  blocked?: boolean;
  blockedReason?: string;
}) {
  const language = usePreferencesStore((s) => s.language);
  const queryClient = useQueryClient();
  const [tickerSelection, setTickerSelection] = useState<TickerSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const showToast = useToastStore((s) => s.show);

  const handleTrigger = async () => {
    if (blocked) {
      showToast(blockedReason ?? "This feature is currently blocked.", "info");
      return;
    }
    if (tickerRequired && !tickerSelection) {
      showToast(t("tickerRequired", language), "warning");
      return;
    }
    setLoading(true);
    try {
      const res = await triggerJob(action, tickerRequired ? tickerSelection?.symbol : undefined);
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      onTrigger(res.job);
      showToast(`${title} — ${t("jobQueued", language)}`, "success");
      if (tickerRequired) setTickerSelection(null);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { reason?: string; error?: string } } };
      const reason = axiosErr.response?.data?.reason || axiosErr.response?.data?.error;
      showToast(reason || `${t("jobFailed", language)}: ${action}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="text-2xl">{icon}</div>
      <div>
        <h3 className="text-sm font-bold text-[var(--color-fg-default)]">{title}</h3>
        <p className="text-[10px] text-[var(--color-fg-muted)] mt-0.5">{description}</p>
      </div>
      {tickerRequired && (
        <div className="mt-1">
          <TickerSearch
            value={tickerSelection}
            onChange={setTickerSelection}
            placeholder={t("enterTicker", language)}
            disabled={blocked}
          />
        </div>
      )}
      {blockedReason ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-[10px] leading-5 text-[var(--color-fg-muted)]">
          {blockedReason}
        </div>
      ) : null}
      <button
        onClick={handleTrigger}
        disabled={blocked || loading || (tickerRequired && !tickerSelection)}
        className={`w-full py-2 rounded-lg text-xs font-bold disabled:opacity-50 mt-1 ${
          blocked
            ? "border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-fg-subtle)]"
            : "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
        }`}
      >
        {blocked ? t("comingSoon", language) : loading ? "..." : t("run", language)}
      </button>
    </Card>
  );
}

export function Controls() {
  const language = usePreferencesStore((s) => s.language);
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const { data: jobsData } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    staleTime: 30_000,
    refetchInterval: 30_000, // auto-refresh every 30s
  });

  const allJobs = jobsData?.jobs ?? [];

  // Jobs that are currently active (pending or running)
  const activeJobs = allJobs.filter((j) => j.status === "pending" || j.status === "paused" || j.status === "running");
  // Most recent completed/failed jobs
  const recentHistory = allJobs
    .filter((j) => j.status === "completed" || j.status === "partial_completed" || j.status === "failed")
    .slice(0, 15);

  const handleJobComplete = useCallback((job: Job) => {
    const label = job.action.replace(/_/g, " ");
    const ticker = job.ticker ? ` (${job.ticker})` : "";
    if (job.status === "completed") {
      showToast(`${label}${ticker} ${t("jobCompletedNotif", language)}`, "success");
    } else if (job.status === "partial_completed") {
      showToast(`${label}${ticker} completed partially — check failed tickers`, "warning");
    } else {
      showToast(`${label}${ticker} ${t("jobFailedNotif", language)}`, "error");
    }
    // Refresh the jobs list to update UI
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }, [showToast, queryClient, language]);

  return (
    <>
      <div style={{ padding: "20px 16px 0" }}>
        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)", color: "var(--text-primary)", margin: 0 }}>
          {t("controls", language)}
        </h1>
      </div>

      <div className="px-4 pt-3 pb-4">
        <SupersededJobBanner jobs={allJobs} />

        {/* Action grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ActionCard
            icon="📋"
            title={t("jobDailyTitle", language)}
            description={t("jobDailyDesc", language)}
            action="daily_brief"
            onTrigger={() => {}}
          />
          <ActionCard
            icon="📊"
            title={t("jobWeeklyTitle", language)}
            description={t("jobWeeklyDesc", language)}
            action="full_report"
            onTrigger={() => {}}
            blocked
            blockedReason={t("jobWeeklyBlockedReason", language)}
          />
          <ActionCard
            icon="🔬"
            title={t("jobDeepDiveTitle", language)}
            description={t("jobDeepDiveDesc", language)}
            action="deep_dive"
            tickerRequired
            onTrigger={() => {}}
          />
          <ActionCard
            icon="💡"
            title={t("jobNewIdeasTitle", language)}
            description={t("jobNewIdeasDesc", language)}
            action="new_ideas"
            onTrigger={() => {}}
            blocked
            blockedReason={t("jobNewIdeasBlockedReason", language)}
          />
        </div>

        {/* Active jobs */}
        {activeJobs.length > 0 && (
          <div className="mt-5 space-y-2">
            <h2 className="text-xs font-bold text-[var(--color-fg-default)] uppercase border-l-2 border-[var(--color-accent-blue)] pl-2">
              {t("activeJobs", language)} ({activeJobs.length})
            </h2>
            {activeJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onPollComplete={handleJobComplete}
              />
            ))}
          </div>
        )}

        {/* Job history */}
        <div className="mt-6">
          <h2 className="text-xs font-bold text-[var(--color-fg-subtle)] uppercase mb-3">
            {t("recentJobs", language)}
          </h2>

          {!jobsData ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          ) : recentHistory.length === 0 && activeJobs.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-xs text-[var(--color-fg-muted)]">{t("noJobs", language)}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentHistory.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--color-bg-subtle)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0">
                      {job.status === "completed" || job.status === "partial_completed"
                        ? <CheckCircle size={14} className="text-[var(--color-accent-green)]" />
                        : <XCircle size={14} className="text-[var(--color-accent-red)]" />}
                    </span>
                    <span className="text-xs font-medium text-[var(--color-fg-default)] truncate">
                      {job.action.replace(/_/g, " ")}
                      {job.ticker && (
                        <span className="text-[var(--color-fg-muted)]"> · {job.ticker}</span>
                      )}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--color-fg-subtle)] shrink-0">
                    {new Date(job.completed_at ?? job.triggered_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
