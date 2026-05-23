import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Layers3, Plus, RefreshCw } from "lucide-react";
import {
  fetchPortfolio,
  fetchVerdicts,
  addAccount,
  deleteAccount,
  deletePosition,
} from "../api/portfolio";
import { fetchOnboardStatus } from "../api/onboarding";
import { fetchJobs } from "../api/jobs";
import { triggerJob } from "../api/jobs";
import { PositionRow } from "../components/portfolio/PositionRow";
import { PositionDetailModal } from "../components/portfolio/PositionDetailModal";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { Card } from "../components/ui/Card";
import { formatILS, timeAgo, formatPct } from "../utils/format";
import { usePreferencesStore } from "../store/preferencesStore";
import { useToastStore } from "../store/toastStore";
import { t } from "../store/i18n";
import { AddPositionModal } from "../components/portfolio/AddPositionModal";
import { SetupBanner } from "../components/today/SetupBanner";
import { AttentionCard } from "../components/today/AttentionCard";
import { HeroStatCard } from "../components/design/HeroStatCard";
import { StatCell } from "../components/design/StatCell";
import { classifyAttention } from "../utils/today/classifyAttention";
import { healthScore, portfolioHealthScore, DEFAULT_STOP_LOSS_PCT } from "../utils/today/healthScore";
import type { VerdictRow, PositionRow as PositionRowType, AttentionItem } from "../types/api";

/** One-liner portfolio health summary for the HeroStatCard description slot. */
function buildPortfolioDescription(attentionCount: number, total: number): string {
  if (total === 0) return "";
  if (attentionCount === 0)
    return `All ${total} position${total === 1 ? "" : "s"} on track. Nothing needs your attention right now.`;
  if (attentionCount === 1)
    return "Mostly on track. One position flagged for review — everything else is sitting well.";
  return `${attentionCount} positions need attention. The rest of your portfolio is on track.`;
}

interface AccountSummary {
  name: string;
  positions: PositionRowType[];
  totalILS: number;
  totalCostILS: number;
  totalPlILS: number;
  totalPlPct: number;
}

interface AccountManagerModalProps {
  open: boolean;
  accounts: AccountSummary[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}

function AccountManagerModal({
  open,
  accounts,
  onClose,
  onCreate,
  onDelete,
}: AccountManagerModalProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center">
        <div className="w-full bg-[var(--color-bg-base)] rounded-t-2xl sm:rounded-2xl sm:max-w-lg sm:w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div>
              <h2 className="text-sm font-bold text-[var(--color-fg-default)]">Manage Accounts</h2>
              <p className="text-[11px] text-[var(--color-fg-subtle)]">Create empty accounts or remove empty ones.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)] text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            <Card className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-2">
                Add Account
              </p>
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Interactive Brokers"
                  className="flex-1 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                />
                <button
                  type="button"
                  disabled={!name.trim() || saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onCreate(name.trim());
                      setName("");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-sm font-bold disabled:opacity-50"
                >
                  {saving ? "Adding..." : "Add"}
                </button>
              </div>
            </Card>

            <div className="space-y-2">
              {accounts.map((account) => (
                <Card key={account.name} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[var(--color-fg-default)]">{account.name}</p>
                      <p className="text-[11px] text-[var(--color-fg-subtle)]">
                        {account.positions.length} positions · {formatILS(account.totalILS)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={account.positions.length > 0}
                      onClick={() => onDelete(account.name)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>
                  {account.positions.length > 0 && (
                    <p className="mt-2 text-[10px] text-[var(--color-fg-subtle)]">
                      Move or remove positions from this account before deleting it.
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function Portfolio() {
  const language = usePreferencesStore((s) => s.language);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const [selectedPosition, setSelectedPosition] = useState<PositionRowType | null>(null);
  const [addPositionOpen, setAddPositionOpen] = useState(false);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});

  const { data: portfolio, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: verdictsData } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    staleTime: 60_000,
  });

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });


  const verdictMap = useMemo(() => {
    const map: Record<string, VerdictRow> = {};
    verdictsData?.verdicts.forEach((verdict) => {
      map[verdict.ticker] = verdict;
    });
    return map;
  }, [verdictsData]);

  // ============================================================
  // Today screen — pilot v1 derivations
  // ============================================================
  const onboardState = onboardStatus?.state ?? "UNINITIALIZED";
  const telegramConnected = onboardStatus?.telegramConnected ?? false;
  const isBootstrapping = onboardState === "BOOTSTRAPPING" || onboardState === "UNINITIALIZED";

  const verdicts = useMemo(() => verdictsData?.verdicts ?? [], [verdictsData]);

  const attentionItems: AttentionItem[] = useMemo(
    () => classifyAttention(verdicts),
    [verdicts]
  );

  const attentionTickerSet = useMemo(
    () => new Set(attentionItems.map((i) => i.ticker)),
    [attentionItems]
  );

  // Per-ticker score map (pure compute over current verdicts + portfolio)
  const tickerScores = useMemo(() => {
    const map = new Map<string, number>();
    if (!portfolio) return map;
    const positionByTicker = new Map(portfolio.positions.map((p) => [p.ticker, p]));
    for (const v of verdicts) {
      const pos = positionByTicker.get(v.ticker);
      const { score } = healthScore(v, pos, DEFAULT_STOP_LOSS_PCT);
      map.set(v.ticker, score);
    }
    return map;
  }, [verdicts, portfolio]);

  // Clear positions = portfolio positions excluding tickers in the attention block.
  // Sorted worst-score first (so user sees what to watch within the calm list),
  // then by weight descending. Each row carries _score for rendering.
  const clearPositions = useMemo(() => {
    if (!portfolio) return [];
    return portfolio.positions
      .filter((p) => !attentionTickerSet.has(p.ticker))
      .map((p) => ({
        ...p,
        _score: tickerScores.get(p.ticker),
      }))
      .sort((a, b) => {
        const sa = a._score ?? 100;
        const sb = b._score ?? 100;
        if (sa !== sb) return sa - sb;
        return b.weightPct - a.weightPct;
      });
  }, [portfolio, attentionTickerSet, tickerScores]);

  // Portfolio health score — uses ALL positions with computed scores (not just clearPositions),
  // so the hero card shows a score even when every scored position is in the attention section.
  const portfolioHealth = useMemo(() => {
    if (!portfolio) return null;
    const inputs = portfolio.positions
      .map((p) => ({ score: tickerScores.get(p.ticker), weightPct: p.weightPct }))
      .filter((p): p is { score: number; weightPct: number } => Number.isFinite(p.score));
    return portfolioHealthScore(inputs);
  }, [portfolio, tickerScores]);

  // Bootstrap progress numbers (from /api/jobs)
  const bootstrapProgress = useMemo(() => {
    const ddJobs = (jobsData?.jobs ?? []).filter((j) => j.action === "deep_dive");
    const completed = ddJobs.filter((j) => j.status === "completed").length;
    const total = portfolio?.positions.length ?? 0;
    const inProgress = ddJobs
      .filter((j) => j.status === "running" || j.status === "pending")
      .map((j) => j.ticker)
      .filter((tk): tk is string => !!tk);
    return { analyzed: Math.min(completed, total), total, inProgress };
  }, [jobsData, portfolio]);

  // Attention drill-down state (separate from PositionDetailModal which uses selectedPosition)
  const [strategyTicker, setStrategyTicker] = useState<string | null>(null);
  const strategyAttentionItem = useMemo(
    () => attentionItems.find((i) => i.ticker === strategyTicker) ?? null,
    [attentionItems, strategyTicker]
  );

  const activeJobs = useMemo(() => {
    if (!jobsData?.jobs) return [];
    return jobsData.jobs.filter((job) => job.status === "pending" || job.status === "paused" || job.status === "running");
  }, [jobsData]);

  const activeTickerChecks = useMemo(() => {
    const set = new Set<string>();
    for (const job of activeJobs) {
      if (job.ticker && (job.action === "deep_dive" || job.action === "quick_check")) {
        set.add(job.ticker);
      }
    }
    return set;
  }, [activeJobs]);

  // Map ticker to active job type
  const tickerJobType = useMemo(() => {
    const map = new Map<string, 'quick_check' | 'deep_dive'>();
    for (const job of activeJobs) {
      if (job.ticker && (job.action === "quick_check" || job.action === "deep_dive")) {
        map.set(job.ticker, job.action as 'quick_check' | 'deep_dive');
      }
    }
    return map;
  }, [activeJobs]);



  const positionWeightMap = useMemo(() => {
    const map = new Map<string, number>();
    portfolio?.positions.forEach((p) => map.set(p.ticker, p.weightPct));
    return map;
  }, [portfolio]);

  const accountSummaries = useMemo<AccountSummary[]>(() => {
    if (!portfolio) return [];

    const livePriceByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.livePriceILS])
    );
    const staleByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.priceStale])
    );
    const exchangeByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.exchange])
    );
    const dayChangePctByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.dayChangePct ?? 0])
    );
    const dayChangeILSByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.dayChangeILS ?? 0])
    );

    const accountMap = new Map<string, AccountSummary>();
    for (const position of portfolio.positions) {
      for (const breakdown of position.accountBreakdown) {
        const livePriceILS = livePriceByTicker.get(position.ticker) ?? 0;
        const currentILS = Math.round(livePriceILS * breakdown.shares * 100) / 100;
        const costILS = Math.round(breakdown.avgPriceILS * breakdown.shares * 100) / 100;
        const plILS = Math.round((currentILS - costILS) * 100) / 100;
        const plPct = costILS > 0 ? Math.round((plILS / costILS) * 10000) / 100 : 0;

        const summary = accountMap.get(breakdown.account) ?? {
          name: breakdown.account,
          positions: [],
          totalILS: 0,
          totalCostILS: 0,
          totalPlILS: 0,
          totalPlPct: 0,
        };

        summary.positions.push({
          ticker: position.ticker,
          exchange: exchangeByTicker.get(position.ticker) ?? position.exchange,
          shares: breakdown.shares,
          accounts: [breakdown.account],
          accountBreakdown: [breakdown],
          avgPriceILS: breakdown.avgPriceILS,
          livePriceILS,
          currentILS,
          costILS,
          plILS,
          plPct,
          dayChangeILS: Math.round((dayChangeILSByTicker.get(position.ticker) ?? 0) * breakdown.shares * 100) / 100,
          dayChangePct: dayChangePctByTicker.get(position.ticker) ?? 0,
          weightPct: 0,
          priceStale: staleByTicker.get(position.ticker) ?? position.priceStale,
        });
        summary.totalILS += currentILS;
        summary.totalCostILS += costILS;
        accountMap.set(breakdown.account, summary);
      }
    }

    const summaries = Array.from(accountMap.values()).map((summary) => {
      summary.totalILS = Math.round(summary.totalILS * 100) / 100;
      summary.totalCostILS = Math.round(summary.totalCostILS * 100) / 100;
      summary.totalPlILS = Math.round((summary.totalILS - summary.totalCostILS) * 100) / 100;
      summary.totalPlPct = summary.totalCostILS > 0
        ? Math.round((summary.totalPlILS / summary.totalCostILS) * 10000) / 100
        : 0;

      summary.positions = summary.positions
        .map((position) => ({
          ...position,
          weightPct: summary.totalILS > 0
            ? Math.round((position.currentILS / summary.totalILS) * 10000) / 100
            : 0,
        }))
        .sort((a, b) => b.currentILS - a.currentILS);
      return summary;
    });

    for (const accountName of portfolio.accounts) {
      if (!accountMap.has(accountName)) {
        summaries.push({
          name: accountName,
          positions: [],
          totalILS: 0,
          totalCostILS: 0,
          totalPlILS: 0,
          totalPlPct: 0,
        });
      }
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }, [portfolio]);

  const handlePositionClick = (position: PositionRowType) => {
    setSelectedPosition(position);
  };

  const toggleAccount = (name: string) => {
    setExpandedAccounts((current) => ({
      ...current,
      [name]: !current[name],
    }));
  };

  const refreshPortfolio = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["verdicts"] }),
    ]);
  };

  const handleCreateAccount = async (name: string) => {
    try {
      await addAccount(name);
      showToast("Account added", "success");
      await refreshPortfolio();
    } catch (error) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const reason = apiError.response?.data?.error;
      showToast(
        reason === "account_exists"
          ? "Account already exists"
          : reason === "invalid_account_name"
          ? "Use a short account name with letters, numbers, spaces, _ or -"
          : "Failed to add account",
        "error"
      );
    }
  };

  const handleDeleteAccount = async (name: string) => {
    try {
      await deleteAccount(name);
      showToast("Account removed", "success");
      await refreshPortfolio();
    } catch (error) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const reason = apiError.response?.data?.error;
      showToast(
        reason === "account_not_empty"
          ? "Account still has positions"
          : "Failed to remove account",
        "error"
      );
    }
  };

  const handleDeleteSelectedPosition = async (position: PositionRowType) => {
    const account = position.accounts[0];
    if (!account) return;
    try {
      await deletePosition(position.ticker, account);
      showToast("Position removed", "success");
      setSelectedPosition(null);
      await refreshPortfolio();
    } catch {
      showToast("Failed to remove position", "error");
    }
  };

  const handleQuickCheck = async (ticker: string) => {
    try {
      await triggerJob("quick_check", ticker);
      showToast(`Quick check queued for ${ticker}`, "success");
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      await refreshPortfolio();
    } catch (error) {
      const apiError = error as { response?: { data?: { error?: string; reason?: string } } };
      const reason = apiError.response?.data?.reason;
      showToast(reason ?? `Failed to queue quick check for ${ticker}`, "error");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={t("errorLoadPortfolio", language)} onRetry={refetch} />;
  }

  if (!portfolio) {
    return <EmptyState message={t("emptyPortfolio", language)} icon="📭" />;
  }

  return (
    <>
      {/* ── Inline greeting / portfolio headline (replaces TopBar on Portfolio) ── */}
      {!isBootstrapping && (
        <div style={{ padding: "20px 16px 4px" }}>
          {/* Top row: greeting + points + refresh */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                fontWeight: "var(--weight-regular)",
              }}
            >
              {onboardStatus?.displayName ? `Hey ${onboardStatus.displayName} —` : "Hey —"}
            </p>
            <button
                type="button"
                onClick={() => refetch()}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                  padding: 4,
                  display: "inline-flex",
                }}
              >
                <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
              </button>
          </div>

          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: "var(--weight-bold)",
              color: "var(--text-primary)",
              lineHeight: 1.25,
              margin: 0,
            }}
          >
            {attentionItems.length === 0 ? (
              <>
                Portfolio's doing well.{" "}
                <span style={{ color: "var(--color-green)" }}>All clear.</span>
              </>
            ) : (
              <>
                Portfolio's doing well,{" "}
                <span style={{ color: "var(--color-amber)" }}>
                  {attentionItems.length === 1
                    ? "one thing to look at."
                    : `${attentionItems.length} things to look at.`}
                </span>
              </>
            )}
          </h2>
        </div>
      )}

      {isBootstrapping && (
        <div style={{ marginTop: 12, marginBottom: 4 }}>
          <SetupBanner
            analyzed={bootstrapProgress.analyzed}
            total={bootstrapProgress.total}
            inProgressTickers={bootstrapProgress.inProgress}
            telegramConnected={telegramConnected}
          />
        </div>
      )}

      {/* "NEEDS ATTENTION" section + cards — only when attention items exist */}
      {!isBootstrapping && attentionItems.length > 0 && (
        <>
          <div
            style={{
              marginTop: 20,
              padding: "0 16px 8px",
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 400,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--text-tertiary)",
              }}
            >
              Needs attention
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {attentionItems.map((item) => (
              <AttentionCard
                key={item.ticker}
                item={item}
                score={tickerScores.get(item.ticker)}
                weightPct={positionWeightMap.get(item.ticker)}
                updatedAt={verdictMap[item.ticker]?.updatedAt ?? null}
                onClick={(ticker) => setStrategyTicker(ticker)}
              />
            ))}
          </div>
        </>
      )}

      {/* Hero — total value + all-time P/L; bg tint = portfolio score */}
      {!isBootstrapping && (
        <div style={{ marginTop: 12 }}>
          <HeroStatCard
            value={formatILS(portfolio.totalILS ?? 0)}
            pnlLine={`${formatPct(portfolio.totalPlPct ?? 0)} all-time`}
            pnlPositive={(portfolio.totalPlPct ?? 0) >= 0 ? (portfolio.totalPlPct ?? 0) > 0 : false}
            portfolioScore={portfolioHealth?.score ?? null}
            description={buildPortfolioDescription(attentionItems.length, portfolio.positions.length)}
          />
        </div>
      )}

      {/* 2-col stats — today's change | USD/ILS */}
      {!isBootstrapping && (
        <div
          style={{
            marginTop: 8,
            padding: "0 16px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <StatCell
            label="Today"
            value={
              (portfolio.totalDayChangePct ?? 0) === 0
                ? "—"
                : `${(portfolio.totalDayChangePct ?? 0) >= 0 ? "+" : ""}${(portfolio.totalDayChangePct ?? 0).toFixed(2)}%`
            }
            sub={
              (portfolio.totalDayChangeILS ?? 0) === 0
                ? undefined
                : `${(portfolio.totalDayChangeILS ?? 0) >= 0 ? "+" : ""}${formatILS(Math.abs(portfolio.totalDayChangeILS ?? 0))}`
            }
            positive={
              (portfolio.totalDayChangePct ?? 0) === 0
                ? null
                : (portfolio.totalDayChangePct ?? 0) > 0
            }
          />
          <StatCell
            label="USD / ILS"
            value={(portfolio.usdIlsRate ?? 0).toFixed(2)}
            sub={portfolio.updatedAt ? `updated ${timeAgo(portfolio.updatedAt)}` : undefined}
          />
        </div>
      )}

      {/* Active jobs strip — minor pill, not a banner */}
      {!isBootstrapping && activeJobs.length > 0 && (
        <div style={{ marginTop: 8, padding: "0 16px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: "var(--radius-pill)",
              background: "var(--bg-surface)",
              border: "0.5px solid var(--bg-border)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-green)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            {activeJobs.length} {t("jobsRunning", language)}
          </div>
        </div>
      )}

      {/* Section label: Holdings · N clear */}
      <div
        style={{
          marginTop: 20,
          padding: "0 16px",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-2xs)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-tertiary)",
            fontWeight: "var(--weight-regular)",
          }}
        >
          Holdings
        </span>
        {!isBootstrapping && clearPositions.length > 0 && (
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
            {clearPositions.length} clear
          </span>
        )}
      </div>

      {/* Holding rows — single layout, top borders create the row separators */}
      {clearPositions.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {clearPositions.map((position) => (
            <PositionRow
              key={`unified:${position.ticker}`}
              position={position}
              verdict={verdictMap[position.ticker]}
              score={position._score}
              isChecking={activeTickerChecks.has(position.ticker)}
              jobType={tickerJobType.get(position.ticker)}
              onQuickCheck={() => handleQuickCheck(position.ticker)}
              onClick={() => handlePositionClick(position)}
            />
          ))}
        </div>
      )}

      {/* Add Position button — dashed ghost */}
      <div style={{ padding: "12px 16px 8px" }}>
        <button
          type="button"
          onClick={() => setAddPositionOpen(true)}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "12px",
            border: "0.5px dashed var(--bg-border-mid)",
            borderRadius: "var(--radius-md)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            cursor: "pointer",
          }}
        >
          <Plus size={14} />
          {t("addPosition", language)}
        </button>
      </div>

      {/* Power-user expander — Group by account, default-collapsed */}
      {accountSummaries.length > 0 && (
        <details
          style={{
            margin: "16px 16px 8px",
            borderTop: "0.5px solid var(--bg-border)",
            paddingTop: 12,
          }}
        >
          <summary
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              listStyle: "none",
              cursor: "pointer",
              fontSize: "var(--text-2xs)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-tertiary)",
              fontWeight: "var(--weight-regular)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Layers3 size={12} /> Group by account ({accountSummaries.length})
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setAccountManagerOpen(true);
              }}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "var(--text-2xs)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Manage
            </button>
          </summary>

          <div style={{ marginTop: 8 }}>
            {accountSummaries.map((account) => {
              const expanded = expandedAccounts[account.name] ?? false;
              return (
                <div
                  key={account.name}
                  style={{
                    borderTop: "0.5px solid var(--bg-border)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleAccount(account.name)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "var(--text-md)",
                          fontWeight: "var(--weight-bold)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {account.name}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                          marginTop: 2,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {account.positions.length} positions · {formatILS(account.totalILS)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ textAlign: "end" }}>
                        <div
                          style={{
                            fontSize: "var(--text-sm)",
                            fontWeight: "var(--weight-bold)",
                            color:
                              account.totalPlPct >= 0
                                ? "var(--color-green)"
                                : "var(--color-red)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {account.totalPlPct >= 0 ? "+" : ""}
                          {account.totalPlPct.toFixed(2)}%
                        </div>
                      </div>
                      {expanded ? (
                        <ChevronUp size={16} color="var(--text-tertiary)" />
                      ) : (
                        <ChevronDown size={16} color="var(--text-tertiary)" />
                      )}
                    </div>
                  </button>

                  {expanded &&
                    (account.positions.length === 0 ? (
                      <div
                        style={{
                          padding: "12px 0",
                          fontSize: "var(--text-sm)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {t("emptyAccount", language)}
                      </div>
                    ) : (
                      <div style={{ marginBottom: 8 }}>
                        {account.positions.map((position) => (
                          <PositionRow
                            key={`${account.name}:${position.ticker}`}
                            position={position}
                            verdict={verdictMap[position.ticker]}
                            score={tickerScores.get(position.ticker)}
                            isChecking={activeTickerChecks.has(position.ticker)}
                            jobType={tickerJobType.get(position.ticker)}
                            onQuickCheck={() => handleQuickCheck(position.ticker)}
                            onClick={() => handlePositionClick(position)}
                          />
                        ))}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </details>
      )}

      <PositionDetailModal
        position={selectedPosition}
        verdict={selectedPosition ? verdictMap[selectedPosition.ticker] : undefined}
        score={selectedPosition ? tickerScores.get(selectedPosition.ticker) : undefined}
        onClose={() => {
          setSelectedPosition(null);
          refetch();
        }}
        onDeletePosition={handleDeleteSelectedPosition}
      />

      <AddPositionModal
        open={addPositionOpen}
        onClose={() => {
          setAddPositionOpen(false);
        }}
        onEditExisting={(ticker) => {
          const position = portfolio?.positions.find((item) => item.ticker === ticker) ?? null;
          setAddPositionOpen(false);
          setSelectedPosition(position);
        }}
      />

      <AccountManagerModal
        open={accountManagerOpen}
        accounts={accountSummaries}
        onClose={() => setAccountManagerOpen(false)}
        onCreate={handleCreateAccount}
        onDelete={handleDeleteAccount}
      />

      {/* Attention drill-down — design pivot v2 detail sheet.
          Receives the AttentionItem (drives "Why this fired"), the score (drives
          ScoreHero color), and the position (drives Today/Shares stat cells). */}
      <StrategyModal
        ticker={strategyTicker}
        attentionItem={strategyAttentionItem}
        attentionRank={
          strategyTicker
            ? attentionItems.findIndex((i) => i.ticker === strategyTicker) + 1
            : undefined
        }
        score={strategyTicker ? tickerScores.get(strategyTicker) : undefined}
        position={strategyTicker ? portfolio?.positions.find((p) => p.ticker === strategyTicker) ?? null : null}
        onClose={() => setStrategyTicker(null)}
        onDeepDive={() => setStrategyTicker(null)}
      />
    </>
  );
}
