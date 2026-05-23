import { clsx } from "clsx";
import type { Verdict, Confidence } from "../../types/api";
import { tConfidence } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface VerdictBadgeProps {
  verdict: Verdict | string;
  size?: "sm" | "md";
}

const verdictStyles: Record<string, string> = {
  BUY:    "bg-[var(--color-green-bg)] text-[var(--color-green)] border border-[var(--color-green-border)]",
  ADD:    "bg-[var(--color-green-bg)] text-[var(--color-green)] border border-[var(--color-green-border)]",
  HOLD:   "bg-[var(--color-amber-bg)] text-[var(--color-amber)] border border-[var(--color-amber-border)]",
  REDUCE: "bg-[var(--color-amber-bg)] text-[var(--color-amber)] border border-[var(--color-amber-border)]",
  SELL:   "bg-[var(--color-red-bg)] text-[var(--color-red)] border border-[var(--color-red-border)]",
  CLOSE:  "bg-[var(--color-red-bg)] text-[var(--color-red)] border border-[var(--color-red-border)]",
};

export function VerdictBadge({ verdict, size = "md" }: VerdictBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full font-bold",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        verdictStyles[verdict] ?? "bg-[var(--bg-surface)] text-[var(--text-tertiary)]"
      )}
    >
      {verdict}
    </span>
  );
}

interface ConfidenceBadgeProps {
  confidence: Confidence | string;
  size?: "sm" | "md";
}

const confidenceStyles: Record<string, string> = {
  high:   "text-[var(--color-green)]",
  medium: "text-[var(--color-amber)]",
  low:    "text-[var(--text-tertiary)]",
};

export function ConfidenceBadge({ confidence, size = "sm" }: ConfidenceBadgeProps) {
  const language = usePreferencesStore((s) => s.language);
  return (
    <span
      className={clsx(
        "font-medium",
        size === "sm" ? "text-[10px]" : "text-xs",
        confidenceStyles[confidence] ?? "text-[var(--text-tertiary)]"
      )}
    >
      {tConfidence(confidence, language)}
    </span>
  );
}
