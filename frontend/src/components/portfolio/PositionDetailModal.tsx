import { useState, useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Check, Circle, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createChart, ColorType, CandlestickSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, CandlestickData, LineData } from "lightweight-charts";
import { fetchPositionHistory, updatePosition, deletePosition } from "../../api/portfolio";
import { fetchStrategy } from "../../api/strategies";
import { triggerJob } from "../../api/jobs";
import { useToastStore } from "../../store/toastStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t, tConfidence } from "../../store/i18n";
import { formatILS, formatPct, timeAgo } from "../../utils/format";
import { scoreColor } from "../../utils/today/scoreColor";
import type { PositionRow, VerdictRow, Verdict, ClosedPositionRecord } from "../../types/api";
import { Spinner } from "../ui/Spinner";
import { ActionBadge } from "../design/ActionBadge";
import { ScoreBar } from "../design/HeroStatCard";
import { StatCell } from "../design/StatCell";
import { ThesisSection } from "./ThesisSection";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { ClosePositionModal } from "./ClosePositionModal";
import { usePositionGuidance } from "../../hooks/usePositionGuidance";
import { healthScore, DEFAULT_STOP_LOSS_PCT } from "../../utils/today/healthScore";
import { saveClosedPosition } from "../../utils/closedPositions";

interface PositionDetailModalProps {
  position: PositionRow | null;
  verdict?: VerdictRow;
  /** Health score 0..100 — drives the score hero color */
  score?: number;
  onClose: () => void;
  onDeletePosition?: (position: PositionRow) => Promise<void>;
}

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";

const VERDICT_LINE: Record<Verdict, string> = {
  BUY: "Add or initiate.",
  ADD: "Add to position.",
  HOLD: "Hold steady.",
  REDUCE: "Trim the position.",
  SELL: "Reduce or exit.",
  CLOSE: "Close out.",
};

const VERDICT_CTA: Partial<Record<Verdict, string>> = {
  BUY: "Add to Position",
  ADD: "Add to Position",
  // HOLD intentionally absent — no primary action CTA for hold positions
  REDUCE: "Reduce Position",
  SELL: "Exit Position",
  CLOSE: "Exit Position",
};

function ctaBg(verdict?: Verdict): string {
  switch (verdict) {
    case "BUY": case "ADD": return "var(--color-green-bg)";
    case "REDUCE": return "var(--color-amber-bg)";
    case "SELL": case "CLOSE": return "var(--color-red-bg)";
    default: return "var(--text-primary)";
  }
}
function ctaColor(verdict?: Verdict): string {
  switch (verdict) {
    case "BUY": case "ADD": return "var(--color-green)";
    case "REDUCE": return "var(--color-amber)";
    case "SELL": case "CLOSE": return "var(--color-red)";
    default: return "var(--bg-base)";
  }
}
function ctaBorderColor(verdict?: Verdict): string {
  switch (verdict) {
    case "BUY": case "ADD": return "var(--color-green-border)";
    case "REDUCE": return "var(--color-amber-border)";
    case "SELL": case "CLOSE": return "var(--color-red-border)";
    default: return "transparent";
  }
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function Divider() {
  return <div style={{ height: "0.5px", background: "var(--bg-border)", margin: "4px 0" }} />;
}

function SectionLabel({ label, meta }: { label: string; meta?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "14px 16px 8px",
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
        {label}
      </span>
      {meta && (
        <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
          {meta}
        </span>
      )}
    </div>
  );
}

function BullBearCard({ label, color, text }: { label: string; color: string; text: string | null | undefined }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        border: "0.5px solid var(--bg-border)",
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-bold)",
          color,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          lineHeight: 1.45,
          fontWeight: "var(--weight-regular)",
        }}
      >
        {text ?? "—"}
      </div>
    </div>
  );
}

function ConditionRow({ kind, text, label, verdict }: { kind: "entry" | "exit"; text: string; label: string; verdict?: Verdict }) {
  let Icon: typeof Circle | typeof Check | typeof AlertTriangle = Circle;
  let dotColor = "var(--text-ghost)";

  if (verdict) {
    if (kind === "entry") {
      if (verdict === "BUY" || verdict === "ADD") {
        Icon = Check;
        dotColor = "var(--color-green)";
      } else if (verdict === "REDUCE" || verdict === "SELL" || verdict === "CLOSE") {
        Icon = AlertTriangle;
        dotColor = "var(--color-amber)";
      }
    } else {
      if (verdict === "SELL" || verdict === "CLOSE") {
        Icon = AlertTriangle;
        dotColor = "var(--color-red)";
      } else if (verdict === "REDUCE") {
        Icon = AlertTriangle;
        dotColor = "var(--color-amber)";
      }
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 0",
        borderTop: "0.5px solid var(--bg-border)",
      }}
    >
      <Icon size={10} color={dotColor} style={{ marginTop: 4, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.4, fontWeight: "var(--weight-regular)" }}>
          {text}
        </div>
      </div>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-bold)",
          color: kind === "entry" ? "var(--color-green)" : "var(--color-amber)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function twoSentences(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  const joined = parts.slice(0, 2).join(" ");
  if (joined.length <= 280) return joined;
  return joined.slice(0, 280).replace(/\s+\S*$/, "") + "…";
}

export function PositionDetailModal({ position, verdict, score, onClose, onDeletePosition }: PositionDetailModalProps) {
  const language = usePreferencesStore((s) => s.language);
  const theme = usePreferencesStore((s) => s.theme);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartData, setChartData] = useState<CandlestickData[] | LineData[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editShares, setEditShares] = useState("");
  const [editAvgPrice, setEditAvgPrice] = useState("");
  const [accountEdits, setAccountEdits] = useState<Record<string, { shares: string; avgPriceILS: string }>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closePositionOpen, setClosePositionOpen] = useState(false);

  const { guidanceMap, updateGuidance } = usePositionGuidance();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);

  // Full strategy — for bull/bear, conditions, full reasoning
  const { data: strategy, isLoading: strategyLoading } = useQuery({
    queryKey: ["strategy", position?.ticker],
    queryFn: () => fetchStrategy(position!.ticker),
    enabled: !!position,
  });

  useEffect(() => {
    if (!position) return;
    setEditShares(String(position.shares));
    setEditAvgPrice(String(position.avgPriceILS));
    setAccountEdits(
      Object.fromEntries(
        (position.accountBreakdown ?? []).map((entry) => [
          entry.account,
          { shares: String(entry.shares), avgPriceILS: String(entry.avgPriceILS) },
        ])
      )
    );
    setEditMode(false);
  }, [position]);

  useEffect(() => {
    if (!position) return;
    setLoadingChart(true);
    fetchPositionHistory(position.ticker, timeframe)
      .then((data) => { setChartData(data); setLoadingChart(false); })
      .catch(() => { setChartData([]); setLoadingChart(false); });
  }, [position, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current || !position) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const bgMuted = cssVar("--color-bg-muted") || "#21262d";
    const border = cssVar("--color-border") || "#30363d";
    const fgMuted = cssVar("--color-fg-muted") || "#8b949e";
    const accentGreen = cssVar("--color-accent-green") || "#42C97A";
    const accentRed = cssVar("--color-accent-red") || "#E25050";
    const accentBlue = cssVar("--color-accent-blue") || "#42C97A";
    const fgSubtle = cssVar("--color-fg-subtle") || "#6e7681";

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: fgMuted,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: bgMuted },
        horzLines: { color: bgMuted },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true },
      crosshair: {
        mode: 0,
        vertLine: { color: fgSubtle, width: 1, style: 2 },
        horzLine: { color: fgSubtle, width: 1, style: 2 },
      },
      handleScale: false,
      handleScroll: false,
    });

    chartRef.current = chart;

    const hasOhlc = chartData.length > 0 && "open" in chartData[0];
    if (hasOhlc) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: accentGreen,
        downColor: accentRed,
        borderUpColor: accentGreen,
        borderDownColor: accentRed,
        wickUpColor: accentGreen,
        wickDownColor: accentRed,
      });
      series.setData(chartData as CandlestickData[]);
      seriesRef.current = series as unknown as ISeriesApi<"Candlestick">;
    } else {
      const series = chart.addSeries(LineSeries, { color: accentBlue, lineWidth: 2 });
      series.setData(chartData as LineData[]);
      seriesRef.current = series as unknown as ISeriesApi<"Line">;
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: 200 });
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [position, chartData, theme]);

  const handleSaveEdit = async () => {
    if (!position) return;
    setSaving(true);
    try {
      const hasMultiple = (position.accountBreakdown?.length ?? 0) > 1;
      if (hasMultiple) {
        await Promise.all(
          position.accountBreakdown.map((entry) =>
            updatePosition(position.ticker, {
              account: entry.account,
              shares: Number(accountEdits[entry.account]?.shares ?? entry.shares),
              avgPriceILS: Number(accountEdits[entry.account]?.avgPriceILS ?? entry.avgPriceILS),
            })
          )
        );
      } else {
        await updatePosition(position.ticker, {
          account: position.accounts?.[0],
          shares: Number(editShares),
          avgPriceILS: Number(editAvgPrice),
        });
      }
      showToast(t("saveChanges", language) + " ✓", "success");
      setEditMode(false);
    } catch {
      showToast(t("errorLoadPortfolio", language), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeepDive = async () => {
    if (!position) return;
    try {
      await triggerJob("deep_dive", position.ticker);
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      showToast(`${t("jobDeepDiveTitle", language)} — ${position.ticker} ${t("jobQueued", language)}`, "success");
      onClose();
    } catch (err) {
      const apiError = err as { response?: { data?: { reason?: string } } };
      showToast(apiError.response?.data?.reason ?? t("jobFailed", language), "error");
    }
  };

  if (!position) return null;

  const hasScore = score !== undefined && Number.isFinite(score);
  const scoreVal = score ?? 0;
  const verdictType = verdict?.verdict ?? strategy?.verdict;
  const verdictLine = verdictType ? VERDICT_LINE[verdictType] : null;
  const ctaLabel = verdictType ? (VERDICT_CTA[verdictType] ?? null) : null;

  const dayChangePct = position.dayChangePct ?? 0;
  const dayChangeILS = position.dayChangeILS ?? 0;
  const hasDayChange = dayChangePct !== 0 || dayChangeILS !== 0;
  const dayPositive = dayChangePct >= 0;

  const hasMultipleAccounts = (position.accountBreakdown?.length ?? 0) > 1;
  const canDelete = !!onDeletePosition && !hasMultipleAccounts && (position.accounts?.length ?? 0) === 1;

  // Compute score breakdown for ScoreBreakdown component — prefer live verdict, fall back to strategy
  const scoreBreakdown = verdict
    ? healthScore(verdict, position ?? undefined, DEFAULT_STOP_LOSS_PCT).breakdown
    : strategy
    ? healthScore(strategy as unknown as VerdictRow, position ?? undefined, DEFAULT_STOP_LOSS_PCT).breakdown
    : null;

  const handleClosePosition = async (record: Omit<ClosedPositionRecord, "ticker" | "closedAt">) => {
    if (!position) return;
    // 1. Save to local history before touching backend
    saveClosedPosition({
      ticker: position.ticker,
      closedAt: new Date().toISOString(),
      ...record,
    });
    setClosePositionOpen(false);
    // 2. Remove from portfolio backend (handle single + multi account)
    try {
      const breakdowns = position.accountBreakdown ?? [];
      if (breakdowns.length > 1) {
        await Promise.all(breakdowns.map((b) => deletePosition(position.ticker, b.account)));
      } else {
        await deletePosition(position.ticker, position.accounts?.[0]);
      }
    } catch {
      // Non-fatal — record is saved; user can remove manually
    }
    showToast(`${position.ticker} closed · saved to history`, "success");
    onClose();
  };

  const inputCls: React.CSSProperties = {
    width: "100%",
    background: "var(--bg-surface)",
    border: "0.5px solid var(--bg-border-mid)",
    borderRadius: "var(--radius-sm)",
    padding: "8px 10px",
    fontSize: "var(--text-sm)",
    color: "var(--text-primary)",
    outline: "none",
    fontVariantNumeric: "tabular-nums",
    fontWeight: "var(--weight-regular)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--bg-base)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "100vh",
          overflow: "hidden",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "0.5px solid var(--bg-border)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={language === "he" ? "חזור" : "Back"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {language === "he" ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "var(--text-md)",
                fontWeight: "var(--weight-bold)",
                color: "var(--text-primary)",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            >
              {position.ticker}
            </div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
              {position.exchange}
            </div>
          </div>

          {verdictType && <ActionBadge verdict={verdictType} score={score} />}

          <button
            type="button"
            onClick={() => setEditMode((m) => !m)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 10px",
              borderRadius: "var(--radius-sm)",
              background: editMode ? "var(--bg-surface-hover)" : "transparent",
              border: "0.5px solid var(--bg-border-mid)",
              color: editMode ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: "var(--text-2xs)",
              fontWeight: "var(--weight-bold)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {editMode ? t("cancel", language) : t("edit", language)}
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto" }}>

          {/* Score hero — primary visual: "how is this position doing?" */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              padding: "20px 16px 8px",
            }}
          >
            <div>
              <span
                style={{
                  display: "block",
                  fontSize: "var(--text-hero)",
                  fontWeight: "var(--weight-bold)",
                  lineHeight: 1,
                  letterSpacing: "-1.5px",
                  color: hasScore ? scoreColor(scoreVal) : "var(--text-tertiary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {hasScore ? scoreVal : "—"}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 9,
                  fontWeight: 400,
                  color: "var(--text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginTop: 4,
                }}
              >
                Position score
              </span>
            </div>

            <div style={{ textAlign: "end", maxWidth: "52%" }}>
              {verdictLine && (
                <div
                  style={{
                    fontSize: "var(--text-md)",
                    color: "var(--text-secondary)",
                    lineHeight: 1.4,
                    fontWeight: "var(--weight-regular)",
                  }}
                >
                  {verdictLine}
                </div>
              )}
              <div
                style={{
                  fontSize: 18,
                  fontWeight: "var(--weight-bold)",
                  color: "var(--text-primary)",
                  letterSpacing: "-0.5px",
                  fontVariantNumeric: "tabular-nums",
                  marginTop: verdictLine ? 4 : 0,
                  lineHeight: 1,
                }}
              >
                {formatILS(position.currentILS)}
              </div>
            </div>
          </div>

          {hasScore && (
            <div style={{ paddingBottom: scoreBreakdown ? 4 : 12 }}>
              <ScoreBar score={scoreVal} />
            </div>
          )}
          {hasScore && scoreBreakdown && (
            <ScoreBreakdown breakdown={scoreBreakdown} score={scoreVal} />
          )}

          <Divider />

          {/* 2×2 stats — financial snapshot */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              padding: "12px 16px",
            }}
          >
            <StatCell
              label={t("currentValue", language)}
              value={formatILS(position.currentILS)}
              sub={`${formatILS(position.livePriceILS)} / share`}
              positive={position.plPct > 0 ? true : position.plPct < 0 ? false : null}
            />
            <StatCell
              label={t("costBasis", language)}
              value={formatILS(position.costILS)}
              sub={`${formatILS(position.avgPriceILS)} avg`}
            />
            <StatCell
              label={t("shares", language)}
              value={position.shares.toLocaleString()}
              sub={position.accounts.length > 0 ? position.accounts.join(", ") : undefined}
            />
            <StatCell
              label={t("weight", language)}
              value={`${position.weightPct.toFixed(1)}%`}
              sub={verdict?.confidence ? tConfidence(verdict.confidence, language) : undefined}
            />
          </div>

          {/* Today + All-time P/L row */}
          <div style={{ padding: "0 16px 12px", display: "flex", flexWrap: "wrap", gap: 16 }}>
            {hasDayChange && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: "var(--text-2xs)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-tertiary)",
                    fontWeight: "var(--weight-regular)",
                  }}
                >
                  {language === "he" ? "היום" : "Today"}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--weight-bold)",
                    color: dayPositive ? "var(--color-green)" : "var(--color-red)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {dayPositive ? "+" : ""}{dayChangePct.toFixed(2)}%
                </span>
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-tertiary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {dayPositive ? "+" : ""}{formatILS(Math.abs(dayChangeILS))}
                </span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: "var(--text-2xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-tertiary)",
                  fontWeight: "var(--weight-regular)",
                }}
              >
                {language === "he" ? "הכל" : "All-time"}
              </span>
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  color: position.plPct >= 0 ? "var(--color-green)" : "var(--color-red)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatPct(position.plPct)}
              </span>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {position.plPct >= 0 ? "+" : ""}{formatILS(Math.abs(position.plILS))}
              </span>
            </div>
          </div>

          {/* ── Edit mode inline ── */}
          {editMode && (
            <>
              <Divider />
              <div style={{ padding: "12px 16px" }}>
                {!hasMultipleAccounts ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: "var(--weight-regular)" }}>
                        {t("shares", language)}
                      </div>
                      <input
                        type="number"
                        value={editShares}
                        onChange={(e) => setEditShares(e.target.value)}
                        style={inputCls}
                        min="1"
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: "var(--weight-regular)" }}>
                        {t("avgBuyPrice", language)}
                      </div>
                      <input
                        type="number"
                        value={editAvgPrice}
                        onChange={(e) => setEditAvgPrice(e.target.value)}
                        style={inputCls}
                        min="0.01"
                        step="0.01"
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {position.accountBreakdown.map((entry) => (
                      <div key={entry.account}>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 6, fontWeight: "var(--weight-bold)" }}>
                          {entry.account}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, fontWeight: "var(--weight-regular)" }}>{t("shares", language)}</div>
                            <input
                              type="number"
                              value={accountEdits[entry.account]?.shares ?? String(entry.shares)}
                              onChange={(e) => setAccountEdits((cur) => ({ ...cur, [entry.account]: { shares: e.target.value, avgPriceILS: cur[entry.account]?.avgPriceILS ?? String(entry.avgPriceILS) } }))}
                              style={inputCls}
                              min="0"
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, fontWeight: "var(--weight-regular)" }}>{t("avgBuyPrice", language)}</div>
                            <input
                              type="number"
                              value={accountEdits[entry.account]?.avgPriceILS ?? String(entry.avgPriceILS)}
                              onChange={(e) => setAccountEdits((cur) => ({ ...cur, [entry.account]: { shares: cur[entry.account]?.shares ?? String(entry.shares), avgPriceILS: e.target.value } }))}
                              style={inputCls}
                              min="0.01"
                              step="0.01"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={saving}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: "var(--radius-md)",
                      background: "var(--text-primary)",
                      color: "var(--bg-base)",
                      border: "none",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--weight-bold)",
                      cursor: saving ? "not-allowed" : "pointer",
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {saving ? t("saving", language) : t("saveChanges", language)}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!onDeletePosition || !position) return;
                        setDeleting(true);
                        try { await onDeletePosition(position); } finally { setDeleting(false); }
                      }}
                      disabled={deleting}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        background: "transparent",
                        color: "var(--color-red)",
                        border: "0.5px solid var(--color-red-border)",
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-bold)",
                        cursor: deleting ? "not-allowed" : "pointer",
                        opacity: deleting ? 0.5 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {deleting ? "Removing…" : (language === "he" ? "הסר" : "Remove")}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Your thesis ── */}
          <Divider />
          <ThesisSection
            ticker={position.ticker}
            guidance={guidanceMap[position.ticker]}
            onUpdate={updateGuidance}
          />

          {/* ── Strategy content ── */}
          {(strategyLoading && !strategy) && (
            <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
              <Spinner size="sm" />
            </div>
          )}

          {strategy && (
            <>
              <Divider />

              {/* Reasoning */}
              {strategy.reasoning && (
                <>
                  <SectionLabel
                    label={language === "he" ? "נימוק" : "Advisor reasoning"}
                    meta={`${language === "he" ? "עודכן" : "updated"} ${timeAgo(strategy.updatedAt)}`}
                  />
                  <p
                    style={{
                      padding: "0 16px 14px",
                      fontSize: "var(--text-md)",
                      lineHeight: 1.5,
                      color: "var(--text-secondary)",
                      fontWeight: "var(--weight-regular)",
                    }}
                  >
                    {twoSentences(strategy.reasoning)}
                  </p>
                </>
              )}

              {/* Bull / Bear 2-col */}
              {(strategy.bullCase || strategy.bearCase) && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    padding: "0 16px 16px",
                  }}
                >
                  <BullBearCard
                    label={language === "he" ? "בעד" : "Bull"}
                    color="var(--color-green)"
                    text={strategy.bullCase}
                  />
                  <BullBearCard
                    label={language === "he" ? "נגד" : "Bear"}
                    color="var(--color-red)"
                    text={strategy.bearCase}
                  />
                </div>
              )}

              {/* Conditions */}
              {(strategy.entryConditions.length + strategy.exitConditions.length) > 0 && (
                <>
                  <Divider />
                  <SectionLabel
                    label={language === "he" ? "תנאים" : "Conditions"}
                    meta={String(strategy.entryConditions.length + strategy.exitConditions.length)}
                  />
                  <div style={{ padding: "0 16px 16px" }}>
                    {strategy.entryConditions.map((c, i) => (
                      <ConditionRow key={`e-${i}`} kind="entry" text={c} label={language === "he" ? "כניסה" : "ENTRY"} verdict={verdictType} />
                    ))}
                    {strategy.exitConditions.map((c, i) => (
                      <ConditionRow key={`x-${i}`} kind="exit" text={c} label={language === "he" ? "יציאה" : "EXIT"} verdict={verdictType} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <Divider />

          {/* ── Price chart — supporting context, at the bottom ── */}
          <div style={{ padding: "16px 16px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
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
                {t("priceHistory", language)}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                {(["1D", "1W", "1M", "3M", "1Y"] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "var(--radius-sm)",
                      border: "0.5px solid var(--bg-border-mid)",
                      background: timeframe === tf ? "var(--bg-surface-hover)" : "transparent",
                      color: timeframe === tf ? "var(--text-primary)" : "var(--text-tertiary)",
                      fontSize: "var(--text-2xs)",
                      fontWeight: timeframe === tf ? "var(--weight-bold)" : "var(--weight-regular)",
                      cursor: "pointer",
                    }}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "0.5px solid var(--bg-border)",
                background: "var(--bg-surface)",
              }}
            >
              {loadingChart ? (
                <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Spinner size="md" />
                </div>
              ) : chartData.length === 0 ? (
                <div
                  style={{
                    height: 200,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {t("noChartData", language)}
                </div>
              ) : (
                <div ref={chartContainerRef} style={{ width: "100%", height: 200 }} />
              )}
            </div>
          </div>

          {/* Stale price warning */}
          {position.priceStale && (
            <div
              style={{
                margin: "12px 16px 0",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                background: "var(--color-amber-bg)",
                border: "0.5px solid var(--color-amber-border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <span style={{ color: "var(--color-amber)", fontSize: "var(--text-sm)" }}>⚠</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-amber)", fontWeight: "var(--weight-regular)" }}>
                {t("priceStale", language)}
              </span>
            </div>
          )}

          <div style={{ height: 24 }} />
        </div>

        {/* ── Footer CTA — verdict-aware: no primary for HOLD ── */}
        {!editMode && (
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
              borderTop: "0.5px solid var(--bg-border)",
              background: "var(--bg-base)",
              flexShrink: 0,
            }}
          >
            {ctaLabel && verdictType && (
              <button
                type="button"
                onClick={handleDeepDive}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "var(--radius-md)",
                  background: ctaBg(verdictType),
                  color: ctaColor(verdictType),
                  border: `0.5px solid ${ctaBorderColor(verdictType)}`,
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  cursor: "pointer",
                }}
              >
                {ctaLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => setClosePositionOpen(true)}
              style={{
                padding: "12px 14px",
                borderRadius: "var(--radius-md)",
                background: "transparent",
                color: "var(--color-red)",
                border: "0.5px solid var(--color-red-border)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-bold)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {language === "he" ? "סגור פוזיציה" : "Close position"}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: ctaLabel ? 0 : 1,
                padding: "12px 20px",
                borderRadius: "var(--radius-md)",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "0.5px solid var(--bg-border)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-regular)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {language === "he" ? "סגור" : "Dismiss"}
            </button>
          </div>
        )}
      </div>

      {/* ── Close position modal — z-index 60/70 (above this modal's 50) ── */}
      {closePositionOpen && (
        <ClosePositionModal
          position={position}
          onCancel={() => setClosePositionOpen(false)}
          onConfirm={handleClosePosition}
        />
      )}
    </div>
  );
}
