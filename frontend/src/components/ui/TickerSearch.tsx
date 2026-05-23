import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { searchTicker } from "../../api/search";
import type { TickerSelection, Exchange, AssetType } from "../../types/api";
import { ContactAdminButton } from "../support/ContactAdminButton";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t } from "../../store/i18n";

interface TickerSearchProps {
  value: TickerSelection | null;
  onChange: (val: TickerSelection | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

function formatPrice(price: number | null, exchange: Exchange): string | null {
  if (price === null) return null;
  const sym =
    exchange === "TASE" ? "₪" :
    exchange === "LSE" ? "£" :
    (exchange === "XETRA" || exchange === "EURONEXT") ? "€" : "$";
  return `${sym}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: "Stock",
  etf: "ETF",
  crypto: "Crypto",
  fund: "Fund",
  bond: "Bond",
  index: "Index",
  other: "Asset",
};

export function TickerSearch({ value, onChange, placeholder = "Search ticker…", disabled }: TickerSearchProps) {
  const language = usePreferencesStore((s) => s.language);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Compute & track dropdown position using a fixed portal so it escapes overflow containers
  useEffect(() => {
    if (!open || !containerRef.current) {
      setDropdownStyle(null);
      return;
    }
    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  // Click-outside: check both the input container and the portal dropdown
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target) ?? false;
      const inDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!inContainer && !inDropdown) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["ticker-search", debouncedQuery],
    queryFn: () => searchTicker(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const results = data?.results ?? [];
  const searchError = data?.error ?? null;

  const handleQueryChange = (nextQuery: string) => {
    const normalizedQuery = nextQuery.toUpperCase();
    setQuery(normalizedQuery);
    setHighlightIdx(-1);
    setOpen(normalizedQuery.length >= 2);
  };

  const handleSelect = useCallback((result: TickerSelection) => {
    onChange(result);
    setQuery("");
    setDebouncedQuery("");
    setOpen(false);
    setHighlightIdx(-1);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && highlightIdx >= 0 && results[highlightIdx]) {
      e.preventDefault();
      handleSelect(results[highlightIdx]!);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setDebouncedQuery("");
    }
  };

  // ── Selected pill ──────────────────────────────────────────────────────────
  if (value) {
    const priceStr = formatPrice(value.price, value.exchange);
    return (
      <div className="flex items-center gap-3 bg-[var(--color-bg-muted)] border border-[var(--color-accent-blue)] rounded-xl p-3">
        <span className="text-2xl leading-none">{value.flag}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-base font-extrabold text-[var(--color-fg-default)] leading-tight">{value.symbol}</div>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)]">
              {ASSET_TYPE_LABELS[value.assetType]}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-[var(--color-fg-muted)]">{value.exchDisp}</span>
            {priceStr && (
              <span className="text-xs font-bold text-[var(--color-accent-green)]">{priceStr}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="text-xs text-[var(--color-accent-blue)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-40"
        >
          Change ↩
        </button>
      </div>
    );
  }

  // ── Search input + portal dropdown ─────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] pointer-events-none select-none">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (debouncedQuery.length >= 2) setOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl pl-9 pr-8 py-2.5 font-mono font-bold text-[var(--color-fg-default)] outline-none disabled:opacity-40"
          style={{ fontSize: "16px" }}
        />
        {isFetching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] text-xs animate-spin select-none">⏳</span>
        )}
      </div>

      {open && dropdownStyle && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          style={{ position: "fixed", top: dropdownStyle.top, left: dropdownStyle.left, width: dropdownStyle.width, zIndex: 9999 }}
          className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-muted)] shadow-[0_16px_48px_rgba(0,0,0,0.65)] max-h-72 overflow-y-auto overscroll-contain"
        >
          {results.length > 0 ? (
            results.map((r, i) => {
              const priceStr = formatPrice(r.price, r.exchange);
              return (
                <button
                  key={`${r.symbol}-${r.exchange}`}
                  type="button"
                  role="option"
                  aria-selected={i === highlightIdx}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors min-h-[52px] ${
                    i < results.length - 1 ? "border-b border-[var(--color-border)]" : ""
                  } ${i === highlightIdx ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"}`}
                >
                  <span className="text-xl leading-none flex-shrink-0">{r.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-bold text-[var(--color-fg-default)]">{r.symbol}</div>
                      <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-fg-subtle)]">
                        {ASSET_TYPE_LABELS[r.assetType]}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-fg-muted)] truncate">{r.shortName}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[10px] text-[var(--color-fg-subtle)]">{r.exchDisp}</div>
                    {priceStr && (
                      <div className="text-xs font-bold text-[var(--color-accent-green)]">{priceStr}</div>
                    )}
                  </div>
                </button>
              );
            })
          ) : isFetching ? (
            <div className="px-3 py-3 text-xs text-[var(--color-fg-muted)]">
              {t("searchLoading", language)}
            </div>
          ) : !isFetching && searchError ? (
            <div className="space-y-2 px-3 py-3">
              <div className="text-xs text-[var(--color-accent-red)]">
                {t("searchUnexpectedError", language)}
              </div>
              <div className="text-[11px] text-[var(--color-fg-muted)]">
                {t("searchUnexpectedErrorHelp", language)}
              </div>
              <ContactAdminButton
                source="ticker-search"
                defaultSubject={`Search issue: ${debouncedQuery}`}
                variant="inline"
                className="mt-1"
              />
            </div>
          ) : (
            <div className="px-3 py-3 text-xs text-[var(--color-fg-muted)]">
              {t("searchNoResults", language)} &ldquo;{debouncedQuery}&rdquo;
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
