import type { ReactElement, ReactNode } from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  ExternalLink,
  FileSearch,
  Layers3,
  Radar,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { cancelJob, fetchJobs, resumeJob } from "../api/jobs";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import type { FeedPageResponse, FeedItem, FeedItemEntry, Job } from "../types/api";
import { usePreferencesStore } from "../store/preferencesStore";
import { t, tConfidence } from "../store/i18n";
import { useToastStore } from "../store/toastStore";
import { formatILS } from "../utils/format";
import {
  confidenceExplanation,
  formatCatalyst,
  reasoningSnippet,
  scoreBucketEmoji,
  scoreBucketLabel,
  scoreExplanation,
  verdictSentence,
} from "../utils/advisory";
import type { Verdict } from "../types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type DetailReportType =
  | "fundamentals"
  | "technical"
  | "sentiment"
  | "macro"
  | "risk"
  | "bull_case"
  | "bear_case"
  | "strategy"
  | "quick_check";

interface DetailReportResponse {
  batchId: string;
  ticker: string;
  reportType: DetailReportType;
  content: Record<string, unknown>;
}

type ReportFilter = "all" | "deep_dive" | "daily_brief" | "quick_check" | "full_report" | "new_ideas";

type Rec = Record<string, unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const FILTERS: Array<{ id: ReportFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "daily_brief", label: "Daily brief" },
  { id: "deep_dive", label: "Deep dive" },
  { id: "full_report", label: "Full report" },
  { id: "quick_check", label: "Quick check" },
  { id: "new_ideas", label: "New ideas" },
];

const MODE_META: Record<string, { label: string; icon: ReactElement }> = {
  quick_check: {
    label: "Quick check",
    icon: <Radar size={12} />,
  },
  daily_brief: {
    label: "Daily brief",
    icon: <Clock3 size={12} />,
  },
  deep_dive: {
    label: "Deep dive",
    icon: <BrainCircuit size={12} />,
  },
  full_report: {
    label: "Full report",
    icon: <FileSearch size={12} />,
  },
  new_ideas: {
    label: "New ideas",
    icon: <Sparkles size={12} />,
  },
};

const VERDICT_COLORS: Record<string, string> = {
  SELL: "bg-red-500/20 text-red-300 border-red-500/30",
  CLOSE: "bg-red-500/20 text-red-300 border-red-500/30",
  REDUCE: "bg-yellow-500/15 text-yellow-300 border-yellow-500/25",
  BUY: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  ADD: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  HOLD: "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)] border-[var(--color-border)]",
};

const VERDICT_SYMBOLS: Record<string, string> = {
  BUY: "↑",
  ADD: "+",
  HOLD: "•",
  REDUCE: "↓",
  SELL: "×",
  CLOSE: "×",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-yellow-400",
  low: "text-[var(--color-fg-subtle)]",
};

const TAB_LABELS: Record<DetailReportType, string> = {
  strategy: "Overview",
  fundamentals: "Fundamentals",
  technical: "Technical",
  sentiment: "Sentiment",
  macro: "Macro",
  risk: "Risk",
  quick_check: "Quick check",
  bull_case: "Bull vs Bear",
  bear_case: "",
};

const ESCALATED = new Set(["SELL", "CLOSE", "REDUCE"]);
const POSITIVE = new Set(["BUY", "ADD"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && ["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"].includes(value);
}

function modeMeta(mode: string) {
  return MODE_META[mode] ?? MODE_META.deep_dive;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const itemStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (itemStart.getTime() === todayStart.getTime()) return `Today ${timeStr}`;
  if (itemStart.getTime() === yesterdayStart.getTime()) return `Yesterday ${timeStr}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${timeStr}`;
}

function progressPct(job: Job): number {
  if (job.status === "completed" || job.status === "partial_completed" || job.status === "failed") return 100;
  return job.progress?.pct ?? (job.status === "running" ? 5 : 0);
}

function reportTypesForItem(item: FeedItem): DetailReportType[] {
  if (item.mode === "quick_check" || item.mode === "daily_brief" || item.mode === "full_report") {
    return ["quick_check", "strategy"];
  }
  const primary: DetailReportType[] = ["strategy", "fundamentals", "technical", "sentiment", "macro", "risk"];
  const hasBull = Object.values(item.entries).some((e) => e.hasBullCase);
  const hasBear = Object.values(item.entries).some((e) => e.hasBearCase);
  if (hasBull || hasBear) primary.push("bull_case");
  if (hasBear) primary.push("bear_case");
  return primary;
}

function groupEntries(entries: FeedItemEntry[]) {
  return {
    escalated: entries.filter((e) => ESCALATED.has(e.verdict)),
    positive: entries.filter((e) => POSITIVE.has(e.verdict)),
    onTrack: entries.filter((e) => !ESCALATED.has(e.verdict) && !POSITIVE.has(e.verdict)),
  };
}

function sortEntriesForReview(entries: FeedItemEntry[]): FeedItemEntry[] {
  return [...entries].sort((a, b) => {
    const weight = (entry: FeedItemEntry) => {
      if (ESCALATED.has(entry.verdict)) return 0;
      if (entry.deepDiveQueued) return 1;
      if (POSITIVE.has(entry.verdict)) return 2;
      return 3;
    };
    const diff = weight(a) - weight(b);
    if (diff !== 0) return diff;
    return a.ticker.localeCompare(b.ticker);
  });
}

async function fetchDetailReports(
  batchId: string,
  ticker: string,
  reportTypes: DetailReportType[]
): Promise<Record<string, DetailReportResponse>> {
  const results = await Promise.all(
    reportTypes.map(async (rt) => {
      try {
        const r = await apiClient.get<DetailReportResponse>(`/reports/batch/${batchId}/${ticker}/${rt}`);
        return [rt, r.data] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(results.filter((x): x is readonly [DetailReportType, DetailReportResponse] => x !== null));
}

function getReportContent(reports: Record<string, DetailReportResponse> | null | undefined, key: string): Rec | null {
  if (!reports) return null;
  const r = reports[key];
  return r ? (r.content as Rec) : null;
}

// ─── Small atoms ──────────────────────────────────────────────────────────────

function VerdictPill({
  ticker,
  verdict,
  confidence,
  active,
  onClick,
}: {
  ticker: string;
  verdict: string;
  confidence?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const color = VERDICT_COLORS[verdict] ?? VERDICT_COLORS.HOLD;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all active:scale-95 ${color} ${
        active ? "ring-1 ring-white/30 ring-offset-0" : ""
      }`}
    >
      <span className="font-bold">{ticker}</span>
      <span className="mx-1 opacity-40">·</span>
      <span>{verdict}</span>
      {confidence ? (
        <span className="ml-1 opacity-50">{confidence[0]?.toUpperCase()}</span>
      ) : null}
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-[var(--color-fg-default)]">{value}</p>
      {sub ? <p className="text-[11px] text-[var(--color-fg-muted)]">{sub}</p> : null}
    </div>
  );
}

function BodyText({ text }: { text: string }) {
  return <p className="text-sm leading-6 text-[var(--color-fg-muted)]">{text}</p>;
}

function SourceLinks({ sources }: { sources: unknown }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {(sources as unknown[]).slice(0, 4).map((s, i) => {
        if (typeof s !== "string") return null;
        let label: string;
        try {
          label = new URL(s).hostname.replace(/^www\./, "");
        } catch {
          label = `Source ${i + 1}`;
        }
        return (
          <a
            key={s}
            href={s}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1 text-[10px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg-default)]"
          >
            {label}
            <ExternalLink size={9} />
          </a>
        );
      })}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2">
      <p className="text-xs text-[var(--color-fg-subtle)]">{label}</p>
      <p className="mt-1 text-sm font-medium text-[var(--color-fg-default)]">{value}</p>
    </div>
  );
}

function SignalBadge({
  icon,
  label,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  tone?: "default" | "warning" | "info";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
      : tone === "info"
        ? "border-sky-500/20 bg-sky-500/10 text-sky-300"
        : "border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {icon}
      {label}
    </span>
  );
}

function InsightSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-[var(--color-bg-base)] px-1 py-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[var(--color-fg-subtle)]">{title}</p>
          {subtitle ? <p className="mt-1 text-sm leading-6 text-[var(--color-fg-muted)]">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function FeedTickerCard({
  ticker,
  tone = "default",
  headline,
  detail,
  meta = [],
  trailing,
}: {
  ticker: string;
  tone?: "default" | "warning" | "info";
  headline?: ReactNode;
  detail: ReactNode;
  meta?: string[];
  trailing?: ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "bg-amber-500/10"
      : tone === "info"
        ? "bg-sky-500/10"
        : "bg-[var(--color-bg-muted)]";

  return (
    <div className={`rounded-lg px-3 py-3 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-fg-default)]">{ticker}</p>
          {headline ? <div className="mt-1 text-xs leading-5 text-[var(--color-fg-default)]">{headline}</div> : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      <div className="mt-2 text-xs leading-5 text-[var(--color-fg-muted)]">{detail}</div>
      {meta.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--color-fg-subtle)]">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Active job card ──────────────────────────────────────────────────────────

function ActiveJobCard({
  job,
  onCancel,
  onResume,
  busy,
}: {
  job: Job;
  onCancel: (job: Job) => void;
  onResume: (job: Job) => void;
  busy: boolean;
}) {
  const meta = modeMeta(job.action);
  const pct = progressPct(job);
  const prog = job.progress;
  const hasChain = prog && prog.totalTickers > 1;
  const statusLabel = job.status === "pending" ? "queued" : job.status === "paused" ? "paused" : "running";

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--color-fg-subtle)]">{meta.icon}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
              {meta.label}
            </span>
            <span className="rounded-full bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--color-fg-subtle)]">
              {statusLabel}
            </span>
          </div>

          <p className="mt-2 text-sm font-bold text-[var(--color-fg-default)]">
            {prog?.currentTicker
              ? `Analyzing ${prog.currentTicker}`
              : job.ticker
                ? `${job.ticker}`
                : meta.label}
            {prog?.currentStep ? (
              <span className="ml-2 text-xs font-normal text-[var(--color-fg-muted)]">
                · {prog.currentStep}
              </span>
            ) : null}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <SummaryChip label="Status" value={statusLabel} />
            <SummaryChip
              label="Scope"
              value={hasChain ? `${prog?.totalTickers ?? 0} tickers` : job.ticker ?? meta.label}
            />
            <SummaryChip
              label="Updated"
              value={formatDate(job.started_at ?? job.triggered_at)}
            />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">Progress</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-[var(--color-fg-default)]">{pct}%</p>
        </div>
      </div>

      {hasChain ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {prog.completedTickers.map((tick) => (
            <span
              key={tick}
              className="rounded-full border border-emerald-500/20 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
            >
              ✓ {tick}
            </span>
          ))}
          {prog.currentTicker ? (
            <span className="animate-pulse rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
              ▶ {prog.currentTicker}
            </span>
          ) : null}
          {prog.remainingTickers.slice(0, 6).map((tick) => (
            <span
              key={tick}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-0.5 text-[10px] text-[var(--color-fg-subtle)]"
            >
              {tick}
            </span>
          ))}
          {prog.remainingTickers.length > 6 ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-0.5 text-[10px] text-[var(--color-fg-subtle)]">
              +{prog.remainingTickers.length - 6} more
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent-blue)] transition-all duration-700"
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>

      <p className="mt-2 text-[10px] text-[var(--color-fg-subtle)]">
        {job.status === "paused" ? "Paused" : "Started"} {formatDate(job.started_at ?? job.triggered_at)}
      </p>

      {(job.status === "pending" || job.status === "paused") && job.action === "deep_dive" ? (
        <div className="mt-3 flex gap-2">
          {job.status === "paused" ? (
            <button
              type="button"
              onClick={() => onResume(job)}
              disabled={busy}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-primary-fg)] disabled:opacity-50"
            >
              Resume
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onCancel(job)}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-fg-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Analyst section renderers ────────────────────────────────────────────────

function FundamentalsSection({ content: c }: { content: Rec }) {
  const earnings = c.earnings as Rec | undefined;
  const valuation = c.valuation as Rec | undefined;
  const consensus = c.analystConsensus as Rec | undefined;

  const result = earnings?.result as string | undefined;
  const resultColor =
    result === "beat" ? "text-emerald-400" : result === "miss" ? "text-red-400" : "text-[var(--color-fg-muted)]";

  const buy = (consensus?.buy as number) ?? 0;
  const hold = (consensus?.hold as number) ?? 0;
  const sell = (consensus?.sell as number) ?? 0;
  const total = buy + hold + sell;
  const buyPct = total > 0 ? Math.round((buy / total) * 100) : 0;
  const holdPct = total > 0 ? Math.round((hold / total) * 100) : 0;
  const sellPct = total > 0 ? 100 - buyPct - holdPct : 0;

  return (
    <div className="space-y-5">
      {earnings ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[var(--color-fg-default)]">Earnings</p>
            {result ? <span className={`text-xs font-bold ${resultColor}`}>{result.replace("_", " ")}</span> : null}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <p className="text-[var(--color-fg-subtle)]">EPS actual / expected</p>
              <p className="mt-0.5 font-bold text-[var(--color-fg-default)]">
                ${earnings.epsActual as number} / ${earnings.epsExpected as number}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-fg-subtle)]">Revenue actual / expected</p>
              <p className="mt-0.5 font-bold text-[var(--color-fg-default)]">
                ${earnings.revenueActualM as number}M / ${earnings.revenueExpectedM as number}M
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {c.revenueGrowthYoY !== null && c.revenueGrowthYoY !== undefined ? (
          <Stat label="Revenue growth YoY" value={`${(c.revenueGrowthYoY as number).toFixed(1)}%`} />
        ) : null}
        {c.marginTrend ? (
          <Stat
            label="Margin"
            value={`${(c.marginTrend as string) === "improving" ? "↑" : (c.marginTrend as string) === "deteriorating" ? "↓" : "→"} ${c.marginTrend as string}`}
          />
        ) : null}
        {c.guidance && c.guidance !== "unknown" ? (
          <Stat
            label="Guidance"
            value={
              (c.guidance as string) === "raised"
                ? "↑ Raised"
                : (c.guidance as string) === "lowered"
                  ? "↓ Lowered"
                  : "→ Maintained"
            }
          />
        ) : null}
        {c.balanceSheet && c.balanceSheet !== "unknown" ? (
          <Stat label="Balance sheet" value={c.balanceSheet as string} />
        ) : null}
      </div>

      {valuation ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">Valuation</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1">
              P/E <span className="font-bold text-[var(--color-fg-default)]">{valuation.pe as number}x</span>
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1 text-[var(--color-fg-muted)]">
              sector avg {valuation.sectorAvgPe as number}x
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 font-medium ${
                (valuation.assessment as string) === "expensive"
                  ? "border-red-500/25 bg-red-500/10 text-red-300"
                  : (valuation.assessment as string) === "cheap"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]"
              }`}
            >
              {valuation.assessment as string}
            </span>
          </div>
        </div>
      ) : null}

      {consensus && total > 0 ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-bold text-[var(--color-fg-default)]">Analyst consensus</p>
            {consensus.avgTargetPrice ? (
              <p className="text-[11px] text-[var(--color-fg-muted)]">
                Target {(consensus.currency as string | undefined) ?? "$"}{consensus.avgTargetPrice as number}
              </p>
            ) : null}
          </div>
          <div className="flex h-2 gap-px overflow-hidden rounded-full">
            {buyPct > 0 ? <div className="rounded-l-full bg-blue-400/60" style={{ width: `${buyPct}%` }} /> : null}
            {holdPct > 0 ? <div className="bg-[var(--color-fg-subtle)]" style={{ width: `${holdPct}%` }} /> : null}
            {sellPct > 0 ? <div className="rounded-r-full bg-red-400/60" style={{ width: `${sellPct}%` }} /> : null}
          </div>
          <div className="mt-1.5 flex gap-3 text-[10px] text-[var(--color-fg-muted)]">
            <span><span className="font-bold text-blue-400">{buy}</span> buy</span>
            <span><span className="font-bold text-[var(--color-fg-default)]">{hold}</span> hold</span>
            <span><span className="font-bold text-red-400">{sell}</span> sell</span>
          </div>
        </div>
      ) : null}

      {c.insiderActivity && c.insiderActivity !== "unknown" ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Insider activity:{" "}
          <span
            className={`font-medium ${
              (c.insiderActivity as string) === "buying"
                ? "text-emerald-400"
                : (c.insiderActivity as string) === "selling"
                  ? "text-red-400"
                  : "text-[var(--color-fg-muted)]"
            }`}
          >
            {(c.insiderActivity as string) === "buying"
              ? "↑ Buying"
              : (c.insiderActivity as string) === "selling"
                ? "↓ Selling"
                : (c.insiderActivity as string)}
          </span>
        </p>
      ) : null}

      {c.fundamentalView ? <BodyText text={c.fundamentalView as string} /> : null}
      <SourceLinks sources={c.sources} />
    </div>
  );
}

function TechnicalSection({ content: c }: { content: Rec }) {
  const price = c.price as Rec | undefined;
  const mas = c.movingAverages as Rec | undefined;
  const rsi = c.rsi as Rec | undefined;
  const levels = c.keyLevels as Rec | undefined;

  const rsiVal = rsi?.value as number | null | undefined;
  const rsiSignal = rsi?.signal as string | undefined;
  const rsiColor =
    rsiSignal === "overbought"
      ? "text-red-400"
      : rsiSignal === "oversold"
        ? "text-emerald-400"
        : "text-[var(--color-fg-muted)]";

  return (
    <div className="space-y-5">
      {price ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">52-week range</p>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
            <span>${price.week52Low as number}</span>
            <div className="relative h-1.5 flex-1 rounded-full bg-[var(--color-bg-muted)]">
              <div
                className="absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-[var(--color-fg-muted)]"
                style={{ left: `${Math.min(100, Math.max(0, ((price.positionInRange as number) ?? 0) * 100))}%` }}
              />
            </div>
            <span>${price.week52High as number}</span>
          </div>
          <p className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">
            Current ${price.current as number} · {Math.round(((price.positionInRange as number) ?? 0) * 100)}% of range
          </p>
        </div>
      ) : null}

      {mas ? (
        <div className="grid grid-cols-2 gap-3">
          {mas.ma50 ? (
            <Stat label="50-day MA" value={`$${mas.ma50 as number}`} sub={mas.priceVsMa50 as string | undefined} />
          ) : null}
          {mas.ma200 ? (
            <Stat label="200-day MA" value={`$${mas.ma200 as number}`} sub={mas.priceVsMa200 as string | undefined} />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {rsiVal !== null && rsiVal !== undefined ? (
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-1.5 text-[11px]">
            RSI <span className={`ml-1 font-bold ${rsiColor}`}>{rsiVal}</span>
            {rsiSignal ? <span className={`ml-1 ${rsiColor}`}>({rsiSignal})</span> : null}
          </span>
        ) : null}
        {c.macd && c.macd !== "neutral" ? (
          <span
            className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${
              c.macd === "bullish"
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/25 bg-red-500/10 text-red-300"
            }`}
          >
            MACD {c.macd as string}
          </span>
        ) : null}
        {c.volume && c.volume !== "average" ? (
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-1.5 text-[11px] text-[var(--color-fg-muted)]">
            Volume {c.volume as string}
          </span>
        ) : null}
      </div>

      {levels ? (
        <div className="grid grid-cols-2 gap-3">
          {levels.support !== undefined ? (
            <Stat label="Support" value={`$${levels.support as number}`} />
          ) : null}
          {levels.resistance !== undefined ? (
            <Stat label="Resistance" value={`$${levels.resistance as number}`} />
          ) : null}
        </div>
      ) : null}

      {c.pattern ? <p className="text-[11px] italic text-[var(--color-fg-muted)]">{c.pattern as string}</p> : null}
      {c.technicalView ? <BodyText text={c.technicalView as string} /> : null}
      <SourceLinks sources={c.sources} />
    </div>
  );
}

function SentimentSection({ content: c }: { content: Rec }) {
  const actions = c.analystActions as Rec[] | undefined;
  const insiders = c.insiderTransactions as Rec[] | undefined;
  const news = c.majorNews as Rec[] | undefined;

  return (
    <div className="space-y-5">
      {actions && actions.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">Analyst actions</p>
          <div className="space-y-2">
            {actions.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                    (a.action as string)?.includes("Upgrade")
                      ? "bg-emerald-500/15 text-emerald-300"
                      : (a.action as string)?.includes("Downgrade")
                        ? "bg-red-500/15 text-red-300"
                        : "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]"
                  }`}
                >
                  {a.action as string}
                </span>
                <span className="text-[var(--color-fg-muted)]">{a.analyst as string}</span>
                {a.targetPrice ? (
                  <span className="ml-auto text-[var(--color-fg-subtle)]">→ ${a.targetPrice as number}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {insiders && insiders.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">Insider transactions</p>
          <div className="space-y-1.5">
            {insiders.slice(0, 4).map((tx, i) => (
              <div key={i} className="text-[11px]">
                <span
                  className={`font-medium ${(tx.type as string) === "Buy" ? "text-emerald-400" : "text-red-400"}`}
                >
                  {tx.type as string}
                </span>{" "}
                <span className="text-[var(--color-fg-default)]">{tx.insider as string}</span>
                {tx.shares ? <span className="text-[var(--color-fg-subtle)]"> · {tx.shares as string} shares</span> : null}
                {tx.value ? <span className="text-[var(--color-fg-subtle)]"> · ${tx.value as string}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {news && news.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">Recent news</p>
          <div className="space-y-2">
            {news.slice(0, 3).map((n, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2">
                <p className="text-[11px] font-medium text-[var(--color-fg-default)]">{n.headline as string}</p>
                {n.sentiment ? (
                  <p
                    className={`mt-0.5 text-[10px] ${
                      (n.sentiment as string) === "positive"
                        ? "text-emerald-400"
                        : (n.sentiment as string) === "negative"
                          ? "text-red-400"
                          : "text-[var(--color-fg-subtle)]"
                    }`}
                  >
                    {n.sentiment as string}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {c.shortInterest !== null && c.shortInterest !== undefined ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Short interest: <span className="font-medium text-[var(--color-fg-default)]">{c.shortInterest as string}</span>
        </p>
      ) : null}

      {c.narrativeShift ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Narrative:{" "}
          <span className="font-medium text-[var(--color-fg-default)]">{c.narrativeShift as string}</span>
        </p>
      ) : null}

      {c.sentimentView ? <BodyText text={c.sentimentView as string} /> : null}
      <SourceLinks sources={c.sources} />
    </div>
  );
}

function MacroSection({ content: c }: { content: Rec }) {
  const rate = c.rateEnvironment as Rec | undefined;
  const sector = c.sectorPerformance as Rec | undefined;
  const currency = c.currency as Rec | undefined;
  const geo = c.geopolitical as Rec | undefined;

  return (
    <div className="space-y-5">
      {rate ? (
        <Stat
          label={`${(rate.relevantBank as string) ?? "Central bank"} rate`}
          value={`${(rate.currentRate as string) ?? "—"} · ${(rate.direction as string) ?? ""}`}
          sub={(rate.relevance as string | undefined) ?? undefined}
        />
      ) : null}

      {sector ? (
        <Stat
          label={`${(sector.sectorName as string) ?? "Sector"} vs market (30d)`}
          value={`${(sector.performanceVsMarket30d as string) ?? "—"}`}
          sub={(sector.trend as string | undefined) ?? undefined}
        />
      ) : null}

      {currency ? (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {currency.usdIls ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1">
              USD/ILS{" "}
              <span className="font-bold text-[var(--color-fg-default)]">{currency.usdIls as string}</span>
            </span>
          ) : null}
          {currency.trend ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1 text-[var(--color-fg-muted)]">
              {currency.trend as string}
            </span>
          ) : null}
          {currency.impactOnPosition ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1 text-[var(--color-fg-muted)]">
              {currency.impactOnPosition as string}
            </span>
          ) : null}
        </div>
      ) : null}

      {geo?.relevantFactor ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Geopolitical:{" "}
          <span className="font-medium text-[var(--color-fg-default)]">{geo.relevantFactor as string}</span>
          {geo.riskLevel ? (
            <span className="ml-2 text-[var(--color-fg-subtle)]">({geo.riskLevel as string} risk)</span>
          ) : null}
        </p>
      ) : null}

      {c.marketRegime ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Market regime:{" "}
          <span className="font-medium text-[var(--color-fg-default)]">{c.marketRegime as string}</span>
        </p>
      ) : null}

      {c.macroView ? <BodyText text={c.macroView as string} /> : null}
      <SourceLinks sources={c.sources} />
    </div>
  );
}

function RiskSection({ content: c }: { content: Rec }) {
  const plPct = c.plPct as number | null | undefined;
  const plILS = c.plILS as number | null | undefined;
  const concentrated = c.concentrationFlag as boolean | undefined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {c.portfolioWeightPct !== undefined ? (
          <Stat
            label="Portfolio weight"
            value={`${(c.portfolioWeightPct as number).toFixed(1)}%`}
            sub={concentrated ? "⚠ Concentrated" : undefined}
          />
        ) : null}
        {c.positionValueILS !== undefined ? (
          <Stat
            label="Position value"
            value={`₪${((c.positionValueILS as number) / 1000).toFixed(0)}K`}
          />
        ) : null}
        {plPct !== null && plPct !== undefined ? (
          <Stat
            label="P/L"
            value={
              <span className={plPct >= 0 ? "text-emerald-400" : "text-red-400"}>
                {plPct >= 0 ? "+" : ""}
                {plPct.toFixed(1)}%
              </span>
            }
            sub={
              plILS !== null && plILS !== undefined
                ? `₪${(Math.abs(plILS) / 1000).toFixed(0)}K ${plILS >= 0 ? "gain" : "loss"}`
                : undefined
            }
          />
        ) : null}
      </div>

      {c.avgPricePaid !== undefined ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Avg price paid:{" "}
          <span className="font-medium text-[var(--color-fg-default)]">
            {c.avgPricePaid as string}
          </span>
          {c.livePriceCurrency ? (
            <span className="ml-1 text-[var(--color-fg-subtle)]">{c.livePriceCurrency as string}</span>
          ) : null}
        </p>
      ) : null}

      {concentrated ? (
        <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/8 px-3 py-2 text-[11px] text-yellow-300">
          ⚠ Position exceeds 10% portfolio weight — concentration risk
        </div>
      ) : null}

      {c.riskFacts ? <BodyText text={c.riskFacts as string} /> : null}
    </div>
  );
}

function QuickCheckSection({ content: c }: { content: Rec }) {
  const score = c.score as number | null | undefined;
  const signals = c.signals as string[] | undefined;
  const stratHealth = c.strategy_health as string[] | undefined;
  const decision = (c.decision as string) ?? "";
  const advisorReasons = c.advisor_reasons as string[] | undefined;

  const decisionStyle =
    decision === "safe"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      : decision === "escalate" || decision === "not_safe"
        ? "border-red-500/25 bg-red-500/10 text-red-300"
        : "border-yellow-500/25 bg-yellow-500/10 text-yellow-300";

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        {score !== null && score !== undefined ? (
          <div className="relative h-14 w-14 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-[var(--color-border)]" />
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeDasharray={`${(score / 100) * 87.96} 87.96`}
                className={score >= 70 ? "text-emerald-400" : score >= 40 ? "text-yellow-400" : "text-red-400"}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[var(--color-fg-default)]">
              {score}
            </span>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-medium ${decisionStyle}`}>
            {decision === "not_safe" ? "escalate" : decision || "—"}
          </span>
          {score !== null && score !== undefined ? (
            <p className="text-[11px] font-medium text-[var(--color-fg-muted)]">
              {scoreBucketEmoji(score)} {scoreBucketLabel(score)} — {scoreExplanation(score)}
            </p>
          ) : null}
          {c.escalation_reason ? (
            <p className="text-[11px] text-[var(--color-fg-muted)]">{c.escalation_reason as string}</p>
          ) : null}
        </div>
      </div>

      {signals && signals.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">Signals</p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s) => (
              <span
                key={s}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1 text-[11px] text-[var(--color-fg-muted)]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {stratHealth && stratHealth.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-bold text-[var(--color-fg-default)]">Strategy health</p>
          <div className="space-y-1">
            {stratHealth.map((s) => (
              <p key={s} className="text-[11px] text-[var(--color-fg-muted)]">· {s}</p>
            ))}
          </div>
        </div>
      ) : null}

      {c.advisor_summary ? <BodyText text={c.advisor_summary as string} /> : null}

      {advisorReasons && advisorReasons.length > 0 ? (
        <div className="space-y-1">
          {advisorReasons.map((r) => (
            <p key={r} className="text-[11px] text-[var(--color-fg-muted)]">· {r}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StrategySection({ content: c }: { content: Rec }) {
  type Catalyst = { description: string; expiresAt: string | null; triggered: boolean };
  const catalysts = c.catalysts as Catalyst[] | undefined;
  const entryConditions = c.entryConditions as string[] | undefined;
  const exitConditions = c.exitConditions as string[] | undefined;
  const verdict = isVerdict(c.verdict) ? c.verdict : null;
  const confidence = typeof c.confidence === "string" ? c.confidence : null;
  const reasoning = typeof c.reasoning === "string" ? reasoningSnippet(c.reasoning, 280) : "";

  return (
    <div className="space-y-5">
      {verdict || confidence ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2">
          {verdict ? (
            <p className="text-sm font-bold text-[var(--color-fg-default)]">
              {verdict}: {verdictSentence(verdict)}
            </p>
          ) : null}
          {confidence ? (
            <p className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
              {confidenceExplanation(confidence)}
            </p>
          ) : null}
        </div>
      ) : null}

      {reasoning ? <BodyText text={reasoning} /> : null}

      {catalysts && catalysts.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--color-fg-default)]">Catalysts</p>
          <div className="space-y-2">
            {catalysts.map((cat, i) => {
              const expired = cat.expiresAt && new Date(cat.expiresAt) < new Date() && !cat.triggered;
              return (
                <div
                  key={i}
                  className={`rounded-xl border px-3 py-2 text-[11px] ${
                    cat.triggered
                      ? "border-emerald-500/20 bg-emerald-500/6"
                      : expired
                        ? "border-red-500/20 bg-red-500/6"
                        : "border-[var(--color-border)] bg-[var(--color-bg-muted)]"
                  }`}
                >
                  <p className="text-[var(--color-fg-default)]">{formatCatalyst(cat)}</p>
                  <div className="mt-0.5 flex gap-3 text-[10px] text-[var(--color-fg-subtle)]">
                    {cat.triggered ? <span className="text-emerald-400">✓ Triggered</span> : null}
                    {expired ? <span className="text-red-400">⚠ Expired</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {c.bullCase || c.bearCase ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {c.bullCase ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/6 px-3 py-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">Bull</p>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{c.bullCase as string}</p>
            </div>
          ) : null}
          {c.bearCase ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/6 px-3 py-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-red-400">Bear</p>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{c.bearCase as string}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {entryConditions && entryConditions.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-bold text-[var(--color-fg-default)]">Entry conditions</p>
          <div className="space-y-1">
            {entryConditions.map((cond, i) => (
              <p key={i} className="text-[11px] text-[var(--color-fg-muted)]">· {cond}</p>
            ))}
          </div>
        </div>
      ) : null}

      {exitConditions && exitConditions.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-bold text-[var(--color-fg-default)]">Exit conditions</p>
          <div className="space-y-1">
            {exitConditions.map((cond, i) => (
              <p key={i} className="text-[11px] text-[var(--color-fg-muted)]">· {cond}</p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BullBearSection({ bull, bear }: { bull: Rec | null; bear: Rec | null }) {
  if (!bull && !bear) {
    return <p className="text-sm text-[var(--color-fg-muted)]">No bull/bear analysis available.</p>;
  }

  function renderArgs(args: unknown) {
    if (!Array.isArray(args)) return null;
    return (
      <div className="space-y-2">
        {(args as Rec[]).map((arg, i) => (
          <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2">
            <p className="text-[11px] font-medium text-[var(--color-fg-default)]">{arg.claim as string}</p>
            {arg.dataPoint ? (
              <p className="mt-0.5 text-[10px] text-[var(--color-fg-subtle)]">{arg.dataPoint as string}</p>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {bull ? (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-400">
            Bull case {bull.round ? `· Round ${bull.round as number}` : ""}
          </p>
          {bull.coreThesis ? (
            <p className="mb-3 text-sm font-medium text-emerald-300">{bull.coreThesis as string}</p>
          ) : null}
          {renderArgs(bull.arguments)}
          {bull.conditionToBeWrong ? (
            <p className="mt-2 text-[11px] italic text-[var(--color-fg-subtle)]">
              Wrong if: {bull.conditionToBeWrong as string}
            </p>
          ) : null}
        </div>
      ) : null}

      {bull && bear ? <hr className="border-[var(--color-border)]" /> : null}

      {bear ? (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-red-400">
            Bear case {bear.round ? `· Round ${bear.round as number}` : ""}
          </p>
          {bear.coreConcern ? (
            <p className="mb-3 text-sm font-medium text-red-300">{bear.coreConcern as string}</p>
          ) : null}
          {renderArgs(bear.arguments)}
          {bear.conditionToBeWrong ? (
            <p className="mt-2 text-[11px] italic text-[var(--color-fg-subtle)]">
              Wrong if: {bear.conditionToBeWrong as string}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AnalystTabContent({
  reportType,
  detailReports,
}: {
  reportType: DetailReportType;
  detailReports: Record<string, DetailReportResponse> | null | undefined;
}) {
  if (reportType === "bull_case") {
    return (
      <BullBearSection
        bull={getReportContent(detailReports, "bull_case")}
        bear={getReportContent(detailReports, "bear_case")}
      />
    );
  }

  const content = getReportContent(detailReports, reportType);
  if (!content) {
    return (
      <p className="text-sm text-[var(--color-fg-muted)]">
        No {TAB_LABELS[reportType].toLowerCase()} data available.
      </p>
    );
  }

  switch (reportType) {
    case "fundamentals": return <FundamentalsSection content={content} />;
    case "technical": return <TechnicalSection content={content} />;
    case "sentiment": return <SentimentSection content={content} />;
    case "macro": return <MacroSection content={content} />;
    case "risk": return <RiskSection content={content} />;
    case "strategy": return <StrategySection content={content} />;
    case "quick_check": return <QuickCheckSection content={content} />;
    default: return null;
  }
}

// ─── Report card ──────────────────────────────────────────────────────────────

function ReportCard({
  item,
  expanded,
  onToggle,
  selectedTicker,
  onSelectTicker,
  activeTab,
  onTabChange,
  detailReports,
  detailsLoading,
  expandedReportTypes,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
  activeTab: DetailReportType;
  onTabChange: (tab: DetailReportType) => void;
  detailReports: Record<string, DetailReportResponse> | null | undefined;
  detailsLoading: boolean;
  expandedReportTypes: DetailReportType[];
}) {
  const language = usePreferencesStore((s) => s.language);
  const meta = modeMeta(item.mode);
  const entries = Object.values(item.entries);
  const { escalated } = groupEntries(entries);
  const selectedEntry = selectedTicker ? item.entries[selectedTicker] : entries[0];
  const isMultiTicker = item.tickers.length > 1;
  const isBriefMode = item.mode === "daily_brief" || item.mode === "full_report";
  const trackingEntry = !isBriefMode && selectedEntry?.assetScope === "tracking" ? selectedEntry : null;
  const portfolioDailyEntries = entries.filter((entry) => entry.dailySection !== "tracking");
  const trackingDailyEntries = entries.filter((entry) => entry.dailySection === "tracking");
  const trackingActionEntries = trackingDailyEntries.filter((entry) => entry.needsEscalation);
  const portfolioMovers = portfolioDailyEntries
    .filter((entry) => Number.isFinite(entry.dayChangePct))
    .sort((a, b) => Math.abs(b.dayChangePct ?? 0) - Math.abs(a.dayChangePct ?? 0))
    .slice(0, 5);
  const dailyEntries = portfolioDailyEntries.filter((entry) => entry.mode === "daily_brief");
  const hasDailyQueueMetadata = dailyEntries.some(
    (entry) => typeof entry.needsEscalation === "boolean" || typeof entry.deepDiveQueued === "boolean"
  );
  const queuedDailyEntries = dailyEntries.filter((entry) => entry.deepDiveQueued);
  const attentionDailyEntries = dailyEntries.filter((entry) => {
    const needsAttention = hasDailyQueueMetadata
      ? entry.needsEscalation === true
      : entry.reasoning !== "On track";
    return needsAttention && !entry.deepDiveQueued;
  });
  const nextWatchText =
    item.mode === "daily_brief" && !hasDailyQueueMetadata && attentionDailyEntries.length > 0
      ? "These positions were flagged for attention. This older daily brief did not store exact auto-queue metadata, so it should not be read as proof that every listed ticker had a deep dive queued."
      : item.dailyBrief?.tomorrow;
  const orderedEntries = sortEntriesForReview(entries);
  const topEntries = orderedEntries.slice(0, 1);
  const flaggedCount = escalated.length + attentionDailyEntries.length;
  const badgeTone = flaggedCount > 0 ? "warning" : trackingDailyEntries.length > 0 ? "info" : "default";
  const summaryMetrics = [
    {
      label: "Coverage",
      value: isBriefMode
        ? `${item.tickerCount} positions`
        : `${selectedEntry?.ticker ?? item.tickers[0] ?? "—"}`,
    },
  ];
  // Tabs: don't show bear_case as its own tab (rendered inside bull_case tab)
  const visibleTabs = expandedReportTypes.filter((t) => t !== "bear_case");

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] shadow-sm">
      {/* ── Tappable header ── */}
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="p-4">
          {/* Mode + date row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]">
                {meta.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-fg-subtle)]">
                  <span>{meta.label}</span>
                  {item.tickerCount > 1 ? (
                    <span className="rounded-full bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[10px]">
                      {item.tickerCount}
                    </span>
                  ) : null}
                </div>
                <h4 className="mt-1 truncate text-base font-semibold text-[var(--color-fg-default)]">{item.title}</h4>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="block text-xs text-[var(--color-fg-subtle)]">{formatDate(item.createdAt)}</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <SignalBadge
              icon={flaggedCount > 0 ? <ShieldAlert size={12} /> : trackingDailyEntries.length > 0 ? <Eye size={12} /> : <Layers3 size={12} />}
              label={
                flaggedCount > 0
                  ? `${flaggedCount} need review`
                  : trackingDailyEntries.length > 0
                    ? `${trackingDailyEntries.length} watchlist names`
                    : `${item.tickerCount} names covered`
              }
              tone={badgeTone}
            />
            {queuedDailyEntries.length > 0 ? (
              <SignalBadge icon={<Radar size={12} />} label={`${queuedDailyEntries.length} deep dives queued`} tone="info" />
            ) : null}
            {!isBriefMode && selectedEntry?.verdict ? (
              <SignalBadge
                icon={<span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none">{VERDICT_SYMBOLS[selectedEntry.verdict] ?? "•"}</span>}
                label={selectedEntry.verdict}
                tone="default"
              />
            ) : null}
          </div>

          {isBriefMode ? (
            <p className="mt-1.5 text-[11px] font-medium text-[var(--color-fg-subtle)]">
              {summaryMetrics[0]?.value}
            </p>
          ) : null}

          {/* Escalation alert — non-interactive colored tags for brief modes */}
          {false ? (
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-1.5">
                <AlertTriangle size={11} className="text-yellow-400" />
                <span className="text-sm font-medium text-yellow-400">
                  {escalated.length} position{escalated.length !== 1 ? "s" : ""} flagged
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {escalated.map((e) => (
                  <span
                    key={e.ticker}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${VERDICT_COLORS[e.verdict] ?? ""}`}
                  >
                    <span className="font-bold">{e.ticker}</span>
                    <span className="mx-1 opacity-40">·</span>
                    {e.verdict}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Single-ticker verdict (deep dive / quick check / new ideas) */}
          {!isBriefMode && selectedEntry ? (
            <div className="mt-3 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${VERDICT_COLORS[selectedEntry.verdict] ?? ""}`}>
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none">
                  {VERDICT_SYMBOLS[selectedEntry.verdict] ?? "•"}
                </span>
                {selectedEntry.verdict}
              </span>
              <span className={`text-sm font-medium ${CONFIDENCE_COLORS[selectedEntry.confidence] ?? "text-[var(--color-fg-muted)]"}`}>
                {tConfidence(selectedEntry.confidence, language)}
              </span>
              {selectedEntry.timeframe && selectedEntry.timeframe !== "undefined" ? (
                <span className="text-xs text-[var(--color-fg-subtle)]">· {selectedEntry.timeframe}</span>
              ) : null}
            </div>
          ) : null}
          {!isBriefMode && selectedEntry && expanded ? (
            <p className="mt-2 text-[12px] leading-5 text-[var(--color-fg-muted)]">
              {isVerdict(selectedEntry.verdict) ? `${verdictSentence(selectedEntry.verdict)} ` : ""}
              {confidenceExplanation(selectedEntry.confidence)}
            </p>
          ) : null}

          {/* Summary — clamped in collapsed state, full text in expanded panel */}
          <p className={`mt-2 text-sm leading-6 text-[var(--color-fg-muted)] ${!expanded ? "line-clamp-2" : ""}`}>{item.summary}</p>
          {topEntries.length > 0 ? (
            <div className="mt-2 flex items-start gap-2 text-sm leading-6 text-[var(--color-fg-muted)]">
              <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent-blue)]" />
              <p className="line-clamp-1">
                {topEntries[0]?.ticker}: {topEntries[0]?.moveReason ?? topEntries[0]?.deepDiveQueueReason ?? topEntries[0]?.reasoning}
              </p>
            </div>
          ) : null}
          {trackingEntry && expanded ? (
            <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">Tracked idea</p>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--color-fg-muted)]">
                {trackingEntry.stance ? <span className="font-bold text-[var(--color-fg-default)]">{trackingEntry.stance}</span> : null}
                {typeof trackingEntry.potentialScore === "number" ? <span>{trackingEntry.potentialScore}/100 potential</span> : null}
                {typeof trackingEntry.urgencyScore === "number" ? <span>{trackingEntry.urgencyScore}/100 urgency</span> : null}
                {typeof trackingEntry.suggestedAllocationPct === "number" ? (
                  <span>{trackingEntry.suggestedAllocationPct.toFixed(1)}% / {formatILS(trackingEntry.suggestedAllocationILS)}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {item.dailyBrief?.marketView && expanded ? (
            <p className="mt-2 text-sm leading-6 text-[var(--color-fg-subtle)]">{item.dailyBrief.marketView}</p>
          ) : null}

          <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border)]/50 pt-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-wide transition-all ${
                expanded
                  ? "border-[var(--color-border)] bg-transparent text-[var(--color-fg-muted)]"
                  : "border-[var(--color-accent-blue)]/40 bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
              }`}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? "Collapse" : "View report"}
            </span>
          </div>

        </div>
      </button>

      {/* ── Expanded panel ── */}
      {expanded ? (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-base)]/60">
          {item.dailyBrief ? (
            <div className="px-5 py-5">
              <div className="space-y-5">
                <InsightSection
                  title="Session brief"
                  subtitle={item.dailyBrief.headline ?? "A structured readout of what changed across the portfolio and watchlist."}
                >
                  {item.dailyBrief.today ? <p className="text-sm leading-6 text-[var(--color-fg-muted)]">{item.dailyBrief.today}</p> : null}
                </InsightSection>
                {portfolioMovers.length > 0 ? (
                  <InsightSection
                    title="Biggest portfolio movers"
                    subtitle="Largest same-day changes with the analyst explanation attached to each position."
                  >
                    <div className="space-y-2">
                      {portfolioMovers.map((entry) => (
                        <FeedTickerCard
                          key={entry.ticker}
                          ticker={entry.ticker}
                          detail={entry.moveReason ?? entry.reasoning}
                          trailing={
                            <span className={`text-xs font-semibold ${(entry.dayChangePct ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
                              {(entry.dayChangePct ?? 0) > 0 ? "+" : ""}{entry.dayChangePct ?? 0}%
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </InsightSection>
                ) : null}
                {trackingDailyEntries.length > 0 ? (
                  <InsightSection
                    title="Tracking watchlist"
                    subtitle="Names outside the live portfolio that the analyst believes deserve continued monitoring."
                  >
                    <div className="space-y-2">
                      {trackingDailyEntries.map((entry) => (
                        <FeedTickerCard
                          key={entry.ticker}
                          ticker={entry.ticker}
                          tone="info"
                          headline={entry.stance ? <span className="uppercase tracking-[0.12em]">{entry.stance}</span> : undefined}
                          detail={entry.reasoning}
                          meta={[
                            typeof entry.potentialScore === "number" ? `${entry.potentialScore}/100 potential` : "",
                            typeof entry.urgencyScore === "number" ? `${entry.urgencyScore}/100 urgency` : "",
                            typeof entry.suggestedAllocationPct === "number" ? `${entry.suggestedAllocationPct.toFixed(1)}% suggested` : "",
                          ].filter(Boolean)}
                        />
                      ))}
                    </div>
                  </InsightSection>
                ) : null}
                {trackingActionEntries.length > 0 ? (
                  <InsightSection
                    title="Tracking action candidates"
                    subtitle="Watchlist names with enough change or urgency to justify a deeper review."
                  >
                    <div className="space-y-2">
                      {trackingActionEntries.map((entry) => (
                        <FeedTickerCard
                          key={entry.ticker}
                          ticker={entry.ticker}
                          tone="warning"
                          detail={entry.deepDiveQueueReason ?? entry.reasoning}
                        />
                      ))}
                    </div>
                  </InsightSection>
                ) : null}
                {queuedDailyEntries.length > 0 ? (
                  <InsightSection
                    title="Queued deep dives"
                    subtitle="Positions that this brief escalated into a deeper single-position workflow."
                  >
                    <div className="space-y-2">
                      {queuedDailyEntries.map((entry) => (
                        <FeedTickerCard
                          key={entry.ticker}
                          ticker={entry.ticker}
                          tone="warning"
                          detail={`${entry.reasoning}. ${entry.deepDiveQueueReason ?? "Deep dive was queued by this daily brief."}`}
                        />
                      ))}
                    </div>
                  </InsightSection>
                ) : null}
                {attentionDailyEntries.length > 0 ? (
                  <InsightSection
                    title="Needs review"
                  >
                    <div className="space-y-2">
                      {attentionDailyEntries.map((entry) => (
                        <FeedTickerCard
                          key={entry.ticker}
                          ticker={entry.ticker}
                          detail={`${entry.reasoning}. ${entry.deepDiveQueueReason ?? "Flagged for attention; no deep dive queue confirmation is attached to this daily brief."}`}
                        />
                      ))}
                    </div>
                  </InsightSection>
                ) : null}
                {item.dailyBrief.marketView || item.dailyBrief.tomorrow || item.dailyBrief.securityNote ? (
                  <InsightSection
                    title="Next watch"
                    subtitle="What the analyst expects to matter next across the portfolio."
                  >
                    {nextWatchText ? <p className="text-sm leading-6 text-[var(--color-fg-muted)]">{nextWatchText}</p> : null}
                    {item.dailyBrief.marketView ? <p className="mt-2 text-sm leading-6 text-[var(--color-fg-muted)]">{item.dailyBrief.marketView}</p> : null}
                    {item.dailyBrief.securityNote ? <p className="mt-2 text-sm leading-6 text-[var(--color-fg-default)]">{item.dailyBrief.securityNote}</p> : null}
                  </InsightSection>
                ) : null}
                {item.dailyBrief.dashboardPath ? (
                  <Link
                    to={item.dailyBrief.dashboardPath}
                    className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-default)]"
                  >
                    Open dashboard
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
          {/* Ticker grid — for multi-ticker batches */}
          {isMultiTicker ? (
            <div className="px-5 pt-1">
              <p className="mb-2 text-xs font-medium text-[var(--color-fg-subtle)]">
                Select a position to inspect
              </p>
              <div className="flex flex-wrap gap-2">
                {orderedEntries.map((e) => (
                  <VerdictPill
                    key={e.ticker}
                    ticker={e.ticker}
                    verdict={e.verdict}
                    confidence={e.confidence}
                    active={selectedTicker === e.ticker}
                    onClick={() => onSelectTicker(e.ticker)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Analyst tabs */}
          {visibleTabs.length > 0 ? (
            <div className="px-5 pt-4">
              {/* Tab bar */}
              <div className="-mx-5 overflow-x-auto">
                <div className="flex min-w-max border-b border-[var(--color-border)] px-5">
                  {visibleTabs.map((tabType) => (
                    <button
                      key={tabType}
                      type="button"
                      onClick={() => onTabChange(tabType)}
                      className={`mr-5 shrink-0 border-b-2 pb-3 pt-1 text-xs font-semibold tracking-wide transition-colors ${
                        activeTab === tabType
                          ? "border-[var(--color-accent-blue)] text-[var(--color-fg-default)]"
                          : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]"
                      }`}
                    >
                      {TAB_LABELS[tabType]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="pb-6 pt-5">
                {detailsLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner size="md" />
                  </div>
                ) : (
                  <AnalystTabContent reportType={activeTab} detailReports={detailReports} />
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Reports() {
  const language = usePreferencesStore((s) => s.language);
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedBatchId = searchParams.get("batch");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [selectedTickerByBatch, setSelectedTickerByBatch] = useState<Record<string, string>>({});
  const [activeTabByBatch, setActiveTabByBatch] = useState<Record<string, DetailReportType>>({});

  const reportPath = useMemo(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("mode", filter);
    if (deferredSearch) params.set("q", deferredSearch);
    const suffix = params.toString();
    return `/reports/feed/${page}${suffix ? `?${suffix}` : ""}`;
  }, [deferredSearch, filter, page]);

  const { data: feedData, isLoading, isFetching } = useQuery({
    queryKey: ["reports-feed", page, filter, deferredSearch],
    queryFn: () => apiClient.get<FeedPageResponse>(reportPath).then((r) => r.data),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ["jobs-reports"],
    queryFn: fetchJobs,
    staleTime: 5_000,
    refetchInterval: 8_000,
  });

  const activeJobs = useMemo(
    () =>
      (jobsData?.jobs ?? []).filter(
        (job) =>
          (job.status === "pending" || job.status === "paused" || job.status === "running") &&
          ["deep_dive", "full_report", "daily_brief", "quick_check", "new_ideas"].includes(job.action)
      ),
    [jobsData]
  );

  async function refreshJobs() {
    await queryClient.invalidateQueries({ queryKey: ["jobs-reports"] });
    await queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }

  async function handleCancel(job: Job) {
    try {
      setBusyJobId(job.id);
      await cancelJob(job.id);
      showToast(`${job.ticker ?? "Deep dive"} cancelled`, "success");
      await refreshJobs();
    } catch {
      showToast("Failed to cancel deep dive", "error");
    } finally {
      setBusyJobId(null);
    }
  }

  async function handleResume(job: Job) {
    try {
      setBusyJobId(job.id);
      await resumeJob(job.id);
      showToast(`${job.ticker ?? "Deep dive"} resumed`, "success");
    } catch {
      showToast("Not enough balance to resume this deep dive yet", "warning");
    } finally {
      await refreshJobs();
      setBusyJobId(null);
    }
  }

  const reportItems = useMemo(
    () => (feedData?.items ?? []).filter((item) => item.kind !== "market_news"),
    [feedData]
  );

  // Sync expanded state from URL (deep-link / back-forward navigation).
  // Intentionally excludes expandedBatchId from deps: the effect should only
  // fire when the URL-derived batch ID changes, not when the user toggles the
  // card (which would race with setSearchParams and re-expand a card the user
  // just collapsed).
  useEffect(() => {
    if (!linkedBatchId) return;
    if (reportItems.some((item) => item.batchId === linkedBatchId)) {
      setExpandedBatchId(linkedBatchId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBatchId, reportItems]);

  // Derive expanded state
  const expandedItem = reportItems.find((item) => item.batchId === expandedBatchId) ?? null;
  const expandedReportTypes = expandedItem ? reportTypesForItem(expandedItem) : [];
  const expandedTicker =
    expandedItem
      ? (selectedTickerByBatch[expandedItem.batchId ?? ""] ?? expandedItem.tickers[0] ?? null)
      : null;

  const { data: detailReports, isLoading: detailsLoading } = useQuery({
    queryKey: ["report-details", expandedItem?.batchId, expandedTicker, expandedReportTypes.join(":")],
    enabled: Boolean(expandedItem?.batchId && expandedTicker),
    queryFn: () => fetchDetailReports(expandedItem!.batchId!, expandedTicker!, expandedReportTypes),
    staleTime: 60_000,
  });

  function handleToggle(item: FeedItem) {
    const next = expandedBatchId === item.batchId ? null : item.batchId;
    setExpandedBatchId(next);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set("batch", next);
      else params.delete("batch");
      return params;
    }, { replace: true });
    if (next) {
      const bk = item.batchId ?? item.id;
      if (!selectedTickerByBatch[bk] && item.tickers[0]) {
        setSelectedTickerByBatch((s) => ({ ...s, [bk]: item.tickers[0] }));
      }
      if (!activeTabByBatch[bk]) {
        const defaultTab = reportTypesForItem(item).find((t) => t !== "bear_case") ?? "strategy";
        setActiveTabByBatch((s) => ({ ...s, [bk]: defaultTab }));
      }
    }
  }

  return (
    <>
      <div style={{ padding: "20px 16px 0" }}>
        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)", color: "var(--text-primary)", margin: 0 }}>
          {t("feed", language)}
        </h1>
      </div>

      <div className="space-y-4 px-4 pb-10 pt-3">
        {/* ── Search + filters ── */}
        <div className="space-y-3">
          <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search ticker, verdict, reasoning…"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3.5 py-2.5 text-sm text-[var(--color-fg-default)] outline-none transition-colors focus:border-[var(--color-accent-blue)] placeholder:text-[var(--color-fg-subtle)]"
            />

          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFilter(f.id);
                  setPage(1);
                }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
                  filter === f.id
                    ? "bg-[var(--color-accent-blue)] text-white shadow-sm"
                    : "border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]"
                }`}
              >
                {f.label}
              </button>
            ))}
            {isFetching ? (
              <span className="shrink-0 self-center pl-1 text-[10px] text-[var(--color-fg-subtle)]">
                Refreshing…
              </span>
            ) : null}
          </div>
        </div>

        {/* ── Active jobs (minimized by default) ── */}
        {activeJobs.length > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setJobsExpanded((e) => !e)}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                </span>
                <span className="text-[11px] font-medium text-[var(--color-fg-muted)]">
                  {activeJobs.length} queued job{activeJobs.length !== 1 ? "s" : ""}
                  {activeJobs[0]?.progress?.currentTicker
                    ? ` · ${activeJobs[0].progress.currentTicker}`
                    : activeJobs[0]?.action
                      ? ` · ${activeJobs[0].action.replace(/_/g, " ")}`
                      : ""}
                </span>
              </div>
              <span className="text-[10px] text-[var(--color-fg-subtle)]">
                {jobsExpanded ? "hide" : "details"}
              </span>
            </button>

            {jobsExpanded ? (
              <div className="mt-2 space-y-2">
                {activeJobs.map((job) => (
                  <ActiveJobCard
                    key={job.id}
                    job={job}
                    onCancel={handleCancel}
                    onResume={handleResume}
                    busy={busyJobId === job.id}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ── Feed ── */}
        {isLoading ? (
          <div className="flex justify-center py-14">
            <Spinner size="lg" />
          </div>
        ) : reportItems.length === 0 ? (
          <EmptyState
            message={
              deferredSearch
                ? `No reports found for "${deferredSearch}".`
                : "No completed reports yet."
            }
            icon={deferredSearch ? "🔍" : "📄"}
          />
        ) : (
          <div className="space-y-3">
            {reportItems.map((item) => {
              const expanded = expandedBatchId === item.batchId;
              const bk = item.batchId ?? item.id;
              const selectedTicker = selectedTickerByBatch[bk] ?? item.tickers[0] ?? null;
              const activeTab: DetailReportType =
                activeTabByBatch[bk] ??
                (expanded ? expandedReportTypes.find((t) => t !== "bear_case") ?? "strategy" : "strategy");

              return (
                <ReportCard
                  key={item.id}
                  item={item}
                  expanded={expanded}
                  onToggle={() => handleToggle(item)}
                  selectedTicker={selectedTicker}
                  onSelectTicker={(ticker) =>
                    setSelectedTickerByBatch((s) => ({ ...s, [bk]: ticker }))
                  }
                  activeTab={activeTab}
                  onTabChange={(tab) => setActiveTabByBatch((s) => ({ ...s, [bk]: tab }))}
                  detailReports={expanded ? (detailReports ?? null) : null}
                  detailsLoading={expanded && detailsLoading}
                  expandedReportTypes={expanded ? expandedReportTypes : []}
                />
              );
            })}
          </div>
        )}

        {/* ── Pagination (hidden when search is active — backend returns all results) ── */}
        {feedData && feedData.totalPages > 1 && !deferredSearch ? (
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setPage((c) => Math.max(1, c - 1))}
              disabled={page === 1}
              className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              {t("newerBtn", language)}
            </button>
            <span className="text-xs text-[var(--color-fg-subtle)]">
              {page} / {feedData.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((c) => Math.min(feedData.totalPages, c + 1))}
              disabled={page === feedData.totalPages}
              className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              {t("olderBtn", language)}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
