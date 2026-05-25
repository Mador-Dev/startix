import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Circle, AlertTriangle } from "lucide-react";
import { fetchStrategy } from "../../api/strategies";
import { triggerJob } from "../../api/jobs";
import { Spinner } from "../ui/Spinner";
import { ErrorState } from "../ui/ErrorState";
import { ActionBadge } from "../design/ActionBadge";
import { StatCell } from "../design/StatCell";
import { ScoreBar } from "../design/HeroStatCard";
import { useToastStore } from "../../store/toastStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t, tConfidence } from "../../store/i18n";
import { formatILS, timeAgo } from "../../utils/format";
import { whyToday } from "../../utils/today/whyToday";
import { snippet } from "../../utils/today/classifyAttention";
import { scoreColor } from "../../utils/today/scoreColor";
import {
  verdictSentence,
  confidenceExplanation,
  scoreBucketLabel,
  scoreBucketEmoji,
  formatCatalyst,
  nextCatalyst,
  reasoningSnippet,
} from "../../utils/advisory";
import type { StrategyRow, AttentionItem, PositionRow, Verdict, VerdictRow } from "../../types/api";
import { ThesisSection } from "./ThesisSection";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { usePositionGuidance } from "../../hooks/usePositionGuidance";
import { healthScore, DEFAULT_STOP_LOSS_PCT } from "../../utils/today/healthScore";

interface StrategyModalProps {
  ticker: string | null;
  attentionItem?: AttentionItem | null;
  /** 1-indexed rank in the attention list — shown as "PR {N}" in "Why this fired" header */
  attentionRank?: number;
  score?: number;
  position?: PositionRow | null;
  onClose: () => void;
  onDeepDive?: (ticker: string) => void;
}

const VERDICT_LINE: Record<Verdict, string> = {
  BUY:    verdictSentence("BUY"),
  ADD:    verdictSentence("ADD"),
  HOLD:   verdictSentence("HOLD"),
  REDUCE: verdictSentence("REDUCE"),
  SELL:   verdictSentence("SELL"),
  CLOSE:  verdictSentence("CLOSE"),
};

/** Primary CTA label per verdict. HOLD → undefined = no primary button shown. */
const VERDICT_CTA: Partial<Record<Verdict, string>> = {
  REDUCE: "Deep dive before trimming",
  SELL: "Deep dive before exiting",
  CLOSE: "Deep dive before exiting",
  BUY: "Deep dive before adding",
  ADD: "Deep dive before adding",
};

function ctaBg(verdict: Verdict): string {
  switch (verdict) {
    case "BUY": case "ADD":    return "var(--color-green-bg)";
    case "REDUCE":             return "var(--color-amber-bg)";
    case "SELL": case "CLOSE": return "var(--color-red-bg)";
    default:                   return "var(--bg-surface)";
  }
}
function ctaFg(verdict: Verdict): string {
  switch (verdict) {
    case "BUY": case "ADD":    return "var(--color-green)";
    case "REDUCE":             return "var(--color-amber)";
    case "SELL": case "CLOSE": return "var(--color-red)";
    default:                   return "var(--text-primary)";
  }
}
function ctaBorder(verdict: Verdict): string {
  switch (verdict) {
    case "BUY": case "ADD":    return "var(--color-green-border)";
    case "REDUCE":             return "var(--color-amber-border)";
    case "SELL": case "CLOSE": return "var(--color-red-border)";
    default:                   return "var(--bg-border)";
  }
}

export function StrategyModal({
  ticker,
  attentionItem,
  attentionRank,
  score,
  position,
  onClose,
  onDeepDive,
}: StrategyModalProps) {
  const language = usePreferencesStore((s) => s.language);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategy", ticker],
    queryFn: () => fetchStrategy(ticker!),
    enabled: !!ticker,
  });

  const handleDeepDive = async () => {
    if (!ticker) return;
    try {
      await triggerJob("deep_dive", ticker);
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      showToast(`${t("jobDeepDiveTitle", language)} — ${ticker} ${t("jobQueued", language)}`, "success");
      onDeepDive?.(ticker);
    } catch (err) {
      const apiError = err as { response?: { data?: { reason?: string; error?: string } } };
      showToast(apiError.response?.data?.reason ?? t("jobFailed", language), "error");
    }
  };

  if (!ticker) return null;

  const verdictType = data?.verdict;
  const ctaLabel = verdictType ? (VERDICT_CTA[verdictType] ?? null) : null;

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
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
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
              {ticker}
            </div>
            {position && (
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
                {position.exchange === "TASE" ? "Tel Aviv Stock Exchange" : position.exchange}
              </div>
            )}
          </div>
          {data && <ActionBadge verdict={data.verdict} score={score} />}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
              <Spinner size="lg" />
            </div>
          )}
          {error && (
            <ErrorState message={t("failedLoadStrategy", language)} onRetry={() => refetch()} />
          )}
          {data && (
            <DetailContent
              strategy={data}
              ticker={ticker}
              attentionItem={attentionItem ?? null}
              attentionRank={attentionRank}
              score={score}
              position={position ?? null}
              language={language}
            />
          )}
        </div>

        {/* Footer — verdict-aware: no primary CTA for HOLD */}
        {data && (
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
                aria-label={`${ctaLabel} for ${ticker}`}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "var(--radius-md)",
                  background: ctaBg(verdictType),
                  color: ctaFg(verdictType),
                  border: `0.5px solid ${ctaBorder(verdictType)}`,
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
              {language === "he" ? "סגור" : "Close"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailContent({
  strategy,
  ticker,
  attentionItem,
  attentionRank,
  score,
  position,
  language,
}: {
  strategy: StrategyRow;
  ticker: string | null;
  attentionItem: AttentionItem | null;
  attentionRank?: number;
  score?: number;
  position: PositionRow | null;
  language: "en" | "he";
}) {
  const { guidanceMap, updateGuidance } = usePositionGuidance();
  const verdictLine = VERDICT_LINE[strategy.verdict];
  const heroScore = score ?? 0;
  const hasScore = score !== undefined && Number.isFinite(score);

  const scoreBreakdown = hasScore
    ? healthScore(strategy as unknown as VerdictRow, position ?? undefined, DEFAULT_STOP_LOSS_PCT).breakdown
    : null;

  const whyText = attentionItem
    ? whyToday(attentionItem, language)
    : strategy.reasoning
    ? snippet(strategy.reasoning, 140)
    : null;

  const rationale = twoSentences(strategy.reasoning);

  const dayChangePct = position?.dayChangePct ?? 0;
  const dayChangeILS = position?.dayChangeILS ?? 0;
  const hasDay = dayChangePct !== 0;

  const confidenceColor =
    strategy.confidence === "high"
      ? "var(--color-green)"
      : strategy.confidence === "low"
      ? "var(--color-amber)"
      : "var(--text-secondary)";

  const timeframeLabel =
    strategy.timeframe && strategy.timeframe !== "undefined"
      ? ` · ${strategy.timeframe.replace(/_/g, " ")} horizon`
      : "";
  return (
    <div>
      {/* ScoreHero — score left, verdict + updated right */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 16px 8px",
        }}
      >
        {/* Left: big score number + "POSITION SCORE" label */}
        <div>
          <span
            style={{
              display: "block",
              fontSize: "var(--text-hero)",
              fontWeight: "var(--weight-bold)",
              lineHeight: 1,
              letterSpacing: "-1.5px",
              color: hasScore ? scoreColor(heroScore) : "var(--text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hasScore ? heroScore : "—"}
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
          {hasScore && (
            <span
              style={{
                display: "block",
                fontSize: "var(--text-xs)",
                color: scoreColor(heroScore),
                marginTop: 2,
              }}
            >
              {scoreBucketEmoji(heroScore)} {scoreBucketLabel(heroScore)}
            </span>
          )}
        </div>

        {/* Right: verdict line + updated timestamp + timeframe */}
        <div style={{ textAlign: "end", maxWidth: "55%" }}>
          <div
            style={{
              fontSize: "var(--text-md)",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            {verdictLine}
          </div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              marginTop: 4,
            }}
          >
            {language === "he" ? "עודכן" : "Updated"} {timeAgo(strategy.updatedAt)}
            {timeframeLabel}
          </div>
        </div>
      </div>

      {/* Score bar */}
      {hasScore && (
        <div style={{ paddingBottom: scoreBreakdown ? 4 : 16 }}>
          <ScoreBar score={heroScore} />
        </div>
      )}
      {hasScore && scoreBreakdown && (
        <ScoreBreakdown breakdown={scoreBreakdown} score={heroScore} />
      )}

      <Divider />

      {/* 2×2 stat grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          padding: "12px 16px",
        }}
      >
        <StatCell
          label={language === "he" ? "משקל" : "Weight"}
          value={`${(strategy.positionWeightPct ?? position?.weightPct ?? 0).toFixed(1)}%`}
          sub="of portfolio"
        />
        <StatCell
          label={language === "he" ? "מניות" : "Shares held"}
          value={position?.shares !== undefined ? String(position.shares) : "—"}
          sub={
            position?.shares === 1
              ? "single unit"
              : position?.shares !== undefined
              ? `${position.shares} shares`
              : undefined
          }
        />
        <StatCell
          label={language === "he" ? "היום" : "Today"}
          value={hasDay ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "—"}
          sub={
            hasDay && dayChangeILS !== 0
              ? `${dayChangeILS >= 0 ? "+" : ""}${formatILS(Math.abs(dayChangeILS))}`
              : undefined
          }
          positive={hasDay ? dayChangePct > 0 : null}
        />
        <StatCell
          label={language === "he" ? "ביטחון" : "Confidence"}
          value={tConfidence(strategy.confidence, language)}
          valueColor={confidenceColor}
          sub={strategy.confidence === "low" ? "partial data" : undefined}
        />
      </div>

      <Divider />

      {/* Why this fired */}
      {whyText && (
        <>
          <SectionHeader
            label={language === "he" ? "למה זה עלה" : "Why this fired"}
            meta={
              attentionRank !== undefined && attentionRank > 0
                ? `Deterministic · PR ${attentionRank}`
                : `${language === "he" ? "עודכן" : "updated"} ${timeAgo(strategy.updatedAt)}`
            }
          />
          <p
            style={{
              padding: "0 16px 16px",
              fontSize: "var(--text-md)",
              lineHeight: 1.5,
              color: "var(--text-primary)",
              fontWeight: "var(--weight-regular)",
            }}
          >
            {whyText}
          </p>
        </>
      )}

      {/* Rationale — first 2 sentences, secondary color */}
      {rationale && rationale !== whyText && (
        <p
          style={{
            padding: "0 16px 16px",
            fontSize: "var(--text-md)",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            fontWeight: "var(--weight-regular)",
          }}
        >
          {rationale}
        </p>
      )}

      {/* Next catalyst — most urgent upcoming catalyst */}
      {(() => {
        const upcoming = nextCatalyst(strategy.catalysts ?? []);
        if (!upcoming) return null;
        return (
          <div
            style={{
              margin: "0 16px 16px",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "rgba(59,130,246,0.08)",
              border: "0.5px solid rgba(59,130,246,0.20)",
            }}
          >
            <div
              style={{
                fontSize: "var(--text-2xs)",
                fontWeight: "var(--weight-bold)",
                color: "var(--color-accent-blue, var(--text-secondary))",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}
            >
              {language === "he" ? "קטליסט הבא" : "Next catalyst"}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.4 }}>
              {formatCatalyst(upcoming)}
            </div>
          </div>
        );
      })()}

      {/* Confidence explanation */}
      <div
        style={{
          margin: "0 16px 16px",
          padding: "8px 12px",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-muted, rgba(0,0,0,0.04))",
          border: "0.5px solid var(--bg-border)",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--weight-bold)",
            color: confidenceColor,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginRight: 6,
          }}
        >
          {tConfidence(strategy.confidence, language)}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          {confidenceExplanation(strategy.confidence)}
        </span>
      </div>

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
            kind="bull"
            label={language === "he" ? "בעד" : "Bull case"}
            text={strategy.bullCase}
          />
          <BullBearCard
            kind="bear"
            label={language === "he" ? "נגד" : "Bear case"}
            text={strategy.bearCase}
          />
        </div>
      )}

      {/* Your thesis */}
      {ticker && (
        <>
          <Divider />
          <ThesisSection
            ticker={ticker}
            guidance={guidanceMap[ticker]}
            onUpdate={updateGuidance}
          />
        </>
      )}

      <Divider />

      {/* Conditions — exit first (most actionable), then entry */}
      <SectionHeader
        label={language === "he" ? "תנאים" : "Exit conditions"}
        meta={`${strategy.entryConditions.length + strategy.exitConditions.length} active`}
      />
      <div style={{ padding: "0 16px 24px" }}>
        {strategy.exitConditions.map((c, i) => (
          <ConditionRow
            key={`x-${i}`}
            kind="exit"
            text={c}
            label={language === "he" ? "יציאה" : "EXIT"}
            verdict={strategy.verdict}
          />
        ))}
        {strategy.entryConditions.map((c, i) => (
          <ConditionRow
            key={`e-${i}`}
            kind="entry"
            text={c}
            label={language === "he" ? "כניסה" : "ENTRY"}
            verdict={strategy.verdict}
          />
        ))}
        {strategy.entryConditions.length + strategy.exitConditions.length === 0 && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            {language === "he" ? "אין תנאים מוגדרים" : "No conditions set."}
          </div>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--bg-border)" }} />;
}

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "16px 16px 8px",
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
        <span
          style={{
            fontSize: "var(--text-2xs)",
            color: "var(--text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

function BullBearCard({
  kind,
  label,
  text,
}: {
  kind: "bull" | "bear";
  label: string;
  text: string | null | undefined;
}) {
  const bg = kind === "bull" ? "rgba(66,201,122,0.10)" : "rgba(226,80,80,0.10)";
  const border = kind === "bull" ? "var(--color-green-border)" : "var(--color-red-border)";
  const labelColor = kind === "bull" ? "var(--color-green)" : "var(--color-red)";

  return (
    <div
      style={{
        background: bg,
        borderRadius: "var(--radius-md)",
        border: `0.5px solid ${border}`,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-bold)",
          color: labelColor,
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
        }}
      >
        {text ?? "—"}
      </div>
    </div>
  );
}

function ConditionRow({
  kind,
  text,
  label,
  verdict,
}: {
  kind: "entry" | "exit";
  text: string;
  label: string;
  verdict?: Verdict;
}) {
  let Icon: typeof Circle | typeof Check | typeof AlertTriangle = Circle;
  let dotColor = kind === "exit" ? "var(--color-amber)" : "var(--text-ghost)";

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
      <Icon
        size={10}
        color={dotColor}
        style={{ marginTop: 4, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.4 }}>
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
  return reasoningSnippet(text, 280);
}
