import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPortfolio, fetchVerdicts, addPosition } from "../../api/portfolio";
import { triggerJob } from "../../api/jobs";
import { TickerSearch } from "../ui/TickerSearch";
import { useToastStore } from "../../store/toastStore";
import type { TickerSelection, PositionRow } from "../../types/api";

type UnitCurrency = "USD" | "ILA" | "GBP" | "EUR";

function getUnitCurrency(exchange: string): UnitCurrency {
  if (exchange === "TASE") return "ILA";
  if (exchange === "LSE") return "GBP";
  if (exchange === "XETRA" || exchange === "EURONEXT") return "EUR";
  return "USD";
}

function getCurrencyLabel(exchange: string): string {
  if (exchange === "TASE") return "ILA (agorot)";
  if (exchange === "LSE") return "GBP";
  if (exchange === "XETRA" || exchange === "EURONEXT") return "EUR";
  return "USD";
}

const EMPTY_ACCOUNTS: string[] = [];

interface AddPositionModalProps {
  open: boolean;
  onClose: () => void;
  onEditExisting: (ticker: string) => void;
  preferredAccount?: string | null;
}

export function AddPositionModal({ open, onClose, onEditExisting, preferredAccount }: AddPositionModalProps) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const [selected, setSelected] = useState<TickerSelection | null>(null);
  const [account, setAccount] = useState("");
  const [shares, setShares] = useState("");
  const [avgBuyPrice, setAvgBuyPrice] = useState("");
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    staleTime: 60_000,
  });

  const { data: verdictsData } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    staleTime: 60_000,
  });

  const accounts = portfolio?.accounts ?? EMPTY_ACCOUNTS;

  // Clash: positions that already hold this ticker
  const clashPositions: PositionRow[] = useMemo(() => {
    if (!selected || !portfolio) return [];
    return portfolio.positions.filter((p) => p.ticker === selected.symbol);
  }, [selected, portfolio]);

  const clashAccounts = useMemo(
    () => clashPositions.flatMap((p) => p.accounts),
    [clashPositions]
  );

  const hasClash = clashPositions.length > 0 && !force;

  // Accounts that don't already hold this ticker
  const cleanAccounts = useMemo(
    () => accounts.filter((a) => !clashAccounts.includes(a)),
    [accounts, clashAccounts]
  );

  const needsDeepDive = useMemo(() => {
    if (!selected || !verdictsData) return false;
    return !verdictsData.verdicts.find((v) => v.ticker === selected.symbol);
  }, [selected, verdictsData]);

  // Default account on selection
  useEffect(() => {
    if (selected && accounts.length > 0) {
      const preferred = preferredAccount && accounts.includes(preferredAccount)
        ? preferredAccount
        : null;
      const firstClean = preferred ?? cleanAccounts[0] ?? accounts[0] ?? "";
      setAccount(firstClean);
    }
  }, [selected, accounts, cleanAccounts, preferredAccount]);

  const handleClose = () => {
    setSelected(null);
    setAccount("");
    setShares("");
    setAvgBuyPrice("");
    setForce(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selected || !account || !shares || !avgBuyPrice) return;
    const sharesNum = parseInt(shares, 10);
    const priceNum = parseFloat(avgBuyPrice);
    if (isNaN(sharesNum) || sharesNum <= 0 || isNaN(priceNum) || priceNum <= 0) return;

    setSubmitting(true);
    try {
      await addPosition({
        ticker: selected.symbol,
        exchange: selected.exchange,
        shares: sharesNum,
        unitAvgBuyPrice: priceNum,
        unitCurrency: getUnitCurrency(selected.exchange),
        account,
        force,
      });

      if (needsDeepDive) {
        try {
          await triggerJob("deep_dive", selected.symbol);
          await queryClient.invalidateQueries({ queryKey: ["balance"] });
          showToast("Position added — deep dive queued", "success");
        } catch (err: unknown) {
          const axiosErr = err as { response?: { status?: number; data?: { reason?: string } } };
          const reason = axiosErr.response?.data?.reason;
          if (axiosErr.response?.status === 429 && reason) {
            showToast(`Position added — ${reason}`, "warning");
          } else {
            showToast("Position added", "success");
          }
        }
      } else {
        showToast("Position added", "success");
      }

      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      handleClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const errMsg = axiosErr.response?.data?.error;
      if (errMsg === "account_not_found") {
        showToast("Account not found", "error");
      } else {
        showToast("Failed to add position", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const canSubmit = !!selected && !!account && !!shares && !!avgBuyPrice && !hasClash && !submitting;
  const currencyLabel = selected ? getCurrencyLabel(selected.exchange) : "USD";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Sheet: bottom on mobile, centered on sm+ */}
      <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center">
        <div
          className="bg-[var(--color-bg-base)] rounded-t-2xl sm:rounded-2xl sm:max-w-md sm:w-full w-full max-h-[90vh] overflow-y-auto"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-bold text-[var(--color-fg-default)]">Add Position</h2>
            <button
              type="button"
              onClick={handleClose}
              className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)] text-xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-4 space-y-4">
            {/* Ticker search */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                Search Asset
              </label>
              <TickerSearch
                value={selected}
                onChange={(val) => {
                  setSelected(val);
                  setForce(false);
                }}
              />
            </div>

            {/* Clash warning */}
            {selected && hasClash && (
              <div className="bg-[var(--color-accent-red)]/10 border border-[var(--color-accent-red)]/30 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-[var(--color-accent-red)]">
                  ⚠️ Already in your portfolio
                </p>
                <p className="text-[10px] text-[var(--color-fg-muted)]">
                  {clashPositions.map((p) =>
                    `${p.accounts.join(", ")} · ${p.shares} shares`
                  ).join(" | ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {cleanAccounts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setForce(true); setAccount(cleanAccounts[0]!); }}
                      className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-fg-default)]"
                    >
                      Add to different account
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setForce(true)}
                    className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-fg-default)]"
                  >
                    Add anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => { onEditExisting(selected.symbol); handleClose(); }}
                    className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-accent-blue)]"
                  >
                    Edit existing
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-fg-muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Form fields — visible once ticker is selected and clash resolved */}
            {selected && !hasClash && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                      Account
                    </label>
                    <select
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl px-3 py-2.5 text-xs text-[var(--color-fg-default)] outline-none"
                    >
                      {accounts.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                      Shares
                    </label>
                    <input
                      type="number"
                      value={shares}
                      onChange={(e) => setShares(e.target.value)}
                      min="1"
                      step="1"
                      placeholder="100"
                      className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl px-3 py-2.5 text-xs text-[var(--color-fg-default)] outline-none"
                      style={{ fontSize: "16px" }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                    Avg Buy Price ({currencyLabel})
                  </label>
                  <input
                    type="number"
                    value={avgBuyPrice}
                    onChange={(e) => setAvgBuyPrice(e.target.value)}
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl px-3 py-2.5 text-xs text-[var(--color-fg-default)] outline-none"
                    style={{ fontSize: "16px" }}
                  />
                </div>

                {/* Deep dive notice */}
                {needsDeepDive && (
                  <div className="flex gap-2 items-start bg-[var(--color-accent-blue)]/10 border border-[var(--color-accent-blue)]/30 rounded-xl px-3 py-2.5">
                    <span className="text-sm flex-shrink-0">🔬</span>
                    <p className="text-[10px] text-[var(--color-accent-blue)]">
                      No analysis found for {selected.symbol} — a deep dive will be queued automatically when you save.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 px-4 py-3 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-xs text-[var(--color-fg-muted)] bg-[var(--color-bg-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold disabled:opacity-40"
            >
              {submitting ? "Adding…" : "Add Position"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
