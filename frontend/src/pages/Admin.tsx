import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminFetchUsers,
  adminCreateUser,
  adminDeleteUser,
  adminAddTelegram,
  adminGetStatus,
  adminGetUserObservability,
  adminSetUserControl,
  adminClearUserControl,
  adminForceLogout,
  adminGetSystem,
  adminPatchSystem,
  adminListStepQueueJobs,
  adminGetStepQueueJob,
  adminGetStepQueueCost,
  adminGetStepQueueModels,
  adminUpdateStepQueueModel,
  adminGetObservabilityRange,
  adminListSupportMessages,
  adminUpdateSupportMessageStatus,
  adminUpdatePointsBudget,
  adminUpdateUserModelTier,
  adminGetDefaults,
  adminUpdateDefaults,
  adminListPilotFeatures,
  adminUpdatePilotFeatureReview,
  adminIssueImpersonationSession,
  adminGetUserReadiness,
  adminListAuditEvents,
  adminCancelJob,
  adminKillJob,
  adminPauseStepQueueJob,
  adminResumeStepQueueJob,
  type UserSummary,
  type PointsBudget,
  type ModelTier,
  type AdminDefaults,
  type UserObservability,
  type LlmRequestEvent,
  type UserControlPatch,
  type SystemControlPatch,
  type StepQueueJobSummary,
  type StepQueueStep,
  type StepQueueModelAssignment,
  type StepQueueCostRow,
  type UserDailySummary,
  type PilotFeature,
  type PilotFeatureReviewStatus,
  type PilotFeatureSurface,
  type UserReadiness,
  type AuditEvent,
} from "../api/admin";
import { setImpersonationState } from "../store/impersonationStore";
import type { SupportMessageRecord } from "../types/api";
import { usePreferencesStore } from "../store/preferencesStore";
import { t } from "../store/i18n";

// ---- Login ----
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const language = usePreferencesStore((s) => s.language);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    sessionStorage.setItem("admin_key", key.trim());
    try {
      await adminGetStatus();
      onLogin();
    } catch {
      sessionStorage.removeItem("admin_key");
      setError(t("adminLoginError", language));
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🦞</div>
          <h1 className="text-xl font-bold text-[var(--color-fg-default)]">{t("adminTitle", language)}</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">{t("adminLoginSub", language)}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("adminKeyPlaceholder", language)}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          {error && <p className="text-[var(--color-accent-red)] text-sm text-center">{error}</p>}
          <button type="submit" className="w-full py-3 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] font-bold text-sm">
            {t("adminSignIn", language)}
          </button>
        </form>
      </div>
    </div>
  );
}

function PointsBudgetEditor({
  budget,
  onSave,
  onCancel,
}: {
  budget: PointsBudget;
  onSave: (b: PointsBudget) => Promise<void>;
  onCancel: () => void;
}) {
  const [dailyBudgetPoints, setDailyBudgetPoints] = useState<string>(String(budget.dailyBudgetPoints));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedBudget = Number(dailyBudgetPoints);
  const validBudget = Number.isFinite(parsedBudget) && parsedBudget > 0;

  const handleSave = async () => {
    if (!validBudget || saving) {
      setError("Enter a valid points budget greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ dailyBudgetPoints: parsedBudget });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update points budget");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-[var(--color-fg-muted)] block">Daily points budget</label>
        <input
          type="number"
          min={0.001}
          step={0.001}
          value={dailyBudgetPoints}
          onChange={(e) => setDailyBudgetPoints(e.target.value)}
          className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
        />
        <p className="text-[10px] text-[var(--color-fg-subtle)]">
          Users see points only. Spending decreases from real upstream request cost.
        </p>
      </div>
      {error && (
        <p className="text-[10px] text-[var(--color-accent-red)]">{error}</p>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} disabled={saving} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-50">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!validBudget || saving}
          className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---- Add User Modal ----
function AddUserModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const language = usePreferencesStore((s) => s.language);
  const [form, setForm] = useState({
    userId: "",
    password: "",
    displayName: "",
    telegramChatId: "",
    botToken: "",
    dailyBriefTime: "08:00",
    weeklyResearchDay: "sunday",
    weeklyResearchTime: "19:00",
    timezone: "Asia/Jerusalem",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.userId.trim() || !form.password) { setError(t("adminUserCreationError", language)); return; }
    setLoading(true);
    setError("");
    try {
      await adminCreateUser({
        userId: form.userId.trim(),
        password: form.password,
        displayName: form.displayName.trim() || form.userId.trim(),
        telegramChatId: form.telegramChatId || undefined,
        telegramBotToken: form.botToken || undefined,
        schedule: {
          dailyBriefTime: form.dailyBriefTime,
          weeklyResearchDay: form.weeklyResearchDay,
          weeklyResearchTime: form.weeklyResearchTime,
          timezone: form.timezone,
        },
      });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("adminUserCreationFailed", language));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full bg-[var(--bg-surface-hover)] border border-[var(--bg-border-mid)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-green)] placeholder:text-[var(--text-tertiary)]";
  const labelCls = "text-xs text-[var(--color-fg-muted)] block mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:max-w-lg bg-[var(--bg-base)] border border-[var(--bg-border-mid)] rounded-t-2xl md:rounded-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[var(--bg-base)] border-b border-[var(--bg-border-mid)] px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">{t("adminAddUser", language)}</h2>
          <button onClick={onClose} className="text-[var(--color-fg-muted)] text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <p className="text-[var(--color-accent-red)] text-xs">{error}</p>}

          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t("adminUserIdLabel", language)} *</label>
              <input type="text" value={form.userId} onChange={set("userId")} placeholder="john-doe" maxLength={32} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("adminPasswordLabel", language)} *</label>
              <input type="password" value={form.password} onChange={set("password")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("adminDisplayNameLabel", language)}</label>
              <input type="text" value={form.displayName} onChange={set("displayName")} className={inputCls} />
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-bold text-[var(--color-fg-subtle)] uppercase mb-2">{t("adminTelegramSection", language)}</p>
            <div className="space-y-2">
              <div>
                <label className={labelCls}>{t("chatId", language)}</label>
                <input type="text" value={form.telegramChatId} onChange={set("telegramChatId")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("botToken", language)}</label>
                <input type="text" value={form.botToken} onChange={set("botToken")} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-bold text-[var(--color-fg-subtle)] uppercase mb-2">{t("adminScheduleSection", language)}</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>{t("adminDailyTime", language)}</label>
                <input type="time" value={form.dailyBriefTime} onChange={set("dailyBriefTime")}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--bg-border-mid)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none w-full" />
              </div>
              <div>
                <label className={labelCls}>{t("adminWeeklyDay", language)}</label>
                <select value={form.weeklyResearchDay} onChange={set("weeklyResearchDay")}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--bg-border-mid)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none w-full">
                  {["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t("adminWeeklyTime", language)}</label>
                <input type="time" value={form.weeklyResearchTime} onChange={set("weeklyResearchTime")}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--bg-border-mid)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none w-full" />
              </div>
            </div>
            <div className="mt-2">
              <label className={labelCls}>{t("timezone", language)}</label>
              <select value={form.timezone} onChange={set("timezone")}
                className="bg-[var(--bg-surface-hover)] border border-[var(--bg-border-mid)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none w-full">
                {["Asia/Jerusalem","America/New_York","America/Los_Angeles","America/Chicago","Europe/London","Europe/Paris","Asia/Tokyo","Asia/Singapore","Australia/Sydney"].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-fg-muted)]">
              {t("cancel", language)}
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-sm font-bold disabled:opacity-50">
              {loading ? t("adminCreating", language) : t("adminCreateUser", language)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- User Health Badge ----
function UserHealthBadge({ state, portfolioLoaded, restriction }: { state: string; portfolioLoaded: boolean; restriction: string | null }) {
  if (restriction) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium">Restricted</span>;
  }
  if (state === "ACTIVE" && portfolioLoaded) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">Healthy</span>;
  }
  if (state === "ACTIVE" && !portfolioLoaded) {
    return <span title="Active state but no portfolio loaded" className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium cursor-help">Unhealthy</span>;
  }
  if (state === "BOOTSTRAPPING") {
    return <span title="Initial analysis running" className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium cursor-help">Bootstrapping</span>;
  }
  if (state === "BLOCKED") {
    return <span title="Admin-restricted — user cannot access the system" className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium cursor-help">Blocked</span>;
  }
  // INCOMPLETE or unknown
  return <span title="Not yet onboarded — no portfolio loaded" className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 font-medium cursor-help">Incomplete</span>;
}

function StepQueueStatusBadge({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "text-[var(--color-accent-green)] bg-green-500/10"
      : status === "partial_completed"
        ? "text-amber-400 bg-amber-500/10"
        : status === "failed"
          ? "text-[var(--color-accent-red)] bg-red-500/10"
          : status === "running"
            ? "text-[var(--color-accent-blue)] bg-blue-500/10"
            : status === "paused"
              ? "text-amber-400 bg-amber-500/10"
              : "text-[var(--color-fg-muted)] bg-[var(--color-bg-muted)]";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${color}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function formatElapsed(startIso: string | null, endIso?: string | null): string {
  if (!startIso) return "not started";
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diff = Math.max(0, end - new Date(startIso).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const STEP_KIND_LABELS: Record<string, { label: string; description: string }> = {
  "analyst.fundamentals": { label: "Fundamentals", description: "Analyses financial statements, earnings, and valuation metrics." },
  "analyst.technical": { label: "Technical", description: "Analyses price action, momentum, and chart patterns." },
  "analyst.sentiment": { label: "Sentiment", description: "Analyses news, social signals, and market narrative." },
  "analyst.macro": { label: "Macro", description: "Analyses macroeconomic context and sector conditions." },
  "analyst.risk": { label: "Risk", description: "Evaluates downside scenarios and position risk." },
  "debate": { label: "Debate", description: "Synthesises analyst views into a structured bull/bear debate." },
  "synthesis": { label: "Synthesis", description: "Produces the final verdict and recommendation from the debate." },
  "quick_check.evaluate": { label: "Quick Check", description: "Lightweight evaluation of a tracked position against recent signals." },
  "tracking.evaluate": { label: "Tracking", description: "Ongoing monitoring evaluation for a tracked strategy." },
  "chat_agent": { label: "Chat Agent", description: "Handles a user chat turn requiring tool use or analysis." },
};

const JOB_ACTION_LABELS: Record<string, string> = {
  full_report: "Full Report",
  deep_dive: "Deep Dive",
  daily_brief: "Daily Brief",
  quick_check: "Quick Check",
  new_ideas: "New Ideas",
};

function StepQueueInspector({ onError }: { onError: (message: string) => void }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobLimit, setJobLimit] = useState(20);
  const [jobControlLoading, setJobControlLoading] = useState<Record<string, boolean>>({});
  const jobsQuery = useQuery({
    queryKey: ["admin-step-queue-jobs", jobLimit],
    queryFn: () => adminListStepQueueJobs(jobLimit),
    refetchInterval: 10_000,
  });
  const detailQuery = useQuery({
    queryKey: ["admin-step-queue-job", selectedJobId],
    queryFn: () => adminGetStepQueueJob(selectedJobId ?? ""),
    enabled: selectedJobId !== null,
    refetchInterval: selectedJobId ? 10_000 : false,
  });

  useEffect(() => {
    if (jobsQuery.error) onError(jobsQuery.error instanceof Error ? jobsQuery.error.message : "Failed to load step queue jobs");
  }, [jobsQuery.error, onError]);

  const handleJobControl = async (jobId: string, action: "pause" | "resume" | "cancel" | "kill", userId: string) => {
    if (jobControlLoading[jobId]) return;
    if (action === "kill" && !window.confirm(`Force-fail job ${jobId.slice(-8)}? This cannot be undone.`)) return;
    setJobControlLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      if (action === "pause") await adminPauseStepQueueJob(jobId);
      else if (action === "resume") await adminResumeStepQueueJob(jobId);
      else if (action === "cancel") await adminCancelJob(userId, jobId);
      else if (action === "kill") await adminKillJob(userId, jobId);
      await jobsQuery.refetch();
    } catch (err) {
      onError(err instanceof Error ? err.message : `Failed to ${action} job`);
    } finally {
      setJobControlLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  };

  const jobs = jobsQuery.data ?? [];
  const selected = detailQuery.data;
  const running = jobs.filter((job) => job.status === "running").length;
  const partial = jobs.filter((job) => job.status === "partial_completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const stepsByTicker = new Map<string, StepQueueStep[]>();
  const tickerById = new Map<string, string>();
  if (selected) {
    for (const ticker of selected.tickers) {
      tickerById.set(ticker.id, ticker.ticker);
    }
    for (const step of selected.steps) {
      const list = stepsByTicker.get(step.ticker_work_item_id) ?? [];
      list.push(step);
      stepsByTicker.set(step.ticker_work_item_id, list);
    }
  }
  const runningSteps = selected?.steps.filter((step) => step.status === "running") ?? [];

  const fmt = (iso: string | null) => {
    if (!iso) return "open";
    return new Date(iso).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ background: "var(--color-bg-subtle)" }}>
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide">Step Queue</h2>
          <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
            Postgres-owned execution truth, refreshed every 10s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px]" style={{ color: "var(--color-fg-muted)" }}>Show</label>
            <input
              type="number"
              min={1}
              max={200}
              value={jobLimit}
              onChange={(e) => {
                const v = Math.min(200, Math.max(1, Number(e.target.value) || 20));
                setJobLimit(v);
              }}
              className="w-14 rounded px-1.5 py-0.5 text-[10px] text-center outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
            />
            <span className="text-[10px]" style={{ color: "var(--color-fg-muted)" }}>jobs</span>
          </div>
          <div className="flex gap-2 text-[10px]" style={{ color: "var(--color-fg-muted)" }}>
            <span>Running {running}</span>
            <span>Partial {partial}</span>
            <span>Failed {failed}</span>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-2" style={{ background: "var(--color-bg-base)" }}>
        {jobsQuery.isLoading ? (
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>Loading step queue...</p>
        ) : jobs.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>No step-queue jobs yet.</p>
        ) : (
          jobs.map((job: StepQueueJobSummary) => {
            const pct = job.step_count > 0 ? Math.round((job.completed_steps / job.step_count) * 100) : 0;
            return (
              <button
                key={job.id}
                onClick={() => setSelectedJobId((current) => current === job.id ? null : job.id)}
                className="w-full rounded-lg p-2 text-left border hover:bg-[var(--color-bg-muted)]"
                style={{ borderColor: selectedJobId === job.id ? "var(--color-accent-blue)" : "var(--color-border)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">
                      {job.user_id} · {JOB_ACTION_LABELS[job.action] ?? job.action} · {job.model_tier}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                      {job.id.slice(-10)} · {fmt(job.triggered_at)} · {job.ticker_count} tickers
                    </p>
                  </div>
                  <StepQueueStatusBadge status={job.status} />
                </div>
                <div className="flex gap-1 mt-1">
                  {job.status === "running" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleJobControl(job.id, "pause", job.user_id); }}
                      disabled={jobControlLoading[job.id]}
                      className="text-[9px] px-1.5 py-0.5 rounded border disabled:opacity-40"
                      style={{ borderColor: "rgba(245,158,11,0.4)", color: "#f59e0b" }}
                    >
                      {jobControlLoading[job.id] ? "…" : "Pause"}
                    </button>
                  )}
                  {job.status === "paused" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleJobControl(job.id, "resume", job.user_id); }}
                      disabled={jobControlLoading[job.id]}
                      className="text-[9px] px-1.5 py-0.5 rounded border disabled:opacity-40"
                      style={{ borderColor: "rgba(59,130,246,0.4)", color: "var(--color-accent-blue)" }}
                    >
                      {jobControlLoading[job.id] ? "…" : "Resume"}
                    </button>
                  )}
                  {job.status === "pending" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleJobControl(job.id, "cancel", job.user_id); }}
                      disabled={jobControlLoading[job.id]}
                      className="text-[9px] px-1.5 py-0.5 rounded border disabled:opacity-40"
                      style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--color-accent-red)" }}
                    >
                      {jobControlLoading[job.id] ? "…" : "Cancel"}
                    </button>
                  )}
                  {job.status === "running" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleJobControl(job.id, "kill", job.user_id); }}
                      disabled={jobControlLoading[job.id]}
                      className="text-[9px] px-1.5 py-0.5 rounded border disabled:opacity-40"
                      style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--color-accent-red)" }}
                    >
                      {jobControlLoading[job.id] ? "…" : "Kill"}
                    </button>
                  )}
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-bg-muted)" }}>
                  <div
                    className={job.failed_steps > 0 ? "h-full bg-amber-500" : "h-full bg-[var(--color-accent-green)]"}
                    style={{ width: `${Math.max(3, pct)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                  {job.completed_steps}/{job.step_count} steps · {job.failed_steps} failed
                  {job.failure_reason ? ` · ${job.failure_reason.slice(0, 120)}` : ""}
                </p>
              </button>
            );
          })
        )}

        {selected && (
          <div className="mt-3 rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold">Ticker Details</p>
                <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                  Current stage visibility, durations, and terminal errors for {String(selected.job["id"] ?? "").slice(-10)}.
                </p>
              </div>
              <button onClick={() => void detailQuery.refetch()} className="text-[10px] underline" style={{ color: "var(--color-accent-blue)" }}>
                Refresh
              </button>
            </div>
            {runningSteps.length > 0 && (
              <div className="rounded-md border p-2" style={{ borderColor: "rgba(59,130,246,0.35)", background: "rgba(59,130,246,0.08)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-accent-blue)" }}>
                  Running now
                </p>
                <div className="mt-1 space-y-1">
                  {runningSteps.map((step) => (
                    <div key={step.id} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{tickerById.get(step.ticker_work_item_id) ?? "unknown"}</span>
                        {" · "}
                        {STEP_KIND_LABELS[step.kind]?.label ?? step.kind}
                        {" · "}
                        attempt {step.attempts}
                      </span>
                      <span className="shrink-0" style={{ color: "var(--color-fg-muted)" }}>
                        {formatElapsed(step.started_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {selected.tickers.map((ticker) => {
              const steps = stepsByTicker.get(ticker.id) ?? [];
              const failedSteps = steps.filter((step) => step.status === "failed");
              const runningStep = steps.find((step) => step.status === "running");
              const completedCount = steps.filter((step) => step.status === "completed").length;
              return (
                <div key={ticker.id} className="rounded-md border p-2" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-bold">{ticker.ticker}</span>
                    <StepQueueStatusBadge status={ticker.status} />
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: "var(--color-fg-subtle)" }}>
                    {completedCount}/{steps.length} completed · {failedSteps.length} failed
                    {runningStep ? ` · current: ${runningStep.kind} attempt ${runningStep.attempts} for ${formatElapsed(runningStep.started_at)}` : ""}
                    {failedSteps.length > 0 ? ` · failed: ${failedSteps.map((step) => step.kind).join(", ")}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {steps.map((step) => (
                      <span
                        key={step.id}
                        title={step.last_error ?? undefined}
                        className="rounded px-1.5 py-0.5 text-[9px]"
                        style={{
                          background: step.status === "completed"
                            ? "rgba(16,185,129,0.10)"
                            : step.status === "failed"
                              ? "rgba(239,68,68,0.10)"
                              : step.status === "running"
                                ? "rgba(59,130,246,0.12)"
                                : "var(--color-bg-muted)",
                          color: step.status === "completed"
                            ? "var(--color-accent-green)"
                            : step.status === "failed"
                              ? "var(--color-accent-red)"
                              : step.status === "running"
                                ? "var(--color-accent-blue)"
                                : "var(--color-fg-subtle)",
                        }}
                      >
                        <span title={STEP_KIND_LABELS[step.kind]?.description}>
                          {STEP_KIND_LABELS[step.kind]?.label ?? step.kind}
                        </span>
                        {" · "}a{step.attempts} · {formatElapsed(step.started_at, step.completed_at)}
                      </span>
                    ))}
                  </div>
                  {(ticker.failure_reason || failedSteps[0]?.last_error) && (
                    <p className="text-[10px] mt-1 line-clamp-2" style={{ color: "var(--color-accent-red)" }}>
                      {(ticker.failure_reason ?? failedSteps[0]?.last_error ?? "").slice(0, 240)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function OperationsOverview({
  users,
  degradedCount,
  unhealthyCount,
  restrictedCount,
  onError,
}: {
  users: UserSummary[];
  degradedCount: number;
  unhealthyCount: number;
  restrictedCount: number;
  onError: (message: string) => void;
}) {
  const toInputValue = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  const [rangePreset, setRangePreset] = useState<"minutes" | "24h" | "7d" | "14d" | "custom">("minutes");
  const [rangeMinutes, setRangeMinutes] = useState("30");
  const [customFrom, setCustomFrom] = useState(() => toInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(() => toInputValue(new Date()));
  const range = useMemo(() => {
    const now = new Date();
    if (rangePreset === "custom") {
      const from = new Date(customFrom);
      const to = new Date(customTo);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) {
        return {
          from: from.toISOString(),
          to: to.toISOString(),
          label: `${from.toLocaleString()} to ${to.toLocaleString()}`,
        };
      }
      return {
        from: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
        label: "Invalid custom range; showing last hour",
      };
    }
    const minutes = rangePreset === "minutes"
      ? Math.min(Math.max(Number(rangeMinutes) || 30, 1), 60 * 24 * 90)
      : rangePreset === "24h"
        ? 24 * 60
        : rangePreset === "7d"
          ? 7 * 24 * 60
          : 14 * 24 * 60;
    return {
      from: new Date(now.getTime() - minutes * 60 * 1000).toISOString(),
      to: now.toISOString(),
      label: rangePreset === "minutes" ? `Last ${minutes} minutes` : `Last ${rangePreset}`,
    };
  }, [customFrom, customTo, rangeMinutes, rangePreset]);

  const observabilityQuery = useQuery({
    queryKey: ["admin-observability-range", range.from, range.to],
    queryFn: () => adminGetObservabilityRange(range.from, range.to),
    refetchInterval: 15_000,
  });
  const costQuery = useQuery({
    queryKey: ["admin-step-queue-cost", range.from, range.to],
    queryFn: () => adminGetStepQueueCost({ from: range.from, to: range.to }),
    refetchInterval: 30_000,
  });
  const supportQuery = useQuery({
    queryKey: ["admin-support-preview"],
    queryFn: () => adminListSupportMessages(50),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const firstError = observabilityQuery.error ?? costQuery.error ?? supportQuery.error;
    if (firstError) onError(firstError instanceof Error ? firstError.message : "Failed to load admin overview");
  }, [observabilityQuery.error, costQuery.error, supportQuery.error, onError]);

  const dailyRows = observabilityQuery.data?.users ?? [];
  const totalRequests = dailyRows.reduce((sum, row: UserDailySummary) => sum + row.requestCount, 0);
  const totalCost = dailyRows.reduce((sum, row: UserDailySummary) => sum + row.totalCostUsd, 0);
  const totalErrors = dailyRows.reduce((sum, row: UserDailySummary) => sum + row.errorCount + row.timeoutCount, 0);
  const unattributed = dailyRows.reduce((sum, row: UserDailySummary) => sum + row.unattributedCount, 0);
  const openSupport = (supportQuery.data ?? []).filter((message) => message.status === "open").length;
  const stepQueueCost = (costQuery.data?.rows ?? []).reduce((sum, row: StepQueueCostRow) => sum + Number(row.cost_usd ?? 0), 0);
  const topCostRows = [...(costQuery.data?.rows ?? [])]
    .sort((a, b) => Number(b.cost_usd ?? 0) - Number(a.cost_usd ?? 0))
    .slice(0, 5);

  const cards = [
    { label: "Users", value: users.length, sub: `${users.length} total`, tone: "default" },
    { label: "Unhealthy agents", value: unhealthyCount, sub: unhealthyCount === 0 ? "0 means all operational" : `${degradedCount} degraded`, tone: unhealthyCount > 0 || degradedCount > 0 ? "bad" : "good" },
    { label: "Restricted", value: restrictedCount, sub: "account controls", tone: restrictedCount > 0 ? "warn" : "default" },
    { label: "Requests", value: totalRequests, sub: `$${totalCost.toFixed(4)} · ${range.label}`, tone: "default" },
    { label: "Errors", value: totalErrors, sub: `${unattributed} unattributed · selected range`, tone: totalErrors > 0 || unattributed > 0 ? "warn" : "good" },
    { label: "Open support", value: openSupport, sub: "messages", tone: openSupport > 0 ? "warn" : "good" },
  ];

  const colorFor = (tone: string) =>
    tone === "bad" ? "var(--color-accent-red)" : tone === "warn" ? "var(--color-accent-yellow)" : tone === "good" ? "var(--color-accent-green)" : "var(--color-fg-default)";

  return (
    <section className="space-y-3">
      <div className="rounded-xl border p-3 space-y-2" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide">Observability Range</h2>
            <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
              {range.label}
            </p>
          </div>
          <span className="text-[10px] font-mono" style={{ color: "var(--color-fg-subtle)" }}>
            Postgres
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["minutes", "Last minutes"],
            ["24h", "24h"],
            ["7d", "7d"],
            ["14d", "14d"],
            ["custom", "Exact range"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRangePreset(key as typeof rangePreset)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold"
              style={{
                background: rangePreset === key ? "var(--color-accent-blue)" : "var(--color-bg-muted)",
                color: rangePreset === key ? "white" : "var(--color-fg-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              {label}
            </button>
          ))}
          {rangePreset === "minutes" && (
            <input
              type="number"
              min={1}
              max={129600}
              value={rangeMinutes}
              onChange={(e) => setRangeMinutes(e.target.value)}
              className="w-24 rounded-lg px-2 py-1 text-[10px] outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
              aria-label="Minutes"
            />
          )}
        </div>
        {rangePreset === "custom" && (
          <div className="grid md:grid-cols-2 gap-2">
            <label className="text-[10px]" style={{ color: "var(--color-fg-muted)" }}>
              From
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-[11px] outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
              />
            </label>
            <label className="text-[10px]" style={{ color: "var(--color-fg-muted)" }}>
              To
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-[11px] outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
              />
            </label>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border p-4" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>{card.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: colorFor(card.tone) }}>{card.value}</p>
            <p className="text-[11px] mt-1" style={{ color: "var(--color-fg-muted)" }}>{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border p-4" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide">Cost Hotspots</h2>
            <p className="text-[10px] mt-1" style={{ color: "var(--color-fg-subtle)" }}>
              {range.label} step-queue spend: ${stepQueueCost.toFixed(4)}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {topCostRows.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>No step-queue cost rows yet.</p>
          ) : topCostRows.map((row) => (
            <div key={`${row.day}-${row.user_id}-${row.ticker ?? ""}-${row.step_kind}`} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="min-w-0 truncate">
                <span className="font-mono">{row.user_id}</span>
                {" · "}
                {row.ticker ?? "-"}
                {" · "}
                {row.step_kind}
              </span>
              <span className="shrink-0" style={{ color: "var(--color-accent-green)" }}>
                ${Number(row.cost_usd ?? 0).toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SupportInbox({ onError }: { onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-support-messages"],
    queryFn: () => adminListSupportMessages(200),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (error) onError(error instanceof Error ? error.message : "Failed to load support messages");
  }, [error, onError]);

  const selected = data.find((message) => message.id === selectedId) ?? data[0] ?? null;
  const open = data.filter((message) => message.status === "open");
  const closed = data.filter((message) => message.status === "closed");

  const setStatus = async (message: SupportMessageRecord, status: "open" | "closed") => {
    try {
      await adminUpdateSupportMessageStatus(message.id, status);
      await queryClient.invalidateQueries({ queryKey: ["admin-support-messages"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-support-preview"] });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update support message");
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--color-bg-subtle)" }}>
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide">Support Inbox</h2>
          <p className="text-[10px] mt-1" style={{ color: "var(--color-fg-subtle)" }}>
            Contact-admin messages from users. Open {open.length}, closed {closed.length}.
          </p>
        </div>
      </div>
      <div className="grid md:grid-cols-[260px,1fr] min-h-[360px]" style={{ background: "var(--color-bg-base)" }}>
        <div className="border-r max-h-[520px] overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
          {isLoading ? (
            <p className="p-4 text-xs" style={{ color: "var(--color-fg-muted)" }}>Loading messages...</p>
          ) : data.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--color-fg-muted)" }}>No support messages yet.</p>
          ) : data.map((message) => (
            <button
              key={message.id}
              onClick={() => setSelectedId(message.id)}
              className="w-full p-3 text-left border-b hover:bg-[var(--color-bg-muted)]"
              style={{
                borderColor: "var(--color-border)",
                background: selected?.id === message.id ? "var(--color-bg-muted)" : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold truncate">{message.subject}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${message.status === "open" ? "bg-amber-500/10 text-amber-400" : "bg-green-500/10 text-green-400"}`}>
                  {message.status}
                </span>
              </div>
              <p className="text-[10px] mt-1" style={{ color: "var(--color-fg-subtle)" }}>
                @{message.userId} · {fmt(message.createdAt)}
              </p>
            </button>
          ))}
        </div>
        <div className="p-4">
          {!selected ? (
            <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>Select a message.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold">{selected.subject}</h3>
                  <p className="text-[11px] mt-1" style={{ color: "var(--color-fg-muted)" }}>
                    @{selected.userId} · {fmt(selected.createdAt)}
                    {selected.page ? ` · ${selected.page}` : ""}
                    {selected.source ? ` · ${selected.source}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => void setStatus(selected, selected.status === "open" ? "closed" : "open")}
                  className="text-[10px] px-3 py-1 rounded-lg font-bold"
                  style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
                >
                  Mark {selected.status === "open" ? "closed" : "open"}
                </button>
              </div>
              <div className="rounded-lg border p-3 whitespace-pre-wrap text-sm leading-6" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-default)" }}>
                {selected.message}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StepQueueModelsPanel({ onError }: { onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-step-queue-models"],
    queryFn: adminGetStepQueueModels,
  });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState("");
  const [draftFallback, setDraftFallback] = useState("");

  useEffect(() => {
    if (error) onError(error instanceof Error ? error.message : "Failed to load step queue models");
  }, [error, onError]);

  const byKey = new Map<string, StepQueueModelAssignment>();
  for (const assignment of data?.assignments ?? []) {
    byKey.set(`${assignment.tier}:${assignment.step_kind}`, assignment);
  }

  const beginEdit = (tier: string, stepKind: string) => {
    const assignment = byKey.get(`${tier}:${stepKind}`);
    setEditingKey(`${tier}:${stepKind}`);
    setDraftModel(assignment?.model ?? "");
    setDraftFallback(assignment?.fallback ?? "");
  };

  const save = async (tier: string, stepKind: string) => {
    if (!draftModel.trim()) {
      onError("Model is required.");
      return;
    }
    try {
      await adminUpdateStepQueueModel(tier, stepKind, {
        model: draftModel.trim(),
        fallback: draftFallback.trim() || null,
        updatedBy: "admin-ui",
      });
      setEditingKey(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-step-queue-models"] });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update model");
    }
  };

  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
      <div className="px-4 py-3" style={{ background: "var(--color-bg-subtle)" }}>
        <h2 className="text-xs font-bold uppercase tracking-wide">Step Queue Models</h2>
        <p className="text-[10px] mt-1" style={{ color: "var(--color-fg-subtle)" }}>
          Postgres-backed per-tier model assignments for backend-owned queue steps. Empty databases are seeded with code defaults on load.
        </p>
      </div>
      <div className="p-3 overflow-x-auto" style={{ background: "var(--color-bg-base)" }}>
        {isLoading ? (
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>Loading model matrix...</p>
        ) : (
          <table className="w-full min-w-[720px] text-[10px]">
            <thead>
              <tr style={{ color: "var(--color-fg-subtle)" }}>
                <th className="text-left py-2 pr-2 font-normal">Tier</th>
                {(data?.stepKinds ?? []).map((stepKind) => (
                  <th key={stepKind} className="text-left py-2 px-2 font-normal">{stepKind.replace("analyst.", "")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.tiers ?? []).map((tier) => (
                <tr key={tier} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-2 pr-2 font-bold">{tier}</td>
                  {(data?.stepKinds ?? []).map((stepKind) => {
                    const key = `${tier}:${stepKind}`;
                    const assignment = byKey.get(key);
                    const editing = editingKey === key;
                    return (
                      <td key={key} className="py-2 px-2 align-top">
                        {editing ? (
                          <div className="space-y-1">
                            <input value={draftModel} onChange={(e) => setDraftModel(e.target.value)} placeholder="model"
                              className="w-44 rounded px-2 py-1 outline-none"
                              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
                            <input value={draftFallback} onChange={(e) => setDraftFallback(e.target.value)} placeholder="fallback"
                              className="w-44 rounded px-2 py-1 outline-none"
                              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
                            <div className="flex gap-1">
                              <button onClick={() => void save(tier, stepKind)} className="px-2 py-0.5 rounded bg-[var(--color-accent-blue)] text-white">Save</button>
                              <button onClick={() => setEditingKey(null)} className="px-2 py-0.5 rounded" style={{ background: "var(--color-bg-muted)" }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => beginEdit(tier, stepKind)} className="text-left w-44 rounded p-1 hover:bg-[var(--color-bg-muted)]">
                            <span className="block truncate" style={{ color: assignment ? "var(--color-fg-default)" : "var(--color-fg-subtle)" }}>
                              {assignment?.model ?? "unset"}
                            </span>
                            {assignment?.fallback && (
                              <span className="block truncate" style={{ color: "var(--color-fg-subtle)" }}>fb: {assignment.fallback}</span>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function AdminDefaultsPanel({
  onError,
  onChanged,
}: {
  onError: (message: string) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-defaults"],
    queryFn: adminGetDefaults,
  });
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AdminDefaults | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  useEffect(() => {
    if (error) onError(error instanceof Error ? error.message : "Failed to load admin defaults");
  }, [error, onError]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await adminUpdateDefaults(draft);
      await queryClient.invalidateQueries({ queryKey: ["admin-defaults"] });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update admin defaults");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
      <div className="px-4 py-3" style={{ background: "var(--color-bg-subtle)" }}>
        <h2 className="text-xs font-bold uppercase tracking-wide">User defaults</h2>
        <p className="text-[10px] mt-1" style={{ color: "var(--color-fg-subtle)" }}>
          Defaults applied to newly created users. Existing users can be changed from their user card.
        </p>
      </div>
      <div className="p-4 space-y-3" style={{ background: "var(--color-bg-base)" }}>
        {isLoading || !draft ? (
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>Loading defaults...</p>
        ) : (
          <>
            <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
              Default model tier
              <select
                value={draft.modelTier}
                onChange={(e) => setDraft({ ...draft, modelTier: e.target.value as ModelTier })}
                className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
              >
                <option value="free">free - lowest cost, lowest reliability</option>
                <option value="cheap">cheap - low cost integration/testing tier</option>
                <option value="balanced">balanced - production default</option>
                <option value="expensive">expensive - highest quality/cost</option>
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
              Default daily points budget
              <input
                type="number"
                min="1"
                step="1"
                value={draft.pointsBudget.dailyBudgetPoints}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    pointsBudget: { dailyBudgetPoints: Math.max(1, Number(e.target.value) || 1) },
                  })
                }
                className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
              />
            </label>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="w-full rounded-lg py-2 text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--color-accent-blue)", color: "white" }}
            >
              {saving ? "Saving..." : "Save defaults"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// ---- User Activity Badge ----
function UserActivityBadge({ userId }: { userId: string }) {
  const [data, setData] = useState<UserObservability | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [renderedAt] = useState(() => Date.now());
  const pageSize = 20;

  useEffect(() => {
    adminGetUserObservability(userId, { limit: pageSize, offset })
      .then(setData)
      .catch(() => { /* no data yet — silently ignore */ });
  }, [userId, offset]);

  if (!data || (data.history.length === 0 && data.recent.length === 0)) {
    return (
      <p className="text-[11px] text-[var(--color-fg-subtle)] italic mt-1">
        No LLM activity yet
      </p>
    );
  }

  const calendarToday = new Date().toISOString().slice(0, 10);
  const today =
    data.todaySummary ??
    data.history.find((entry) => entry.date === calendarToday) ??
    {
      userId,
      date: calendarToday,
      requestCount: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostUsd: 0,
      successCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      rejectedCount: 0,
      unattributedCount: 0,
    };
  const last = data.recent[0];
  const recentOffset = data.recentOffset ?? offset;
  const recentTotal = data.recentTotal ?? data.recent.length;
  const hasPrev = recentOffset > 0;
  const hasNext = recentOffset + data.recent.length < recentTotal;
  const latestActiveDay = data.history.find((entry) => entry.requestCount > 0);
  const dailyBudgetPoints = Number.isFinite(data.pointsBudget?.dailyBudgetPoints)
    ? data.pointsBudget.dailyBudgetPoints
    : 0;
  const pointsRemaining = Number.isFinite(data.pointsBalance?.pointsRemaining)
    ? data.pointsBalance.pointsRemaining
    : 0;
  const pointsPctUsed = Number.isFinite(data.pointsBalance?.pctUsed)
    ? data.pointsBalance.pctUsed
    : 0;
  const pointsExhausted = Boolean(data.pointsBalance?.exhausted);

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString([], {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatAttribution = (source: string, sourceClass: LlmRequestEvent["sourceClass"]) => {
    if (sourceClass === "telegram_command") return "tg";
    if (sourceClass === "dashboard_action") return "dash";
    if (sourceClass === "backend_job") return "job";
    if (sourceClass === "direct_chat") return "chat";
    if (sourceClass === "unknown_agent_session") return "unknown";
    if (source === "explicit_header") return "header";
    if (source === "active_job") return "job";
    if (source === "inferred_direct_chat") return "direct";
    if (source === "empty from earlier version") return "legacy";
    return source;
  };

  return (
    <div className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
      <div className="flex items-center gap-3 flex-wrap">
        <span>
          <span className="text-[var(--color-fg-subtle)]">Today: </span>
          <span className="font-medium text-[var(--color-fg-default)]">
            {today.requestCount} req
          </span>
          {" · "}
          <span className="text-[var(--color-accent-green)]">
            ${today.totalCostUsd.toFixed(4)}
          </span>
        </span>
        <span>
          <span className="text-[var(--color-fg-subtle)]">Ok/Err: </span>
          <span className="text-[var(--color-accent-green)]">{today.successCount}</span>
          {" / "}
          <span className="text-[var(--color-accent-red)]">{today.errorCount + today.timeoutCount}</span>
        </span>
        <span>
          <span className="text-[var(--color-fg-subtle)]">Legacy: </span>
          <span className={today.unattributedCount > 0 ? "text-[var(--color-accent-red)]" : ""}>
            {today.unattributedCount}
          </span>
        </span>
        <span>
          <span className="text-[var(--color-fg-subtle)]">Points used: </span>
          <span className={pointsExhausted ? "text-[var(--color-accent-red)]" : "text-[var(--color-fg-default)]"}>
            {pointsPctUsed}%
          </span>
        </span>
        <span>
          <span className="text-[var(--color-fg-subtle)]">Budget: </span>
          <span className="text-[var(--color-fg-default)]">{dailyBudgetPoints.toFixed(3)} pts</span>
        </span>
        <span>
          <span className="text-[var(--color-fg-subtle)]">Remaining: </span>
          <span className={pointsExhausted ? "text-[var(--color-accent-red)]" : "text-[var(--color-fg-default)]"}>
            {pointsRemaining.toFixed(3)} pts
          </span>
          {pointsExhausted && data.pointsBalance?.windowEnd && (
            <span className="text-[var(--color-fg-subtle)] ml-1">
              · resets {(() => {
                const ms = new Date(data.pointsBalance.windowEnd).getTime() - renderedAt;
                if (ms <= 0) return "soon";
                const h = Math.floor(ms / 3_600_000);
                const m = Math.floor((ms % 3_600_000) / 60_000);
                return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
              })()}
            </span>
          )}
        </span>
        {last && (
          <span>
            <span className="text-[var(--color-fg-subtle)]">Last: </span>
            <span className="font-mono text-[10px]">{last.analyst}</span>
            {" · "}
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              {formatDateTime(last.timestamp)}
            </span>
            {" · "}
            <span
              className={
                last.status === "success"
                  ? "text-[var(--color-accent-green)]"
                  : "text-[var(--color-accent-red)]"
              }
            >
              {last.status}
            </span>
          </span>
        )}
        {!last && latestActiveDay && (
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            Latest activity: {latestActiveDay.date}
          </span>
        )}
        <button
          onClick={() => {
            setExpanded((v) => !v);
            if (!expanded) setOffset(0);
          }}
          className="text-[var(--color-accent-blue)] underline text-[10px]"
        >
          {expanded ? "hide" : `show recent`}
        </button>
      </div>

      {expanded && data.recent.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-[var(--color-fg-subtle)] border-b border-[var(--color-border)]">
                <th className="text-left py-1 pr-2 font-normal">Time</th>
                <th className="text-left pr-2 font-normal">Analyst</th>
                <th className="text-left pr-2 font-normal">Purpose</th>
                <th className="text-left pr-2 font-normal">Src</th>
                <th className="text-left pr-2 font-normal">Model</th>
                <th className="text-right pr-2 font-normal">Tokens</th>
                <th className="text-right pr-2 font-normal">Cost</th>
                <th className="text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r: LlmRequestEvent) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border)] border-opacity-30 hover:bg-[var(--color-bg-muted)]"
                >
                  <td className="py-1 pr-2 text-[var(--color-fg-subtle)] whitespace-nowrap">
                    <div className="font-mono">
                      {new Date(r.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </div>
                    <div className="text-[9px]">{new Date(r.timestamp).toLocaleDateString([], {
                      month: "short",
                      day: "2-digit",
                      year: "numeric",
                    })}</div>
                  </td>
                  <td className="pr-2 font-medium">{r.analyst}</td>
                  <td className="pr-2 text-[var(--color-fg-subtle)]">
                    {r.purpose}
                    {r.ticker ? ` (${r.ticker})` : ""}
                  </td>
                  <td className="pr-2 text-[9px] text-[var(--color-fg-subtle)]">
                    {formatAttribution(r.attributionSource, r.sourceClass)}
                  </td>
                  <td className="pr-2 font-mono text-[9px] text-[var(--color-fg-subtle)]">
                    {r.model.split("/").slice(-1)[0]}
                  </td>
                  <td className="pr-2 text-right">
                    {((r.tokensIn + r.tokensOut) / 1000).toFixed(1)}k
                  </td>
                  <td className="pr-2 text-right text-[var(--color-accent-green)]">
                    ${r.costUsd.toFixed(4)}
                  </td>
                  <td
                    className={
                      r.status === "success"
                        ? "text-[var(--color-accent-green)]"
                        : "text-[var(--color-accent-red)]"
                    }
                  >
                    <div>{r.status}</div>
                    {(r.errorMessage || r.rejectionReason) && (
                      <div className="max-w-48 truncate text-[9px] text-[var(--color-fg-subtle)]">
                        {r.errorMessage ?? r.rejectionReason}
                      </div>
                    )}
                    {r.jobId && (
                      <div className="text-[9px] text-[var(--color-fg-subtle)]">
                        {r.jobId}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span className="text-[var(--color-fg-subtle)]">
              Showing {recentTotal === 0 ? 0 : recentOffset + 1}
              {"-"}
              {recentOffset + data.recent.length} of {recentTotal}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
                disabled={!hasPrev}
                className="px-2 py-0.5 rounded border disabled:opacity-40"
                style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}
              >
                Prev
              </button>
              <button
                onClick={() => setOffset((current) => current + pageSize)}
                disabled={!hasNext}
                className="px-2 py-0.5 rounded border disabled:opacity-40"
                style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- System Controls ----
function SystemControls({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: sys, isLoading } = useQuery({
    queryKey: ["admin-system"],
    queryFn: adminGetSystem,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const [lockReason,    setLockReason]    = useState("");
  const [lockedUntil,  setLockedUntil]    = useState("");
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastType, setBroadcastType] = useState<"info" | "warning" | "error">("info");
  const [showBroadcast, setShowBroadcast] = useState(false);

  const patch = async (p: SystemControlPatch) => {
    try {
      await adminPatchSystem(p);
      void qc.invalidateQueries({ queryKey: ["admin-system"] });
    } catch (e) {
      onError(e instanceof Error ? e.message : "System update failed");
    }
  };

  const handleLockToggle = () => {
    if (sys?.locked) {
      void patch({ locked: false });
    } else {
      void patch({ locked: true, lockReason: lockReason || "System locked by admin", lockedUntil: lockedUntil || null });
    }
  };

  const handleBroadcast = () => {
    if (!broadcastText.trim()) return;
    void patch({ broadcast: { text: broadcastText.trim(), type: broadcastType, dismissible: true, expiresAt: null } });
    setBroadcastText(""); setShowBroadcast(false);
  };

  const clearBroadcast = () => void patch({ broadcast: null });
  const isLocked = sys?.locked ?? false;

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{
        background: isLocked ? "rgba(239,68,68,0.05)" : "var(--color-bg-subtle)",
        borderColor: isLocked ? "rgba(239,68,68,0.3)" : "var(--color-border)",
      }}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>
          ⚡ System Controls
        </h3>
        {isLocked && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(239,68,68,0.15)", color: "var(--color-accent-red)" }}>
            LOCKED
          </span>
        )}
      </div>

      <div className="space-y-2">
        {!isLocked && (
          <div className="flex gap-2">
            <input value={lockReason} onChange={e => setLockReason(e.target.value)}
              placeholder="Lock reason (shown to users)"
              className="flex-1 text-xs rounded-lg px-3 py-1.5 outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
            />
            <input type="datetime-local" value={lockedUntil} onChange={e => setLockedUntil(e.target.value)}
              title="Auto-unlock at (optional)"
              className="text-xs rounded-lg px-2 py-1.5 outline-none w-44"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}
            />
          </div>
        )}
        {isLocked && sys?.lockReason && (
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>
            Reason: <span style={{ color: "var(--color-fg-default)" }}>{sys.lockReason}</span>
            {sys.lockedUntil && <> · until {new Date(sys.lockedUntil).toLocaleString()}</>}
          </p>
        )}
        <button onClick={handleLockToggle} disabled={isLoading}
          className="w-full py-2 rounded-lg text-xs font-bold transition-colors"
          style={isLocked
            ? { background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "var(--color-accent-green)" }
            : { background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-accent-red)" }}>
          {isLocked ? "🔓 Unlock — Resume Normal Operations" : "🔒 Lock All Users"}
        </button>
      </div>

      <div className="border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        {sys?.broadcast ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[10px] uppercase font-bold" style={{ color: "var(--color-fg-muted)" }}>Broadcast active</span>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-fg-default)" }}>{sys.broadcast.text}</p>
            </div>
            <button onClick={clearBroadcast}
              className="shrink-0 text-xs px-2 py-1 rounded"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              Clear
            </button>
          </div>
        ) : showBroadcast ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={broadcastType} onChange={e => setBroadcastType(e.target.value as "info" | "warning" | "error")}
                className="text-xs rounded-lg px-2 py-1.5 outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}>
                <option value="info">ℹ Info</option>
                <option value="warning">⚠ Warning</option>
                <option value="error">⊗ Error</option>
              </select>
              <input value={broadcastText} onChange={e => setBroadcastText(e.target.value)}
                placeholder="Message to show all users..."
                className="flex-1 text-xs rounded-lg px-3 py-1.5 outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleBroadcast}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                style={{ background: "var(--color-accent-blue)", color: "white" }}>
                Send Broadcast
              </button>
              <button onClick={() => setShowBroadcast(false)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowBroadcast(true)}
            className="w-full py-2 rounded-lg text-xs font-medium"
            style={{ background: "var(--color-bg-muted)", border: "1px dashed var(--color-border)", color: "var(--color-fg-muted)" }}>
            📢 Send Broadcast Message to All Users
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Block Controls ----
const RESTRICTION_LABELS = {
  readonly:  { label: "Read-only",  color: "#3b82f6", bg: "rgba(59,130,246,0.12)"  },
  blocked:   { label: "Blocked",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
  suspended: { label: "Suspended",  color: "#ef4444", bg: "rgba(239,68,68,0.12)"   },
};

function BlockControls({
  userId,
  currentRestriction,
  onChanged,
  onError,
}: {
  userId: string;
  currentRestriction: "readonly" | "blocked" | "suspended" | null;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [open,      setOpen]      = useState(false);
  const [mode,      setMode]      = useState<"readonly" | "blocked" | "suspended">("blocked");
  const [reason,    setReason]    = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [loading,   setLoading]   = useState(false);

  const handleApply = async () => {
    setLoading(true);
    try {
      await adminSetUserControl(userId, { restriction: mode, reason: reason.trim(), restrictedUntil: untilDate || null } as UserControlPatch);
      onChanged();
      setOpen(false);
      setReason(""); setUntilDate("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to apply restriction");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      await adminClearUserControl(userId);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to clear restriction");
    } finally {
      setLoading(false);
    }
  };

  const rlabel = currentRestriction ? RESTRICTION_LABELS[currentRestriction] : null;

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {rlabel && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: rlabel.bg, color: rlabel.color, border: `1px solid ${rlabel.color}40` }}>
            {rlabel.label}
          </span>
        )}
        <button onClick={() => setOpen(o => !o)}
          className="text-[10px] px-2 py-1 rounded-lg font-medium transition-colors"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
          {currentRestriction ? "Change restriction ▾" : "Restrict user ▾"}
        </button>
        {currentRestriction && (
          <button onClick={handleClear} disabled={loading}
            className="text-[10px] px-2 py-1 rounded-lg font-medium"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", color: "var(--color-accent-green)" }}>
            ✓ Unblock
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-xl p-3 space-y-2.5"
          style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>
            Restriction level
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(["readonly", "blocked", "suspended"] as const).map(r => {
              const lbl = RESTRICTION_LABELS[r];
              const active = mode === r;
              return (
                <button key={r} onClick={() => setMode(r)}
                  className="py-2 rounded-lg text-[11px] font-bold transition-all"
                  style={{
                    background: active ? lbl.bg : "var(--color-bg-muted)",
                    border: `1px solid ${active ? lbl.color + "80" : "var(--color-border)"}`,
                    color: active ? lbl.color : "var(--color-fg-muted)",
                  }}>
                  {lbl.label}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] space-y-1" style={{ color: "var(--color-fg-muted)" }}>
            {mode === "readonly"  && <p>Can view dashboard. Job triggers disabled. Info banner shown.</p>}
            {mode === "blocked"   && <p>Can view dashboard. Job triggers disabled. Warning banner shown.</p>}
            {mode === "suspended" && <p>Sees suspension page only. No dashboard access. Login still works.</p>}
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder={`Reason shown to user (${mode === "suspended" ? "required" : "optional"})`}
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
          />
          <div className="flex gap-2 items-center">
            <input type="datetime-local" value={untilDate} onChange={e => setUntilDate(e.target.value)}
              title="Auto-expire restriction at"
              className="text-xs rounded-lg px-2 py-1.5 outline-none flex-1"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}
            />
            <span className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>or indefinite</span>
          </div>
          <div className="flex gap-2">
            <button onClick={handleApply} disabled={loading || (mode === "suspended" && !reason.trim())}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
              style={{ background: RESTRICTION_LABELS[mode].bg, border: `1px solid ${RESTRICTION_LABELS[mode].color}60`, color: RESTRICTION_LABELS[mode].color }}>
              {loading ? "Applying…" : `Apply ${RESTRICTION_LABELS[mode].label}`}
            </button>
            <button onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Job status helpers ────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  daily_brief: "Daily Brief",
  full_report: "Full Report",
  deep_dive: "Deep Dive",
  new_ideas: "New Ideas",
  switch_production: "→ Production",
  switch_testing: "→ Testing",
};

function cleanIntegrityMessage(msg: string): string {
  return msg.replace(/\/root\/[^\s]+\/data\//g, "").replace(/\/root\/[^\s]+\//g, "").trim();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function UserStepQueueJobs({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const { data = [], error, isLoading, refetch } = useQuery({
    queryKey: ["admin-user-step-queue-jobs", userId],
    queryFn: () => adminListStepQueueJobs(5, userId),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (error) onError(error instanceof Error ? error.message : "Failed to load user step-queue jobs");
  }, [error, onError]);

  const doAction = async (jobId: string, action: "pause" | "resume" | "kill") => {
    setActionLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      if (action === "pause") await adminPauseStepQueueJob(jobId);
      else if (action === "resume") await adminResumeStepQueueJob(jobId);
      else await adminKillJob(userId, jobId);
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["admin-user-step-queue-jobs", userId] });
    } catch (e) {
      onError(e instanceof Error ? e.message : `Failed to ${action} job`);
    } finally {
      setActionLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  };

  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>
          Step-queue jobs
        </p>
        <button onClick={() => void refetch()} className="text-[10px] underline" style={{ color: "var(--color-accent-blue)" }}>
          Refresh
        </button>
      </div>
      {isLoading ? (
        <p className="mt-1 text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>Loading queue jobs...</p>
      ) : data.length === 0 ? (
        <p className="mt-1 text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>No backend queue jobs for this user.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {data.map((job) => {
            const pct = job.step_count > 0
              ? Math.round(((job.completed_steps + job.failed_steps) / job.step_count) * 100)
              : 0;
            const loading = actionLoading[job.id] ?? false;
            const canPause = job.status === "running" || job.status === "pending";
            const canResume = job.status === "paused";
            const canKill = job.status === "running" || job.status === "pending" || job.status === "paused";
            return (
              <div key={job.id} className="rounded-lg border p-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold truncate">
                      {ACTION_LABELS[job.action] ?? job.action} · {job.model_tier}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                      {job.id.slice(-10)} · {timeAgo(job.triggered_at)}
                      {job.started_at ? ` · elapsed ${formatElapsed(job.started_at, job.completed_at)}` : ""}
                    </p>
                  </div>
                  <StepQueueStatusBadge status={job.status} />
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-bg-muted)" }}>
                  <div
                    className={job.failed_steps > 0 ? "h-full bg-amber-500" : "h-full bg-[var(--color-accent-green)]"}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                  {job.completed_steps}/{job.step_count} completed · {job.failed_steps} failed · {job.ticker_count} tickers
                  {job.failure_reason ? ` · ${job.failure_reason.slice(0, 120)}` : ""}
                </p>
                {(canPause || canResume || canKill) && (
                  <div className="flex gap-1 mt-1.5">
                    {canResume && (
                      <button disabled={loading} onClick={() => void doAction(job.id, "resume")}
                        className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-40"
                        style={{ background: "rgba(66,201,122,0.1)", border: "1px solid rgba(66,201,122,0.3)", color: "var(--color-accent-green)" }}>
                        {loading ? "…" : "▶ Resume"}
                      </button>
                    )}
                    {canPause && (
                      <button disabled={loading} onClick={() => void doAction(job.id, "pause")}
                        className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-40"
                        style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
                        {loading ? "…" : "⏸ Pause"}
                      </button>
                    )}
                    {canKill && (
                      <button disabled={loading} onClick={() => void doAction(job.id, "kill")}
                        className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-40"
                        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
                        {loading ? "…" : "✕ Kill"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- User Card ----
function UserCard({
  user,
  onDelete,
  onUpdatePointsBudget,
  onUpdateModelTier,
  onAddTelegram,
  onControlChanged,
  onError,
}: {
  user: UserSummary;
  onDelete: (userId: string) => void;
  onUpdatePointsBudget: (userId: string, budget: PointsBudget) => Promise<void>;
  onUpdateModelTier: (userId: string, modelTier: ModelTier) => Promise<void>;
  onAddTelegram: (userId: string, botToken: string, chatId: string) => void;
  onControlChanged: () => void;
  onError: (msg: string) => void;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [expanded,       setExpanded]      = useState(false);
  const [showPointsBudget, setShowPointsBudget] = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showTelegram,  setShowTelegram]  = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [modelTierLoading, setModelTierLoading] = useState(false);
  const [botToken,      setBotToken]      = useState("");
  const [chatId,        setChatId]        = useState(user.telegramChatId ?? "");

  const restriction = user.restriction;

  const STATE_LABELS: Record<string, { label: string; color: string; description: string }> = {
    ACTIVE: { label: "Active", color: "text-green-400", description: "Fully operational — portfolio loaded and analysis pipeline running." },
    BOOTSTRAPPING: { label: "Bootstrapping", color: "text-blue-400", description: "Initial analysis running — portfolio loaded, first reports in progress." },
    INCOMPLETE: { label: "Incomplete", color: "text-slate-400", description: "Not yet onboarded — no portfolio loaded." },
    BLOCKED: { label: "Blocked", color: "text-red-400", description: "Admin-restricted — user cannot access the system." },
  };
  const stateInfo = STATE_LABELS[user.state] ?? { label: user.state, color: "text-slate-400", description: "" };

  const handleDelete = async () => {
    if (deleteConfirm !== user.userId) return;
    setDeleting(true);
    try { await onDelete(user.userId); }
    finally { setDeleting(false); setShowDelete(false); setDeleteConfirm(""); }
  };

  const handleForceLogout = async () => {
    setLogoutLoading(true);
    try { await adminForceLogout(user.userId); }
    catch (e) { onError(e instanceof Error ? e.message : "Force logout failed"); }
    finally { setLogoutLoading(false); }
  };

  const handleModelTierChange = async (modelTier: ModelTier) => {
    setModelTierLoading(true);
    try {
      await onUpdateModelTier(user.userId, modelTier);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to update model tier");
    } finally {
      setModelTierLoading(false);
    }
  };

  const portfolioLabel = user.portfolioLoaded ? t("adminPortfolioLoaded", language) : t("adminPortfolioMissing", language);
  const eligibilityIssueLabel = user.eligibilityIssue
    ? `Daily scheduling paused: ${user.eligibilityIssue}.`
    : null;
  const integrityIssueLabel = user.integrityErrors[0]
    ? `Integrity: ${cleanIntegrityMessage(user.integrityErrors[0])}`
    : user.integrityWarnings[0]
      ? `Integrity warning: ${cleanIntegrityMessage(user.integrityWarnings[0])}`
      : null;

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{
        background: "var(--color-bg-subtle)",
        borderColor: restriction === "suspended" ? "rgba(239,68,68,0.4)"
          : restriction === "blocked"  ? "rgba(245,158,11,0.4)"
          : restriction === "readonly" ? "rgba(59,130,246,0.3)"
          : "var(--color-border)",
      }}>

      {/* Header row — always visible, click to expand/collapse */}
      <button
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm" style={{ color: "var(--color-fg-default)" }}>{user.displayName}</span>
              <span className="text-[10px] font-mono" style={{ color: "var(--color-fg-subtle)" }}>@{user.userId}</span>
            </div>
            <p className={`text-[10px] font-medium uppercase mt-0.5 ${stateInfo.color}`}>
              {stateInfo.label} · {portfolioLabel}
            </p>
            {eligibilityIssueLabel && (
              <p className="mt-1 text-[10px] font-medium" style={{ color: "var(--color-accent-yellow)" }}>
                {eligibilityIssueLabel}
              </p>
            )}
            {integrityIssueLabel && (
              <p
                className="mt-1 text-[10px]"
                style={{
                  color: user.integrityErrors.length > 0
                    ? "var(--color-accent-red)"
                    : "var(--color-fg-muted)",
                }}
              >
                {integrityIssueLabel}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <UserHealthBadge state={user.state} portfolioLoaded={user.portfolioLoaded} restriction={user.restriction} />
            <span className="text-[11px]" style={{ color: "var(--color-fg-subtle)" }}>{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </button>

      {expanded && <>
      {/* Meta row */}
      <div className="text-[11px] space-y-0.5" style={{ color: "var(--color-fg-muted)" }}>
        {user.hasTelegram
          ? <p>{t("adminTelegramYes", language)}{user.telegramChatId ? ` (${user.telegramChatId})` : ""}</p>
          : <p>{t("adminTelegramNo", language)}</p>}
        <UserActivityBadge userId={user.userId} />
      </div>

      {/* Block controls */}
      <BlockControls
        userId={user.userId}
        currentRestriction={restriction}
        onChanged={onControlChanged}
        onError={onError}
      />

      {/* Jobs panel */}
      <UserStepQueueJobs userId={user.userId} onError={onError} />

      {/* Readiness card (S07) */}
      <ReadinessCard userId={user.userId} />

      {/* Actions row */}
      <div className="flex gap-1.5 flex-wrap pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
        <select
          value={user.modelTier}
          disabled={modelTierLoading}
          onChange={(e) => void handleModelTierChange(e.target.value as ModelTier)}
          title="Step-queue model tier for new jobs"
          className="rounded-lg px-2.5 py-1 text-[10px] font-bold outline-none disabled:opacity-50"
          style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.28)", color: "var(--color-accent-blue)" }}
        >
          <option value="free">free models</option>
          <option value="cheap">cheap models</option>
          <option value="balanced">balanced models</option>
          <option value="expensive">expensive models</option>
        </select>
        <button onClick={() => setShowTelegram(!showTelegram)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium"
          style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
          {user.hasTelegram ? t("adminEditTelegram", language) : t("adminAddTelegram", language)}
        </button>
        <button onClick={() => setShowPointsBudget(!showPointsBudget)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium"
          style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
          Edit points budget
        </button>
        <button
          onClick={async () => {
            const pts = window.prompt(`Grant one-time credit to ${user.userId}\nPoints (e.g. 200):`);
            if (!pts) return;
            const n = Number(pts);
            if (!Number.isFinite(n) || n <= 0) { alert("Enter a positive number"); return; }
            const note = window.prompt("Note (optional):") ?? "";
            try {
              const adminKey = sessionStorage.getItem("admin_key") ?? "";
              await fetch(`/api/admin/users/${user.userId}/budget/credit`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
                body: JSON.stringify({ points: n, note }),
              });
              alert(`Granted ${n} pts to ${user.userId} (expires in 24h)`);
            } catch { alert("Failed to grant credit"); }
          }}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium"
          style={{ background: "rgba(66,201,122,0.08)", border: "1px solid rgba(66,201,122,0.25)", color: "var(--color-green)" }}>
          + Grant credit
        </button>
        <button onClick={handleForceLogout} disabled={logoutLoading}
          title="Invalidate all active sessions"
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-40"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#f59e0b" }}>
          {logoutLoading ? "…" : "⟳ Force logout"}
        </button>
        <ViewAsUserButton userId={user.userId} />
        <button onClick={() => setShowDelete(true)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium ml-auto"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
          {t("delete", language)}
        </button>
      </div>

      {/* Edit Telegram */}
      {showTelegram && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>{t("adminTelegramSection", language)}</p>
          <input value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="Bot token"
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
          <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="Chat ID"
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
          <div className="flex gap-2">
            <button onClick={() => { onAddTelegram(user.userId, botToken, chatId); setShowTelegram(false); }}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: "var(--color-accent-blue)", color: "white" }}>
              {t("adminSaveTelegram", language)}
            </button>
            <button onClick={() => setShowTelegram(false)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              {t("cancel", language)}
            </button>
          </div>
        </div>
      )}

      {showPointsBudget && (
        <div className="rounded-lg p-3" style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--color-fg-muted)" }}>
            Daily points budget
          </p>
          <PointsBudgetEditor
            budget={user.pointsBudget}
            onSave={async (budget) => {
              await onUpdatePointsBudget(user.userId, budget);
              setShowPointsBudget(false);
            }}
            onCancel={() => setShowPointsBudget(false)}
          />
        </div>
      )}

      {/* Delete confirm */}
      {showDelete && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <p className="text-xs font-bold" style={{ color: "var(--color-accent-red)" }}>
            {t("adminTypeToConfirm", language)} <code>{user.userId}</code> {t("adminToConfirmDeletion", language)}
          </p>
          <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
            placeholder={user.userId}
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-fg-default)" }} />
          <div className="flex gap-2">
            <button onClick={handleDelete} disabled={deleteConfirm !== user.userId || deleting}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "var(--color-accent-red)" }}>
              {deleting ? t("adminDeleting", language) : t("adminConfirmDelete", language)}
            </button>
            <button onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              {t("cancel", language)}
            </button>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

const PILOT_FEATURE_STATUSES: Array<{ value: PilotFeatureReviewStatus; label: string; help: string }> = [
  { value: "unreviewed", label: "Unreviewed", help: "No owner decision recorded yet." },
  { value: "needs_fix", label: "Needs fix", help: "Description or behavior needs correction before pilot use." },
  { value: "beta", label: "Beta", help: "Acceptable for pilot use with known caveats." },
  { value: "hidden", label: "Hidden", help: "Should not be presented as pilot-ready." },
  { value: "ready", label: "Ready", help: "Description and behavior are approved for pilot use." },
];

const PILOT_FEATURE_SURFACES: Array<{ value: PilotFeatureSurface; label: string }> = [
  { value: "web", label: "Web" },
  { value: "telegram", label: "Telegram" },
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
];

type PilotFeatureDraft = {
  status: PilotFeatureReviewStatus;
  adminComment: string;
  incorrectDescription: boolean;
};

function statusLabel(status: PilotFeatureReviewStatus): string {
  return PILOT_FEATURE_STATUSES.find((item) => item.value === status)?.label ?? status;
}

function PilotFeaturesPanel({ onError }: { onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [surfaceFilter, setSurfaceFilter] = useState<PilotFeatureSurface | "">("");
  const [statusFilter, setStatusFilter] = useState<PilotFeatureReviewStatus | "">("");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, PilotFeatureDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["admin-pilot-features", surfaceFilter, statusFilter],
    queryFn: () => adminListPilotFeatures({ surface: surfaceFilter, status: statusFilter, limit: 200, offset: 0 }),
  });

  useEffect(() => {
    if (query.error) {
      onError(query.error instanceof Error ? query.error.message : "Failed to load pilot features");
    }
  }, [query.error, onError]);

  const features = query.data?.items ?? [];

  useEffect(() => {
    if (features.length === 0) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const feature of features) {
        if (!next[feature.id]) {
          next[feature.id] = {
            status: feature.review.status,
            adminComment: feature.review.adminComment ?? "",
            incorrectDescription: feature.review.incorrectDescription,
          };
        }
      }
      return next;
    });
  }, [features]);

  const visibleFeatures = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return features;
    return features.filter((feature) =>
      [
        feature.id,
        feature.surface,
        feature.title,
        feature.shortSummary,
        feature.detailedExplanation,
        feature.pilotRecommendation,
        ...feature.errorHandling,
        ...feature.evidencePaths,
      ].some((value) => value.toLowerCase().includes(needle))
    );
  }, [features, search]);

  const setDraft = (featureId: string, patch: Partial<PilotFeatureDraft>) => {
    setDrafts((current) => ({
      ...current,
      [featureId]: {
        status: current[featureId]?.status ?? "unreviewed",
        adminComment: current[featureId]?.adminComment ?? "",
        incorrectDescription: current[featureId]?.incorrectDescription ?? false,
        ...patch,
      },
    }));
    setSavedId((current) => (current === featureId ? null : current));
    setSaveErrors((current) => {
      if (!current[featureId]) return current;
      const next = { ...current };
      delete next[featureId];
      return next;
    });
  };

  const isDirty = (feature: PilotFeature, draft?: PilotFeatureDraft): boolean => {
    if (!draft) return false;
    return (
      draft.status !== feature.review.status ||
      draft.adminComment !== (feature.review.adminComment ?? "") ||
      draft.incorrectDescription !== feature.review.incorrectDescription
    );
  };

  const saveFeature = async (feature: PilotFeature) => {
    const draft = drafts[feature.id];
    if (!draft || savingId) return;
    setSavingId(feature.id);
    setSavedId(null);
    setSaveErrors((current) => {
      const next = { ...current };
      delete next[feature.id];
      return next;
    });
    try {
      const updated = await adminUpdatePilotFeatureReview(feature.id, {
        status: draft.status,
        adminComment: draft.adminComment.trim() ? draft.adminComment.trim() : null,
        incorrectDescription: draft.incorrectDescription,
      });
      setDrafts((current) => ({
        ...current,
        [feature.id]: {
          status: updated.review.status,
          adminComment: updated.review.adminComment ?? "",
          incorrectDescription: updated.review.incorrectDescription,
        },
      }));
      setSavedId(feature.id);
      await queryClient.invalidateQueries({ queryKey: ["admin-pilot-features"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save pilot feature review";
      setSaveErrors((current) => ({ ...current, [feature.id]: message }));
      onError(message);
    } finally {
      setSavingId(null);
    }
  };

  const clearFilters = () => {
    setSurfaceFilter("");
    setStatusFilter("");
    setSearch("");
  };

  const hasFilters = Boolean(surfaceFilter || statusFilter || search.trim());
  const total = query.data?.total ?? features.length;

  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
      <div className="px-4 py-4 space-y-3" style={{ background: "var(--color-bg-subtle)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide">Pilot Features</h2>
            <p className="text-[11px] mt-1 leading-5" style={{ color: "var(--color-fg-subtle)" }}>
              Browse the tracked pilot catalog, review error-handling expectations, and record admin review state.
            </p>
          </div>
          <span className="shrink-0 text-[10px] font-mono rounded-full px-2 py-1" style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
            {query.isFetching ? "Syncing" : `${total} total`}
          </span>
        </div>

        <div className="grid gap-2 md:grid-cols-[1fr,130px,140px,auto]">
          <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search descriptions, IDs, paths, or error handling"
              className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
            Surface
            <select
              value={surfaceFilter}
              onChange={(e) => setSurfaceFilter(e.target.value as PilotFeatureSurface | "")}
              className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
            >
              <option value="">All surfaces</option>
              {PILOT_FEATURE_SURFACES.map((surface) => (
                <option key={surface.value} value={surface.value}>{surface.label}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PilotFeatureReviewStatus | "")}
              className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
            >
              <option value="">All statuses</option>
              {PILOT_FEATURE_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              disabled={!hasFilters}
              className="w-full rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3" style={{ background: "var(--color-bg-base)" }} aria-live="polite">
        {query.isLoading ? (
          <div className="rounded-lg border p-4 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
            Loading pilot feature catalog and review state...
          </div>
        ) : query.error ? (
          <div className="rounded-lg border p-4 text-xs" role="alert" style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "var(--color-accent-red)" }}>
            Could not load pilot features: {query.error instanceof Error ? query.error.message : "Request failed"}
            <button onClick={() => void query.refetch()} className="ml-2 underline">Retry</button>
          </div>
        ) : features.length === 0 ? (
          <div className="rounded-lg border p-4 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
            No pilot features were returned. Clear filters or check the catalog and database connection.
          </div>
        ) : visibleFeatures.length === 0 ? (
          <div className="rounded-lg border p-4 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
            No pilot features match the current search. <button onClick={clearFilters} className="underline">Clear filters</button>.
          </div>
        ) : (
          visibleFeatures.map((feature) => {
            const draft = drafts[feature.id] ?? {
              status: feature.review.status,
              adminComment: feature.review.adminComment ?? "",
              incorrectDescription: feature.review.incorrectDescription,
            };
            const dirty = isDirty(feature, draft);
            const statusHelp = PILOT_FEATURE_STATUSES.find((item) => item.value === draft.status)?.help;
            const statusSelectId = `pilot-feature-status-${feature.id}`;
            const commentId = `pilot-feature-comment-${feature.id}`;
            const incorrectId = `pilot-feature-incorrect-${feature.id}`;
            return (
              <article key={feature.id} className="rounded-xl border p-4 space-y-4" style={{ borderColor: dirty ? "rgba(59,130,246,0.55)" : "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>{feature.surface}</span>
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: "rgba(59,130,246,0.10)", color: "var(--color-accent-blue)" }}>{feature.pilotRecommendation}</span>
                      <span className="font-mono text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>{feature.id}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-bold">{feature.title}</h3>
                    <p className="mt-1 text-xs leading-5" style={{ color: "var(--color-fg-muted)" }}>{feature.shortSummary}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: dirty ? "rgba(59,130,246,0.12)" : "var(--color-bg-muted)", color: dirty ? "var(--color-accent-blue)" : "var(--color-fg-subtle)" }}>
                    {savingId === feature.id ? "Saving" : savedId === feature.id ? "Saved" : dirty ? "Unsaved" : statusLabel(feature.review.status)}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>Detailed description</p>
                    <p className="mt-2 text-xs leading-5" style={{ color: "var(--color-fg-muted)" }}>{feature.detailedExplanation}</p>
                  </div>
                  <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>Error handling expectations</p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-5" style={{ color: "var(--color-fg-muted)" }}>
                      {feature.errorHandling.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  </div>
                </div>

                <details className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}>
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>Happy path, edge cases, and evidence</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs leading-5" style={{ color: "var(--color-fg-muted)" }}>
                    <div>
                      <p className="font-bold mb-1" style={{ color: "var(--color-fg-default)" }}>Happy path</p>
                      <ul className="space-y-1">{feature.happyPath.map((item) => <li key={item}>• {item}</li>)}</ul>
                    </div>
                    <div>
                      <p className="font-bold mb-1" style={{ color: "var(--color-fg-default)" }}>Edge cases</p>
                      <ul className="space-y-1">{feature.edgeCases.map((item) => <li key={item}>• {item}</li>)}</ul>
                    </div>
                    <div>
                      <p className="font-bold mb-1" style={{ color: "var(--color-fg-default)" }}>Evidence paths</p>
                      <ul className="space-y-1 font-mono text-[10px]">{feature.evidencePaths.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </details>

                <div className="grid gap-3 md:grid-cols-[180px,1fr]">
                  <label htmlFor={statusSelectId} className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
                    Review status
                    <select
                      id={statusSelectId}
                      value={draft.status}
                      onChange={(e) => setDraft(feature.id, { status: e.target.value as PilotFeatureReviewStatus })}
                      className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
                      style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
                    >
                      {PILOT_FEATURE_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                    </select>
                    <span className="mt-1 block normal-case font-normal leading-4" style={{ color: "var(--color-fg-subtle)" }}>{statusHelp}</span>
                  </label>
                  <label htmlFor={commentId} className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
                    Admin comment
                    <textarea
                      id={commentId}
                      value={draft.adminComment}
                      onChange={(e) => setDraft(feature.id, { adminComment: e.target.value })}
                      rows={3}
                      maxLength={2000}
                      placeholder="Optional context for the next review pass."
                      className="mt-1 w-full resize-y rounded-lg px-3 py-2 text-xs leading-5 outline-none"
                      style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <label htmlFor={incorrectId} className="inline-flex items-start gap-2 text-xs" style={{ color: "var(--color-fg-muted)" }}>
                    <input
                      id={incorrectId}
                      type="checkbox"
                      checked={draft.incorrectDescription}
                      onChange={(e) => setDraft(feature.id, { incorrectDescription: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>Mark description as incorrect or incomplete.</span>
                  </label>
                  <div className="flex items-center gap-2 md:justify-end">
                    <span className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                      Updated {feature.review.updatedAt ? new Date(feature.review.updatedAt).toLocaleString() : "never"}
                      {feature.review.updatedBy ? ` by ${feature.review.updatedBy}` : ""}
                    </span>
                    <button
                      onClick={() => void saveFeature(feature)}
                      disabled={!dirty || savingId !== null}
                      className="rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"
                      style={{ background: "var(--color-accent-blue)", color: "white" }}
                    >
                      {savingId === feature.id ? "Saving..." : savedId === feature.id ? "Saved" : "Save review"}
                    </button>
                  </div>
                </div>

                {saveErrors[feature.id] && (
                  <p className="rounded-lg px-3 py-2 text-xs" role="alert" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
                    Save failed: {saveErrors[feature.id]}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

// ---- View As User Button (S07) ----
function ViewAsUserButton({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);

  const handleViewAsUser = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await adminIssueImpersonationSession(userId, "admin panel view");
      setImpersonationState({
        token: result.token,
        sessionId: result.sessionId,
        targetUserId: result.targetUserId,
        expiresAt: result.expiresAt,
      });
      // Navigate to the user-facing app
      window.location.href = "/portfolio";
    } catch (e) {
      alert(`Could not start impersonation: ${e instanceof Error ? e.message : String(e)}`);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={() => { void handleViewAsUser(); }}
      disabled={loading}
      title="Open the app as this user (read-only, 15 min)"
      className="px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-40"
      style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.28)", color: "#8b5cf6" }}
    >
      {loading ? "…" : "👁 View as user"}
    </button>
  );
}

// ---- Readiness Card (S07) ----
function ReadinessCard({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery<UserReadiness>({
    queryKey: ["admin", "readiness", userId],
    queryFn: () => adminGetUserReadiness(userId),
    staleTime: 60_000,
  });

  if (isLoading) return <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>Loading readiness…</p>;
  if (error || !data) return null;

  const items: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: "State", value: data.state },
    { label: "Model tier", value: data.modelTier },
    { label: "Points remaining", value: `${Math.round(data.pointsRemaining)} / ${Math.round(data.pointsBudget)}`, warn: data.pointsRemaining < 50 },
    { label: "Job failures (24h)", value: String(data.jobFailures24h), warn: data.jobFailures24h > 0 },
    { label: "Telegram undelivered (24h)", value: String(data.telegramUndelivered24h), warn: data.telegramUndelivered24h > 0 },
    { label: "Last daily brief", value: data.lastDailyBriefAt ? new Date(data.lastDailyBriefAt).toLocaleString() : "never" },
    { label: "Last Telegram delivery", value: data.lastTelegramDeliveryAt ? new Date(data.lastTelegramDeliveryAt).toLocaleString() : "never" },
  ];

  return (
    <div className="rounded-xl border p-3 mt-2 space-y-1" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-muted)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>Readiness</p>
      {items.map(({ label, value, warn }) => (
        <div key={label} className="flex justify-between gap-2 text-xs">
          <span style={{ color: "var(--color-fg-muted)" }}>{label}</span>
          <span className="font-medium" style={{ color: warn ? "var(--color-accent-red)" : "var(--color-fg-default)" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Audit Log Tab (S07) ----
function AuditLogTab() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    adminListAuditEvents({ limit: 100 })
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit log"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm p-4" style={{ color: "var(--color-fg-muted)" }}>Loading audit log…</p>;
  if (error) return <p className="text-sm p-4" style={{ color: "var(--color-accent-red)" }}>{error}</p>;
  if (events.length === 0) return <p className="text-sm p-4" style={{ color: "var(--color-fg-muted)" }}>No audit events yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
            {["Time", "Action", "Actor", "Target", "Status"].map((h) => (
              <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: "var(--color-fg-muted)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td className="px-3 py-1.5 font-mono" style={{ color: "var(--color-fg-subtle)" }}>
                {new Date(ev.occurredAt).toLocaleString()}
              </td>
              <td className="px-3 py-1.5 font-medium" style={{ color: "var(--color-fg-default)" }}>{ev.actionType}</td>
              <td className="px-3 py-1.5" style={{ color: "var(--color-fg-muted)" }}>{ev.actorAdminId}</td>
              <td className="px-3 py-1.5" style={{ color: "var(--color-fg-muted)" }}>{ev.targetUserId ?? "—"}</td>
              <td className="px-3 py-1.5">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                  style={{
                    background: ev.resultStatus === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                    color: ev.resultStatus === "success" ? "var(--color-green)" : "var(--color-accent-red)",
                  }}
                >
                  {ev.resultStatus}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Main Admin Page ----
export function Admin() {
  const language = usePreferencesStore((s) => s.language);
  const isLoggedIn = !!sessionStorage.getItem("admin_key");
  const [loggedIn, setLoggedIn] = useState(isLoggedIn);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"overview" | "users" | "features" | "support" | "audit" | "settings">("overview");
  const [userSearch, setUserSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { users: u } = await adminFetchUsers();
      setUsers(u);
    } catch {
      // handled by login
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  const handleDelete = async (userId: string) => {
    await adminDeleteUser(userId);
    setUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  const handleUpdatePointsBudget = async (userId: string, budget: PointsBudget): Promise<void> => {
    await adminUpdatePointsBudget(userId, budget);
    setUsers((prev) =>
      prev.map((u) =>
        u.userId === userId
          ? {
              ...u,
              pointsBudget: budget,
            }
          : u
      )
    );
  };

  const handleUpdateModelTier = async (userId: string, modelTier: ModelTier): Promise<void> => {
    await adminUpdateUserModelTier(userId, modelTier);
    setUsers((prev) =>
      prev.map((u) =>
        u.userId === userId
          ? {
              ...u,
              modelTier,
            }
          : u
      )
    );
  };

  const handleAddTelegram = async (userId: string, botToken: string, chatId: string) => {
    await adminAddTelegram(userId, botToken, chatId);
    load();
  };

  const restrictedCount = users.filter((user) => user.restriction !== null).length;
  const unhealthyCount = users.filter((user) => user.state === "ACTIVE" && !user.portfolioLoaded).length;
  const degradedCount = users.filter(
    (user) => !user.integrityValid || user.eligibilityIssue !== null
  ).length;
  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [
        user.userId,
        user.displayName,
        user.state,
        user.modelTier,
        user.restriction ?? "",
        user.eligibilityIssue ?? "",
      ].some((value) => value.toLowerCase().includes(needle))
    );
  }, [userSearch, users]);

  if (!loggedIn) return <AdminLogin onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg-base)", color: "var(--color-fg-default)" }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-30 border-b px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🦞</span>
          <span className="font-bold text-sm">{t("adminTitle", language)}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { sessionStorage.removeItem("admin_key"); setLoggedIn(false); }}
            className="text-[10px] px-2 py-1 rounded"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
            {t("logout", language)}
          </button>
        </div>
      </div>

      <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">

        <div className="grid grid-cols-6 gap-2 rounded-xl border p-1" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
          {[
            { key: "overview", label: "Overview" },
            { key: "users", label: "Users" },
            { key: "features", label: "Features" },
            { key: "support", label: "Support" },
            { key: "audit", label: "Audit" },
            { key: "settings", label: "Settings" },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key as typeof activeSection)}
              className="rounded-lg py-2 text-xs font-bold"
              style={{
                background: activeSection === item.key ? "var(--color-accent-blue)" : "transparent",
                color: activeSection === item.key ? "white" : "var(--color-fg-muted)",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded-lg px-3 py-2 text-xs flex items-center justify-between"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {activeSection === "overview" && (
          <>
            <OperationsOverview
              users={users}
              degradedCount={degradedCount}
              unhealthyCount={unhealthyCount}
              restrictedCount={restrictedCount}
              onError={setError}
            />
            <StepQueueInspector onError={setError} />
          </>
        )}

        {activeSection === "users" && (
          <>
            <div className="rounded-xl border p-3 space-y-2" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
              <div className="flex gap-2">
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users by id, name, state, model, restriction..."
                  className="flex-1 rounded-lg px-3 py-2 text-xs outline-none"
                  style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
                />
                <button onClick={() => setShowAdd(true)}
                  className="px-3 py-2 rounded-lg text-xs font-bold"
                  style={{ background: "var(--color-accent-blue)", color: "white" }}>
                  + User
                </button>
              </div>
              <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                Showing {filteredUsers.length} of {users.length} users.
              </p>
            </div>

            {loading && users.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: "var(--color-fg-muted)" }}>{t("loading", language)}</div>
            ) : users.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: "var(--color-fg-muted)" }}>{t("adminNoUsers", language)}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: "var(--color-fg-muted)" }}>No users match this search.</div>
            ) : (
              <div className="space-y-3">
                {filteredUsers.map(u => (
                  <UserCard
                    key={u.userId}
                    user={u}
                    onDelete={handleDelete}
                    onUpdatePointsBudget={handleUpdatePointsBudget}
                    onUpdateModelTier={handleUpdateModelTier}
                    onAddTelegram={handleAddTelegram}
                    onControlChanged={load}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeSection === "features" && <PilotFeaturesPanel onError={setError} />}

        {activeSection === "support" && <SupportInbox onError={setError} />}

        {activeSection === "audit" && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            <div className="px-4 py-3" style={{ background: "var(--color-bg-subtle)" }}>
              <h2 className="text-xs font-bold uppercase tracking-wide">Audit Log</h2>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--color-fg-subtle)" }}>
                Last 100 admin actions — impersonation issuances, blocked writes, and mutations.
              </p>
            </div>
            <AuditLogTab />
          </div>
        )}

        {activeSection === "settings" && (
          <>
            <SystemControls onError={(m) => setError(m)} />
            <AdminDefaultsPanel onError={setError} onChanged={load} />
            <StepQueueModelsPanel onError={setError} />
          </>
        )}

      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
