import { useState } from "react";
import type { PositionRow, ClosedPositionRecord } from "../../types/api";
import { formatILS, formatPct } from "../../utils/format";

const EXIT_REASONS = [
  "Target reached",
  "Stop loss hit",
  "Thesis invalidated",
  "Rebalancing",
  "Other",
] as const;

type ExitReason = typeof EXIT_REASONS[number];

interface Props {
  position: PositionRow;
  onCancel: () => void;
  onConfirm: (record: Omit<ClosedPositionRecord, "ticker" | "closedAt">) => Promise<void>;
}

export function ClosePositionModal({ position, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState<ExitReason | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const plPositive = position.plPct >= 0;

  const handleConfirm = async () => {
    if (!reason) return;
    setSubmitting(true);
    try {
      await onConfirm({
        exitReason: reason,
        exitNote: note.trim(),
        finalPlPct: position.plPct,
        finalPlILS: position.plILS,
        shares: position.shares,
        avgPriceILS: position.avgPriceILS,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="fixed inset-x-0 bottom-0 z-[70] sm:inset-0 sm:flex sm:items-center sm:justify-center">
        <div
          className="w-full bg-[var(--color-bg-base)] rounded-t-2xl sm:rounded-2xl sm:max-w-md sm:w-full max-h-[90vh] overflow-y-auto"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div>
              <h2 className="text-sm font-bold text-[var(--color-fg-default)]">
                Close position — {position.ticker}
              </h2>
              <p className="text-[11px] text-[var(--color-fg-subtle)]">
                This removes the position and saves it to your history.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)] text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* P/L summary */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)] mb-1">
                Final result
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-xl font-bold tabular-nums"
                  style={{ color: plPositive ? "var(--color-green)" : "var(--color-red)" }}
                >
                  {plPositive ? "+" : ""}
                  {formatPct(position.plPct)}
                </span>
                <span
                  className="text-sm tabular-nums"
                  style={{ color: plPositive ? "var(--color-green)" : "var(--color-red)" }}
                >
                  {plPositive ? "+" : ""}
                  {formatILS(Math.abs(position.plILS))}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
                {position.shares} shares · avg {formatILS(position.avgPriceILS)} / share
              </p>
            </div>

            {/* Exit reason */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)] mb-2">
                Why are you closing?
              </p>
              <div className="space-y-1.5">
                {EXIT_REASONS.map((r) => (
                  <label
                    key={r}
                    className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-3 py-2.5 cursor-pointer transition-colors"
                    style={{
                      background: reason === r ? "rgba(99,102,241,0.08)" : "var(--color-bg-muted)",
                      borderColor: reason === r ? "rgba(99,102,241,0.35)" : undefined,
                    }}
                  >
                    <input
                      type="radio"
                      name="close-reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="accent-indigo-500"
                    />
                    <span className="text-sm text-[var(--color-fg-default)]">{r}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Optional note */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)] mb-1.5">
                What did you learn? (optional)
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Any lessons, what worked, what didn't..."
                rows={2}
                maxLength={400}
                className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-fg-default)] outline-none resize-none focus:border-indigo-500/50"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 px-4 py-3 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-fg-muted)] bg-[var(--color-bg-muted)]"
            >
              Keep holding
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!reason || submitting}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-colors"
              style={{
                background: reason ? "rgba(226,80,80,0.15)" : undefined,
                border: "0.5px solid rgba(226,80,80,0.35)",
                color: "var(--color-red)",
              }}
            >
              {submitting ? "Closing…" : "Close position"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
