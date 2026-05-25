import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { HealthScoreBreakdown } from "../../types/api";

interface Props {
  breakdown: HealthScoreBreakdown;
  score: number;
}

const COMPONENTS = [
  { key: "freshness" as const, label: "Analysis freshness", max: 25, tip: "Full credit if deep dive < 14 days ago" },
  { key: "catalyst" as const, label: "Catalyst coverage", max: 25, tip: "Active catalyst 14–90 days out" },
  { key: "exit" as const, label: "P/L cushion", max: 20, tip: "Distance from stop-loss threshold" },
  { key: "confidence" as const, label: "AI confidence", max: 15, tip: "High / medium / low AI confidence" },
  { key: "dayMove" as const, label: "Daily stability", max: 15, tip: "Lower if large intraday move today" },
] as const;

function barColor(pct: number): string {
  if (pct >= 0.75) return "var(--color-green)";
  if (pct >= 0.4) return "var(--color-amber)";
  return "var(--color-red)";
}

export function ScoreBreakdown({ breakdown, score }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ padding: "0 16px 12px" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
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
          Score breakdown
        </span>
        {open ? (
          <ChevronUp size={10} color="var(--text-tertiary)" />
        ) : (
          <ChevronDown size={10} color="var(--text-tertiary)" />
        )}
      </button>

      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {COMPONENTS.map(({ key, label, max }) => {
            const value = breakdown[key];
            const pct = max > 0 ? value / max : 0;
            const color = barColor(pct);
            return (
              <div key={key}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-secondary)" }}>{label}</span>
                  <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                    {value}/{max}
                  </span>
                </div>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: "var(--bg-border)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round(pct * 100)}%`,
                      borderRadius: 2,
                      background: color,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: 2,
              fontSize: "var(--text-2xs)",
              color: "var(--text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Total: {score}/100
          </div>
        </div>
      )}
    </div>
  );
}
