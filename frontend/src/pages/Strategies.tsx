import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStrategies } from "../api/strategies";
import { triggerJob } from "../api/jobs";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { VerdictBadge, ConfidenceBadge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { formatILS, timeAgo } from "../utils/format";
import { usePreferencesStore } from "../store/preferencesStore";
import { useToastStore } from "../store/toastStore";
import { t, tConfidence, tTimeframe } from "../store/i18n";
import type { JobAction, Verdict, StrategyRow } from "../types/api";

const VERDICT_ORDER: Record<Verdict, number> = {
  SELL: 0,
  CLOSE: 0,
  REDUCE: 1,
  BUY: 2,
  ADD: 2,
  HOLD: 3,
};

const VERDICT_FILTER_OPTIONS = ["All", "BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"] as const;
type StrategyScope = "portfolio" | "tracking";

function strategyScope(strategy: StrategyRow): StrategyScope {
  return strategy.scope ?? (strategy.inPortfolio ? "portfolio" : "tracking");
}

function formatTrackingMeta(strategy: StrategyRow): string | null {
  if (strategyScope(strategy) !== "tracking") return null;
  const parts = [
    strategy.stance ? strategy.stance.replace(/_/g, " ") : null,
    typeof strategy.potentialScore === "number" ? `${strategy.potentialScore}/100 potential` : null,
    typeof strategy.urgencyScore === "number" ? `${strategy.urgencyScore}/100 urgency` : null,
    typeof strategy.suggestedAllocationPct === "number" ? `${strategy.suggestedAllocationPct.toFixed(1)}% suggested` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "Tracked idea";
}

function sortStrategies(strategies: StrategyRow[]): StrategyRow[] {
  return [...strategies].sort((a, b) => {
    const orderA = VERDICT_ORDER[a.verdict] ?? 99;
    const orderB = VERDICT_ORDER[b.verdict] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.ticker.localeCompare(b.ticker);
  });
}

function actionTitle(action: JobAction, language: ReturnType<typeof usePreferencesStore.getState>["language"]): string {
  switch (action) {
    case "daily_brief":
      return t("jobDailyTitle", language);
    case "full_report":
      return "Full Report";
    case "deep_dive":
      return t("jobDeepDiveTitle", language);
    case "quick_check":
      return "Quick Check";
    default:
      return action.replace(/_/g, " ");
  }
}

interface ActionMenuItem {
  label: string;
  action: JobAction;
  ticker?: string;
  disabled?: boolean;
  helper: string;
}

interface PendingConfirmation {
  action: JobAction;
  ticker?: string;
  title: string;
  helper: string;
}

function ActionsDropdown({
  label,
  items,
  pendingAction,
  onSelect,
}: {
  label: string;
  items: ActionMenuItem[];
  pendingAction: string | null;
  onSelect: (item: ActionMenuItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasEnabledItems = items.some((item) => !item.disabled);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={!hasEnabledItems}
        className="inline-flex h-9 min-w-[110px] items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 text-sm font-medium text-[var(--color-fg-default)] shadow-sm transition-colors hover:bg-[var(--color-bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--color-fg-subtle)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-[240px] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-base)] p-1.5 shadow-[0_20px_48px_rgba(15,23,42,0.22)]">
          <div className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Analysis actions
          </div>
          {items.map((item) => {
            const key = `${item.action}:${item.ticker ?? "all"}`;
            const busy = pendingAction === key;
            return (
              <button
                key={key}
                type="button"
                disabled={item.disabled || busy}
                onClick={() => {
                  setOpen(false);
                  onSelect(item);
                }}
                className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--color-fg-default)]">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-fg-subtle)]">{item.helper}</span>
                </span>
                <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  busy
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                    : "border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-fg-subtle)]"
                }`}>
                  {busy ? "Queued" : "Run"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmActionModal({
  request,
  submitting,
  onCancel,
  onConfirm,
}: {
  request: PendingConfirmation | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-5 text-slate-100 shadow-[0_28px_60px_rgba(15,23,42,0.4)]">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <p className="text-xs font-medium text-slate-400">Confirm analysis run</p>
          <p className="mt-1 text-base font-medium text-slate-100">
            {request.title}
            {request.ticker ? ` · ${request.ticker}` : ""}
          </p>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-300">{request.helper}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="h-10 rounded-xl border border-slate-700 bg-slate-900 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="h-10 rounded-xl border border-slate-100 bg-slate-100 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Strategies() {
  const language = usePreferencesStore((s) => s.language);
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<string>("All");
  const [scope, setScope] = useState<StrategyScope>("portfolio");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<PendingConfirmation | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategies"],
    queryFn: fetchStrategies,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = sortStrategies(data.strategies);
    list = list.filter((strategy) => strategyScope(strategy) === scope);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter((s) => s.ticker.includes(q));
    }
    if (verdictFilter !== "All") {
      list = list.filter((s) => s.verdict === verdictFilter);
    }
    return list;
  }, [data, scope, search, verdictFilter]);

  const isEmpty = filtered.length === 0 && !(data?.strategies ?? []).some((strategy) => strategyScope(strategy) === scope);
  const noResults = !isEmpty && filtered.length === 0;

  const requestAction = (item: ActionMenuItem) => {
    setConfirmRequest({
      action: item.action,
      ticker: item.ticker,
      title: item.label,
      helper: item.helper,
    });
  };

  const executeAction = async () => {
    if (!confirmRequest) return;
    const { action, ticker } = confirmRequest;
    const key = `${action}:${ticker ?? "all"}`;
    setPendingAction(key);
    try {
      await triggerJob(action, ticker);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
      showToast(
        ticker
          ? `Accepted: ${actionTitle(action, language)} queued for ${ticker}`
          : `Accepted: ${actionTitle(action, language)} queued`,
        "success"
      );
      setConfirmRequest(null);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { reason?: string; error?: string } } };
      const reason = axiosErr.response?.data?.reason || axiosErr.response?.data?.error;
      showToast(reason || `${t("jobFailed", language)}: ${actionTitle(action, language)}`, "error");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <>
      <div style={{ padding: "20px 16px 0" }}>
        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)", color: "var(--text-primary)", margin: 0 }}>
          {t("strategies", language)}
        </h1>
      </div>

      <div className="space-y-3 px-4 pb-8 pt-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-1">
            {([
              ["portfolio", t("strategyTabPortfolio", language)],
              ["tracking", t("strategyTabNonPortfolio", language)],
            ] as const).map(([nextScope, label]) => (
              <button
                key={nextScope}
                onClick={() => setScope(nextScope)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                  scope === nextScope
                    ? "bg-[var(--color-bg-base)] text-[var(--color-fg-default)] shadow-sm"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto] xl:min-w-[520px]">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchTicker", language)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3.5 py-2.5 text-sm text-[var(--color-fg-default)] outline-none transition-colors focus:border-[var(--color-accent-blue)] placeholder:text-[var(--color-fg-subtle)]"
            />
            <div className="flex flex-wrap gap-1.5">
              {VERDICT_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setVerdictFilter(opt)}
                  className={`inline-flex h-8 min-w-[58px] items-center justify-center rounded-full border px-3 text-xs font-semibold transition-all ${
                    verdictFilter === opt
                      ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)] text-white shadow-sm"
                      : "border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg-default)]"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <ActionsDropdown
              label="Actions"
              pendingAction={pendingAction}
              onSelect={requestAction}
              items={[
                {
                  label: t("jobDailyTitle", language),
                  action: "daily_brief",
                  helper: "Run a same-day portfolio sweep focused on changes, catalysts, and attention points.",
                },
                {
                  label: "Full Report",
                  action: "full_report",
                  helper: "Run a full positions review across the portfolio with refreshed strategy output.",
                },
              ]}
            />
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {error && <ErrorState message={t("errorLoadStrategies", language)} onRetry={refetch} />}

        {isEmpty && !isLoading && <EmptyState message={t("emptyStrategies", language)} icon="🎯" />}

        {noResults && <EmptyState message={t("noStrategyMatches", language)} icon="🔍" />}

        {filtered.length > 0 ? (
          <>
            <div className="grid gap-3 md:hidden">
              {filtered.map((strategy) => {
                const rowActionsDisabled = !strategy.inPortfolio;
                const trackingMeta = formatTrackingMeta(strategy);
                return (
                  <article
                    key={strategy.ticker}
                    onClick={() => setSelectedTicker(strategy.ticker)}
                    className="cursor-pointer rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 transition-colors hover:bg-[var(--color-bg-muted)]/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-[var(--color-fg-default)]">{strategy.ticker}</span>
                          <VerdictBadge verdict={strategy.verdict} size="sm" />
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                          {timeAgo(strategy.updatedAt)}
                          {strategy.hasExpiredCatalysts ? " · expired catalyst" : ""}
                        </p>
                      </div>
                      <ActionsDropdown
                        label="Actions"
                        pendingAction={pendingAction}
                        onSelect={requestAction}
                        items={[
                          {
                            label: "Quick Check",
                            action: "quick_check",
                            ticker: strategy.ticker,
                            disabled: rowActionsDisabled,
                            helper: "Run a focused ticker check for the latest change set and recommendation drift.",
                          },
                          {
                            label: t("jobDeepDiveTitle", language),
                            action: "deep_dive",
                            ticker: strategy.ticker,
                            disabled: rowActionsDisabled,
                            helper: "Run the full single-position analysis workflow with refreshed strategy output.",
                          },
                        ]}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">Confidence</p>
                        <p className="mt-1 text-sm font-semibold text-[var(--color-fg-default)]">{tConfidence(strategy.confidence, language)}</p>
                      </div>
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">Timeframe</p>
                        <p className="mt-1 text-sm font-semibold text-[var(--color-fg-default)]">{tTimeframe(strategy.timeframe, language)}</p>
                      </div>
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">Position size</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{formatILS(strategy.positionSizeILS)}</p>
                      </div>
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">Weight</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{`${(strategy.positionWeightPct ?? 0).toFixed(1)}%`}</p>
                      </div>
                    </div>

                    {trackingMeta ? (
                      <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-[11px] leading-5 text-[var(--color-fg-muted)]">
                        {trackingMeta}
                      </div>
                    ) : null}

                    <p className="mt-3 text-sm leading-6 text-[var(--color-fg-muted)] line-clamp-3">{strategy.reasoning}</p>
                  </article>
                );
              })}
            </div>

            <div className="relative hidden overflow-visible rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] md:block">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-muted)]/70">
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      {t("colTicker", language)}
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      {t("colVerdict", language)}
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      {t("colConfidence", language)}
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      {t("colTimeframe", language)}
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      Position size
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      Weight
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      Thesis
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((strategy) => {
                    const rowActionsDisabled = !strategy.inPortfolio;
                    const trackingMeta = formatTrackingMeta(strategy);
                    return (
                      <tr
                        key={strategy.ticker}
                        onClick={() => setSelectedTicker(strategy.ticker)}
                        className="cursor-pointer border-b border-[var(--color-border-muted)] align-top transition-colors hover:bg-[var(--color-bg-muted)]/50 last:border-0"
                      >
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div>
                              <p className="font-mono text-sm font-semibold text-[var(--color-fg-default)]">{strategy.ticker}</p>
                              <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{timeAgo(strategy.updatedAt)}</p>
                            </div>
                            {strategy.hasExpiredCatalysts ? (
                              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                                Expired
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <VerdictBadge verdict={strategy.verdict} size="sm" />
                        </td>
                        <td className="px-4 py-4">
                          <ConfidenceBadge confidence={tConfidence(strategy.confidence, language)} />
                        </td>
                        <td className="px-4 py-4 text-sm font-medium text-[var(--color-fg-default)]">
                          {tTimeframe(strategy.timeframe, language)}
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-medium tabular-nums text-[var(--color-fg-default)]">
                          {formatILS(strategy.positionSizeILS)}
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-medium tabular-nums text-[var(--color-fg-default)]">
                          {(strategy.positionWeightPct ?? 0).toFixed(1)}%
                        </td>
                        <td className="px-4 py-4">
                          <p className="line-clamp-2 text-sm font-medium leading-6 text-[var(--color-fg-muted)]">
                            {scope === "tracking" ? trackingMeta ?? strategy.reasoning : strategy.reasoning}
                          </p>
                        </td>
                        <td className="px-4 py-4 overflow-visible">
                          <div className="flex justify-end overflow-visible">
                            <ActionsDropdown
                              label="Actions"
                              pendingAction={pendingAction}
                              onSelect={requestAction}
                              items={[
                                {
                                  label: "Quick Check",
                                  action: "quick_check",
                                  ticker: strategy.ticker,
                                  disabled: rowActionsDisabled,
                                  helper: "Run a focused ticker check for the latest change set and recommendation drift.",
                                },
                                {
                                  label: t("jobDeepDiveTitle", language),
                                  action: "deep_dive",
                                  ticker: strategy.ticker,
                                  disabled: rowActionsDisabled,
                                  helper: "Run the full single-position analysis workflow with refreshed strategy output.",
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <StrategyModal ticker={selectedTicker} onClose={() => setSelectedTicker(null)} />

      <ConfirmActionModal
        request={confirmRequest}
        submitting={Boolean(confirmRequest && pendingAction === `${confirmRequest.action}:${confirmRequest.ticker ?? "all"}`)}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => void executeAction()}
      />
    </>
  );
}
