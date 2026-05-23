import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TickerSearch } from "../components/ui/TickerSearch";
import type { TickerSelection } from "../types/api";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { useToastStore } from "../store/toastStore";
import { usePreferencesStore } from "../store/preferencesStore";
import {
  completePositionGuidance,
  fetchOnboardStatus,
  fetchPositionGuidance,
  provisionAccount,
  startBootstrap,
  submitOnboardInit,
  submitPortfolio,
  type PositionEntry,
  type PortfolioPosition,
} from "../api/onboarding";
import { generateId } from "../utils/id";
import { apiClient } from "../api/client";
import { t } from "../store/i18n";

const EXCHANGES = [
  { value: "NYSE", label: "NYSE", currency: "USD" },
  { value: "NASDAQ", label: "NASDAQ", currency: "USD" },
  { value: "TASE", label: "TASE", currency: "ILA" },
  { value: "LSE", label: "LSE (London)", currency: "GBP" },
  { value: "XETRA", label: "XETRA (Germany)", currency: "EUR" },
  { value: "EURONEXT", label: "Euronext", currency: "EUR" },
  { value: "OTHER", label: "Other", currency: "USD" },
] as const;

type Currency = "USD" | "ILA" | "GBP" | "EUR";

const GUIDANCE_LIMITS = {
  thesis: 400,
  addOn: 300,
  reduceOn: 300,
  notes: 600,
} as const;

interface Account {
  id: string;
  name: string;
  positions: PositionEntry[];
}

interface GuidanceDraft {
  thesis: string;
  horizon: "unspecified" | "days" | "weeks" | "months" | "years";
  addOn: string;
  reduceOn: string;
  notes: string;
}

function createDefaultAccount(): Account {
  return {
    id: generateId(),
    name: "Main",
    positions: [],
  };
}

// Step numbering for new (unauthenticated) users: 1=account, 2=portfolio, 3=confirm, 4=guidance
// Step numbering for authenticated users: 1=password-change, 2=portfolio, 3=confirm, 4=guidance
interface OnboardingState {
  step: 1 | 2 | 3 | 4;
  adminKey: string;
  userId: string;
  password: string;
  confirmPassword: string;
  currentPassword: string;
  displayName: string;
  accounts: Account[];
  guidanceTickers: string[];
  positionGuidance: Record<string, GuidanceDraft>;
}

type StateUpdater<T> = T | ((prev: T) => T);
type UpdateOnboardingState = <K extends keyof OnboardingState>(
  key: K,
  value: StateUpdater<OnboardingState[K]>
) => void;

const initialState: OnboardingState = {
  step: 1,
  adminKey: "",
  userId: "",
  password: "",
  confirmPassword: "",
  currentPassword: "",
  displayName: "",
  accounts: [createDefaultAccount()],
  guidanceTickers: [],
  positionGuidance: {},
};

const inputCls = "w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] appearance-none";
const labelCls = "text-xs font-medium text-[var(--color-fg-muted)] mb-1.5 block";
const errorCls = "text-[10px] text-[var(--color-accent-red)] mt-1";

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            s < step ? "bg-[var(--color-accent-green)] text-white"
            : s === step ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
            : "border border-[var(--color-border)] text-[var(--color-fg-subtle)]"
          }`}>{s < step ? "✓" : s}</div>
          {s < total && <div className={`w-6 h-0.5 ${s < step ? "bg-[var(--color-accent-green)]" : "bg-[var(--color-border)]"}`} />}
        </div>
      ))}
    </div>
  );
}

function BottomBar({ onBack, onNext, nextLabel, nextDisabled = false, showBack = true }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean; showBack?: boolean;
}) {
  const language = usePreferencesStore((s) => s.language);
  return (
    <div className="px-5 py-4 flex gap-3 border-t border-[var(--color-border)]">
      {showBack ? (
        <button onClick={onBack} className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-bold text-[var(--color-fg-muted)]">{t("back", language)}</button>
      ) : <div className="flex-1" />}
      <button onClick={onNext} disabled={nextDisabled}
        className="flex-1 py-3 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-sm font-bold disabled:opacity-50">
        {nextLabel ?? t("next", language)}
      </button>
    </div>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 mb-2">
      <h2 className="text-base font-bold text-[var(--color-fg-default)]">{title}</h2>
      {subtitle && <p className="text-xs text-[var(--color-fg-muted)] mt-0.5">{subtitle}</p>}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return message ? <p className={errorCls}>{message}</p> : null;
}

// ---- Step 1: New User Account Setup ----
function Step1({ state, update, onNext }: { state: OnboardingState; update: UpdateOnboardingState; onNext: () => void }) {
  const language = usePreferencesStore((s) => s.language);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!state.adminKey.trim()) e.adminKey = t("onboardFieldRequired", language);
    if (!state.userId.trim()) e.userId = t("onboardFieldRequired", language);
    else if (!/^[a-zA-Z0-9-]{4,32}$/.test(state.userId)) e.userId = t("onboardUserIdError", language);
    if (!state.password) e.password = t("onboardFieldRequired", language);
    else if (state.password.length < 8) e.password = t("onboardPasswordError", language);
    if (state.password !== state.confirmPassword) e.confirmPassword = t("onboardPasswordMismatch", language);
    if (!state.displayName.trim()) e.displayName = t("onboardFieldRequired", language);
    return e;
  };

  const handleNext = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="px-5 space-y-5 flex-1 overflow-y-auto py-4">
        <StepTitle title={t("onboardStep1Title", language)} subtitle={t("onboardStep1Sub", language)} />
        <div>
          <label className={labelCls}>{t("onboardAdminKey", language)}</label>
          <input type="text" value={state.adminKey} onChange={(e) => update("adminKey", e.target.value)} placeholder={t("onboardAdminKey", language)} className={inputCls} />
          <FieldError message={errors.adminKey} />
        </div>
        <div>
          <label className={labelCls}>{t("onboardUserId", language)}</label>
          <input type="text" value={state.userId} onChange={(e) => update("userId", e.target.value.toLowerCase().replace(/[^a-zA-Z0-9-]/g, ""))} placeholder="john-doe" maxLength={32} className={inputCls} />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">{t("onboardUserIdHint", language)}</p>
          <FieldError message={errors.userId} />
        </div>
        <div>
          <label className={labelCls}>{t("onboardPassword", language)}</label>
          <input type="password" value={state.password} onChange={(e) => update("password", e.target.value)} placeholder={t("onboardPasswordHint", language)} className={inputCls} />
          <FieldError message={errors.password} />
        </div>
        <div>
          <label className={labelCls}>{t("onboardConfirmPassword", language)}</label>
          <input type="password" value={state.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} placeholder={t("onboardConfirmPassword", language)} className={inputCls} />
          <FieldError message={errors.confirmPassword} />
        </div>
        <div>
          <label className={labelCls}>{t("onboardDisplayName", language)}</label>
          <input type="text" value={state.displayName} onChange={(e) => update("displayName", e.target.value)} placeholder={t("onboardDisplayName", language)} className={inputCls} />
          <FieldError message={errors.displayName} />
        </div>
      </div>
      <BottomBar onNext={handleNext} showBack={false} />
    </div>
  );
}

// ---- Step 1: Authenticated User — Change Password ----
function AuthStep1({ state, update, onNext }: { state: OnboardingState; update: UpdateOnboardingState; onNext: () => void }) {
  const language = usePreferencesStore((s) => s.language);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!state.currentPassword) e.currentPassword = t("onboardFieldRequired", language);
    if (!state.password) e.password = t("onboardFieldRequired", language);
    else if (state.password.length < 8) e.password = t("onboardPasswordError", language);
    if (state.password !== state.confirmPassword) e.confirmPassword = t("onboardPasswordMismatch", language);
    return e;
  };

  const handleNext = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    setApiError("");
    try {
      await apiClient.post("/onboard/change-password", {
        currentPassword: state.currentPassword,
        newPassword: state.password,
      });
      onNext();
    } catch (err: unknown) {
      console.error("[Onboarding] change-password failed:", err);
      const axiosErr = err as { response?: { data?: { error?: string } } };
      if (axiosErr.response?.data?.error === "incorrect_password") {
        setApiError(t("onboardPasswordIncorrect", language));
      } else {
        setApiError(t("onboardPasswordChangeFailed", language));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="px-5 space-y-5 flex-1 overflow-y-auto py-4">
        <StepTitle title={t("onboardSetPasswordTitle", language)} subtitle={t("onboardSetPasswordSub", language)} />
        <div>
          <label className={labelCls}>{t("currentPassword", language)}</label>
          <input type="password" value={state.currentPassword} onChange={(e) => update("currentPassword", e.target.value)} placeholder={t("currentPassword", language)} className={inputCls} />
          <FieldError message={errors.currentPassword || apiError} />
        </div>
        <div>
          <label className={labelCls}>{t("newPassword", language)}</label>
          <input type="password" value={state.password} onChange={(e) => update("password", e.target.value)} placeholder={t("onboardPasswordHint", language)} className={inputCls} />
          <FieldError message={errors.password} />
        </div>
        <div>
          <label className={labelCls}>{t("onboardConfirmPassword", language)}</label>
          <input type="password" value={state.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} placeholder={t("onboardConfirmPassword", language)} className={inputCls} />
          <FieldError message={errors.confirmPassword} />
        </div>
      </div>
      <BottomBar
        onNext={handleNext}
        nextLabel={loading ? t("onboardConnecting", language) : t("onboardContinue", language)}
        nextDisabled={loading}
        showBack={false}
      />
    </div>
  );
}

void AuthStep1;

// ---- Position Card ----
function PositionCard({
  pos, idx, accountName, accounts, updateAccount, errors = {},
}: {
  pos: PositionEntry; idx: number; accountName: string;
  accounts: Account[];
  updateAccount: (id: string, updater: (account: Account) => Account) => void;
  errors?: Record<string, string>;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [tickerSelection, setTickerSelection] = useState<TickerSelection | null>(
    pos.ticker ? {
      symbol: pos.ticker,
      shortName: pos.ticker,
      exchange: pos.exchange as TickerSelection["exchange"],
      exchDisp: pos.exchange,
      flag: "",
      price: pos.avgPrice ? Number(pos.avgPrice) : null,
      currency: "USD",
      assetType: "stock",
    } : null
  );
  const updatePos = (patch: Partial<PositionEntry>) => {
    updateAccount(accountName, (account) => ({
      ...account,
      positions: account.positions.map((position, positionIdx) => {
        if (positionIdx !== idx) return position;
        const nextExchange = patch.exchange ?? position.exchange;
        const currency = EXCHANGES.find((entry) => entry.value === nextExchange)?.currency ?? position.currency;
        return { ...position, ...patch, currency: currency as Currency };
      }),
    }));
  };

  const removePos = () => {
    updateAccount(accountName, (account) => ({
      ...account,
      positions: account.positions.filter((_, positionIdx) => positionIdx !== idx),
    }));
  };

  const handleTickerChange = (val: TickerSelection | null) => {
    setTickerSelection(val);
    if (val) {
      updatePos({ ticker: val.symbol, exchange: val.exchange });
    } else {
      updatePos({ ticker: "", exchange: "NYSE", avgPrice: "" });
    }
  };

  return (
    <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-muted)] rounded-lg p-3 relative">
      <button onClick={removePos} className="absolute top-2 right-2 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-red)]">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>

      <div className="mb-2">
        <label className={labelCls}>{t("onboardTickerLabel", language)}</label>
        <TickerSearch value={tickerSelection} onChange={handleTickerChange} placeholder="AAPL" />
        {errors[`t_${accounts.findIndex((a) => a.id === accountName)}_${idx}`] && (
          <p className={errorCls}>{errors[`t_${accounts.findIndex((a) => a.id === accountName)}_${idx}`]}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>{t("onboardSharesLabel", language)}</label>
          <input type="number" value={pos.shares} onChange={(e) => updatePos({ shares: e.target.value })} min="1" step="1" placeholder="100" className={inputCls} />
          {errors[`s_${accounts.findIndex((a) => a.id === accountName)}_${idx}`] && (
            <p className={errorCls}>{errors[`s_${accounts.findIndex((a) => a.id === accountName)}_${idx}`]}</p>
          )}
        </div>
        <div>
          <label className={labelCls}>{t("onboardAvgPriceLabel", language)}</label>
          <input
            type="number"
            value={pos.avgPrice}
            onChange={(e) => updatePos({ avgPrice: e.target.value })}
            min="0.01"
            step="0.01"
            placeholder="100.00"
            className={inputCls}
            inputMode="decimal"
          />
          {errors[`p_${accounts.findIndex((a) => a.id === accountName)}_${idx}`] && (
            <p className={errorCls}>{errors[`p_${accounts.findIndex((a) => a.id === accountName)}_${idx}`]}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Account Section ----
function AccountSection({
  account, accounts, updateAccount, deleteAccount, showDelete, errors = {},
}: {
  account: Account; accounts: Account[];
  updateAccount: (id: string, updater: (account: Account) => Account) => void;
  deleteAccount: (id: string) => void;
  showDelete: boolean;
  errors?: Record<string, string>;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(account.name);

  const commitRename = () => {
    const trimmed = nameVal.trim() || t("onboardDefaultAccount", language);
    updateAccount(account.id, (currentAccount) => ({ ...currentAccount, name: trimmed }));
    setEditingName(false);
  };

  const addPosition = () => {
    const newPos: PositionEntry = {
      id: generateId(), ticker: "", exchange: "NYSE",
      shares: "", avgPrice: "", currency: "USD", account: account.name,
    };
    updateAccount(account.id, (currentAccount) => ({
      ...currentAccount,
      positions: [...currentAccount.positions, newPos],
    }));
  };

  const posCount = account.positions.length;
  const posLabel = posCount === 1 ? t("onboardPosition", language) : t("onboardPositions", language);

  return (
    <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-muted)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">📁</span>
          {editingName ? (
            <input
              type="text"
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setNameVal(account.name); setEditingName(false); }}}
              className="bg-[var(--color-bg-base)] border border-[var(--color-accent-blue)] rounded px-2 py-0.5 text-sm font-medium text-[var(--color-fg-default)] outline-none w-32"
              autoFocus
            />
          ) : (
            <span className="text-sm font-bold text-[var(--color-fg-default)] truncate">{account.name}</span>
          )}
          <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-base)] px-1.5 py-0.5 rounded">
            {posCount} {posLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEditingName(true)} className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          {showDelete && (
            <button onClick={() => deleteAccount(account.id)} className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-red)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          )}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {account.positions.map((pos, idx) => (
          <PositionCard key={pos.id} pos={pos} idx={idx} accountName={account.id} accounts={accounts} updateAccount={updateAccount} errors={errors} />
        ))}
        <button onClick={addPosition}
          className="w-full py-2 rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--text-secondary)] font-medium">
          {t("onboardAddPosition", language)}
        </button>
      </div>
    </div>
  );
}

// ---- Step 2: Portfolio Entry ----
function StepPortfolio({
  state, update, onBack, onNext,
}: {
  state: OnboardingState; update: UpdateOnboardingState;
  onBack?: () => void; onNext: () => void;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateAccount = (id: string, updater: (account: Account) => Account) => {
    update("accounts", (accounts) => accounts.map((account) => (
      account.id === id ? updater(account) : account
    )));
  };

  const deleteAccount = (id: string) => {
    if (state.accounts.length <= 1) return;
    update("accounts", (accounts) => accounts.filter((account) => account.id !== id));
  };

  const addAccount = () => {
    const existingNames = state.accounts.map((a) => a.name);
    let newName = t("onboardDefaultAccount", language);
    let n = 1;
    while (existingNames.includes(newName)) { newName = `${t("onboardDefaultAccount", language)} ${n++}`; }
    const acc: Account = { id: generateId(), name: newName, positions: [] };
    update("accounts", (accounts) => [...accounts, acc]);
  };

  const handleNext = () => {
    const e: Record<string, string> = {};
    let hasPositions = false;
    state.accounts.forEach((acc, ai) => {
      acc.positions.forEach((p, pi) => {
        if (!p.ticker.trim()) e[`t_${ai}_${pi}`] = t("onboardTickerRequired", language);
        if (!p.shares || Number(p.shares) < 1) e[`s_${ai}_${pi}`] = t("onboardSharesError", language);
        if (!p.avgPrice || Number(p.avgPrice) < 0.01) e[`p_${ai}_${pi}`] = t("onboardAvgPriceError", language);
        hasPositions = true;
      });
      const seen = new Map<string, number>();
      acc.positions.forEach((p, i) => {
        const key = p.ticker.toUpperCase();
        if (!key) return;
        if (seen.has(key)) { e[`t_${ai}_${seen.get(key)}`] = t("onboardDuplicateTicker", language); }
        else seen.set(key, i);
      });
    });
    if (!hasPositions) e.positions = t("onboardAddPositionError", language);
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="px-5 space-y-5 flex-1 overflow-y-auto py-4">
        <StepTitle title={t("onboardStep4Title", language)} subtitle={t("onboardStep4Sub", language)} />
        {errors.positions && <p className="text-[10px] text-[var(--color-accent-red)]">{errors.positions}</p>}
        {state.accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            accounts={state.accounts}
            updateAccount={updateAccount}
            deleteAccount={deleteAccount}
            showDelete={state.accounts.length > 1}
            errors={errors}
          />
        ))}
        <button onClick={addAccount}
          className="w-full py-3 rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--text-secondary)] font-medium">
          {t("onboardAddAccount", language)}
        </button>
      </div>
      <BottomBar onBack={onBack} onNext={handleNext} nextLabel={t("onboardReview", language)} showBack={!!onBack} />
    </div>
  );
}

// ---- Step 3: Confirm & Launch ----
function StepConfirm({ state }: { state: OnboardingState }) {
  const language = usePreferencesStore((s) => s.language);
  const totalPositions = state.accounts.reduce((sum, a) => sum + a.positions.length, 0);
  const posLabel = totalPositions === 1 ? t("onboardPosition", language) : t("onboardPositions", language);
  const accLabel = state.accounts.length === 1 ? t("onboardAccountSingular", language) : t("accounts", language).toLowerCase();

  return (
    <div className="px-5 space-y-5 flex-1 overflow-y-auto py-4">
      <StepTitle title={t("onboardStep5Title", language)} subtitle={t("onboardStep5Sub", language)} />
        <div className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          {state.userId && (
            <div>
              <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">{t("onboardReviewAccount", language)}</p>
              <p className="text-sm font-bold text-[var(--color-fg-default)]">{state.displayName || state.userId}</p>
              {state.userId && <p className="text-xs text-[var(--color-fg-muted)]">@{state.userId}</p>}
            </div>
          )}
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">{t("onboardReviewPortfolio", language)}</p>
            <p className="text-sm text-[var(--color-fg-default)]">
              {totalPositions} {posLabel} {t("onboardAcross", language)} {state.accounts.length} {accLabel}
            </p>
          </div>
          <div className="border-t border-[var(--color-border)] pt-3 space-y-4">
            {state.accounts.map((acc) => (
              <div key={acc.id}>
                <p className="text-xs font-medium text-[var(--color-fg-muted)] mb-2 flex items-center gap-1.5">
                  📁 {acc.name} <span className="text-[10px] opacity-60">({acc.positions.length} {acc.positions.length === 1 ? t("onboardPosition", language) : t("onboardPositions", language)})</span>
                </p>
                <div className="space-y-1.5">
                  {acc.positions.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--color-border-muted)] last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[var(--color-fg-default)]">{p.ticker || "—"}</span>
                        <span className="text-[var(--color-fg-subtle)]">{p.exchange}</span>
                      </div>
                      <span className="text-[var(--color-fg-muted)]">{p.shares || "—"} @ {p.avgPrice || "—"} {p.currency}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}

function GuidanceCard({
  ticker,
  guidance,
  updateGuidance,
}: {
  ticker: string;
  guidance: GuidanceDraft;
  updateGuidance: (ticker: string, patch: Partial<GuidanceDraft>) => void;
}) {
  const language = usePreferencesStore((s) => s.language);

  return (
    <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-[var(--color-fg-default)]">{ticker}</p>
        <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("onboardGuidanceOptional", language)}</p>
      </div>
      <div>
        <label className={labelCls}>{t("onboardGuidanceThesis", language)}</label>
        <textarea
          value={guidance.thesis}
          onChange={(e) => updateGuidance(ticker, { thesis: e.target.value })}
          maxLength={GUIDANCE_LIMITS.thesis}
          rows={3}
          className={inputCls}
          placeholder={t("onboardGuidanceThesisPlaceholder", language)}
        />
        <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
          {guidance.thesis.length}/{GUIDANCE_LIMITS.thesis}
        </p>
      </div>
      <div>
        <label className={labelCls}>{t("onboardGuidanceHorizon", language)}</label>
        <select
          value={guidance.horizon}
          onChange={(e) => updateGuidance(ticker, { horizon: e.target.value as GuidanceDraft["horizon"] })}
          className={inputCls}
        >
          <option value="unspecified">{t("onboardGuidanceHorizonUnspecified", language)}</option>
          <option value="days">{t("onboardGuidanceHorizonDays", language)}</option>
          <option value="weeks">{t("onboardGuidanceHorizonWeeks", language)}</option>
          <option value="months">{t("onboardGuidanceHorizonMonths", language)}</option>
          <option value="years">{t("onboardGuidanceHorizonYears", language)}</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("onboardGuidanceAdd", language)}</label>
        <textarea
          value={guidance.addOn}
          onChange={(e) => updateGuidance(ticker, { addOn: e.target.value })}
          maxLength={GUIDANCE_LIMITS.addOn}
          rows={2}
          className={inputCls}
          placeholder={t("onboardGuidanceAddPlaceholder", language)}
        />
        <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
          {guidance.addOn.length}/{GUIDANCE_LIMITS.addOn}
        </p>
      </div>
      <div>
        <label className={labelCls}>{t("onboardGuidanceReduce", language)}</label>
        <textarea
          value={guidance.reduceOn}
          onChange={(e) => updateGuidance(ticker, { reduceOn: e.target.value })}
          maxLength={GUIDANCE_LIMITS.reduceOn}
          rows={2}
          className={inputCls}
          placeholder={t("onboardGuidanceReducePlaceholder", language)}
        />
        <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
          {guidance.reduceOn.length}/{GUIDANCE_LIMITS.reduceOn}
        </p>
      </div>
      <div>
        <label className={labelCls}>{t("onboardGuidanceNotes", language)}</label>
        <textarea
          value={guidance.notes}
          onChange={(e) => updateGuidance(ticker, { notes: e.target.value })}
          maxLength={GUIDANCE_LIMITS.notes}
          rows={3}
          className={inputCls}
          placeholder={t("onboardGuidanceNotesPlaceholder", language)}
        />
        <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
          {guidance.notes.length}/{GUIDANCE_LIMITS.notes}
        </p>
      </div>
    </div>
  );
}

function StepGuidance({
  tickers,
  guidance,
  updateGuidance,
  onBack,
  onSkip,
  onLaunch,
  launchError,
}: {
  tickers: string[];
  guidance: Record<string, GuidanceDraft>;
  updateGuidance: (ticker: string, patch: Partial<GuidanceDraft>) => void;
  onBack: () => void;
  onSkip: () => void;
  onLaunch: () => void;
  launchError: string;
}) {
  const language = usePreferencesStore((s) => s.language);
  return (
    <div className="flex flex-col flex-1">
      <div className="px-5 space-y-5 flex-1 overflow-y-auto py-4">
        <StepTitle
          title={t("onboardStep6Title", language)}
          subtitle={t("onboardStep6Sub", language)}
        />
        <div className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg p-3 text-xs text-[var(--color-fg-muted)]">
          {t("onboardStep6Hint", language)}
        </div>
        {launchError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-xs text-[var(--color-accent-red)] font-medium">Launch failed</p>
            <p className="text-[11px] text-[var(--color-accent-red)] mt-1">{launchError}</p>
          </div>
        )}
        {tickers.map((ticker) => (
          <GuidanceCard
            key={ticker}
            ticker={ticker}
            guidance={guidance[ticker] ?? {
              thesis: "",
              horizon: "unspecified",
              addOn: "",
              reduceOn: "",
              notes: "",
            }}
            updateGuidance={updateGuidance}
          />
        ))}
      </div>
      <div className="px-5 py-4 flex gap-3 border-t border-[var(--color-border)]">
        <button onClick={onBack} className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-bold text-[var(--color-fg-muted)]">
          {t("back", language)}
        </button>
        <button onClick={onSkip} className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-bold text-[var(--color-fg-muted)]">
          {t("onboardSkip", language)}
        </button>
        <button
          onClick={onLaunch}
          className="flex-1 py-3 rounded-xl border border-black/10 bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-sm font-bold shadow-[0_4px_0_rgba(17,24,39,0.12)] transition-transform hover:-translate-y-0.5"
        >
          {t("onboardLaunchBtn", language)}
        </button>
      </div>
    </div>
  );
}

// ---- Main Component ----
export function Onboarding() {
  const { userId: clerkUserId } = useAuth();
  // Start optimistically as a new user (step 2 visible immediately).
  // The status check below updates this and may jump to step 4 or redirect.
  const [backendWorkspaceReady, setBackendWorkspaceReady] = useState<boolean | null>(false);
  const showToast = useToastStore((s) => s.show);
  const language = usePreferencesStore((s) => s.language);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Skip step 1 (account creation) for Clerk users — they're already authenticated.
  const [state, setState] = useState<OnboardingState>({
    ...initialState,
    step: 2,
    accounts: [createDefaultAccount()],
  });

  const [submittingPortfolio, setSubmittingPortfolio] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const launchingGuidanceRef = useRef(false);
  const [launchError, setLaunchError] = useState("");

  // On mount: check if backend workspace exists to determine new-user vs returning-user flow
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchOnboardStatus();
        if (cancelled) return;
        setBackendWorkspaceReady(true);
        if (status.portfolioLoaded && status.guidanceStepPending) {
          const guidanceData = await fetchPositionGuidance();
          if (cancelled) return;
          setState((current) => ({
            ...current,
            step: 4,
            guidanceTickers: guidanceData.tickers,
            positionGuidance: Object.fromEntries(
              Object.entries(guidanceData.guidance).map(([ticker, g]) => [ticker, { ...g }])
            ),
          }));
        } else if (status.portfolioLoaded) {
          // Already fully onboarded — redirect away
          navigate("/portfolio", { replace: true });
        }
        // else: workspace exists but portfolio not submitted yet — stay at step 2
      } catch {
        if (cancelled) return;
        // Error means no workspace yet — stay at step 2 as new user
        setBackendWorkspaceReady(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update: UpdateOnboardingState = (key, value) => {
    setState((current) => ({
      ...current,
      [key]: typeof value === "function"
        ? (value as (prev: OnboardingState[typeof key]) => OnboardingState[typeof key])(current[key])
        : value,
    }));
  };

  const buildGuidancePayload = () =>
    Object.fromEntries(
      Object.entries(state.positionGuidance).filter(([, guidance]) =>
        guidance.thesis.trim().length > 0 ||
        guidance.horizon !== "unspecified" ||
        guidance.addOn.trim().length > 0 ||
        guidance.reduceOn.trim().length > 0 ||
        guidance.notes.trim().length > 0
      )
    );

  const validateGuidancePayload = (): string | null => {
    for (const [ticker, guidance] of Object.entries(state.positionGuidance)) {
      if (guidance.thesis.length > GUIDANCE_LIMITS.thesis) return `${ticker}: thesis is too long`;
      if (guidance.addOn.length > GUIDANCE_LIMITS.addOn) return `${ticker}: add conditions are too long`;
      if (guidance.reduceOn.length > GUIDANCE_LIMITS.reduceOn) return `${ticker}: reduce conditions are too long`;
      if (guidance.notes.length > GUIDANCE_LIMITS.notes) return `${ticker}: notes are too long`;
    }
    return null;
  };

  const extractErrorMessage = (err: unknown): string => {
    const axiosErr = err as {
      response?: {
        data?: {
          error?: string;
          reason?: string;
          details?: Array<{ path?: Array<string | number>; message?: string }>;
        };
        status?: number;
      };
      message?: string;
    };
    const data = axiosErr.response?.data;
    if (data?.details?.[0]) {
      const detail = data.details[0];
      const path = Array.isArray(detail.path) && detail.path.length > 0 ? `${detail.path.join(".")}: ` : "";
      return `${path}${detail.message ?? "Validation error"}`;
    }
    if (data?.reason) return data.reason;
    if (data?.error) return data.error;
    if (axiosErr.response?.status === 503) return "Service unavailable — the analysis system is not configured yet. Contact your admin.";
    if (axiosErr.response?.status === 429) return "Rate limit exceeded — try again later.";
    if (axiosErr.response?.status === 409) return data?.error ?? "Conflict — this action cannot be performed right now.";
    if (axiosErr.message) return axiosErr.message;
    return "An unexpected error occurred. Please try again.";
  };

  const completeGuidanceAndLaunch = async (skip: boolean) => {
    if (launchingGuidanceRef.current) return;

    const guidanceError = skip ? null : validateGuidancePayload();
    if (guidanceError) {
      setLaunchError(guidanceError);
      return;
    }

    launchingGuidanceRef.current = true;
    setLaunchError("");
    try {
      const guidancePayload = skip ? {} : buildGuidancePayload();
      await completePositionGuidance({
        skip,
        guidance: guidancePayload,
      });
      const userId = clerkUserId?.trim();
      if (!userId) {
        throw new Error("Authenticated user ID is missing.");
      }
      const accountsPayload = buildAccountsPayload();
      if (Object.keys(accountsPayload).length === 0) {
        throw new Error("Please add at least one position before launching bootstrap.");
      }
      await startBootstrap({
        userId,
        displayName: state.displayName.trim() || undefined,
        accounts: accountsPayload,
        guidance: guidancePayload,
        schedule: defaultSchedule,
        currency: "ILS",
        transactionFeeILS: 0,
        note: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["onboard-status"] });
      await queryClient.refetchQueries({ queryKey: ["onboard-status"], type: "active" });
      navigate("/portfolio", { replace: true });
    } catch (err) {
      console.error("[Onboarding] position-guidance/complete failed:", err);
      const msg = extractErrorMessage(err);
      setLaunchError(msg);
    } finally {
      launchingGuidanceRef.current = false;
    }
  };

  const tickersForGuidance = Array.from(
    new Set([
      ...state.guidanceTickers,
      ...state.accounts.flatMap((account) =>
        account.positions.map((position) => position.ticker).filter((ticker) => ticker.trim().length > 0)
      ),
    ])
  );

  const updateGuidance = (ticker: string, patch: Partial<GuidanceDraft>) => {
    setState((current) => ({
      ...current,
      positionGuidance: {
        ...current.positionGuidance,
        [ticker]: {
          ...(current.positionGuidance[ticker] ?? {
            thesis: "",
            horizon: "unspecified",
            addOn: "",
            reduceOn: "",
            notes: "",
          }),
          ...patch,
        },
      },
    }));
  };

  const ensureOneAccount = (s: OnboardingState): OnboardingState => {
    if (s.accounts.length === 0) {
      return { ...s, accounts: [createDefaultAccount()] };
    }
    return s;
  };

  const defaultSchedule = {
    dailyBriefTime: "08:00",
    weeklyResearchDay: "sunday",
    weeklyResearchTime: "19:00",
    timezone: "Asia/Jerusalem",
  };

  const buildAccountsPayload = (): Record<string, PortfolioPosition[]> => {
    const accountsPayload: Record<string, PortfolioPosition[]> = {};
    for (const acc of state.accounts) {
      const positions = acc.positions.filter((p) => p.ticker.trim().length > 0);
      if (positions.length === 0) continue;
      accountsPayload[acc.name] = positions.map((p) => ({
        ticker: p.ticker.trim().toUpperCase(),
        exchange: p.exchange,
        shares: Math.max(1, Math.round(Number(p.shares))),
        unitAvgBuyPrice: Number(p.avgPrice),
        unitCurrency: p.currency,
      }));
    }
    return accountsPayload;
  };

  // handleSubmit: called from the Confirm step to finalize portfolio and launch
  const handleSubmit = async () => {
    if (submittingPortfolio) return;
    setSubmittingPortfolio(true);
    setSubmitError("");

    try {
      const accountsPayload = buildAccountsPayload();

      if (Object.keys(accountsPayload).length === 0) {
        throw new Error("Please add at least one position before continuing.");
      }

      if (!backendWorkspaceReady) {
        // New user: provision Postgres workspace (Clerk) or admin-init (legacy).
        if (clerkUserId) {
          await provisionAccount(state.displayName.trim() || undefined);
        } else {
          const initPayload = {
            userId: state.userId,
            displayName: state.displayName,
            telegramChatId: "",
            schedule: defaultSchedule,
          };
          await submitOnboardInit(initPayload, state.adminKey);
        }
      }
      await submitPortfolio({
        meta: { currency: "ILS", transactionFeeILS: 0, note: "" },
        accounts: accountsPayload,
        schedule: defaultSchedule,
      });

      // Advance to guidance step
      setState((current) => ({
        ...current,
        step: 4,
        guidanceTickers: Array.from(
          new Set(
            current.accounts.flatMap((account) =>
              account.positions.map((position) => position.ticker).filter((ticker) => ticker.trim().length > 0)
            )
          )
        ),
      }));
    } catch (err) {
      console.error("[Onboarding] handleSubmit failed:", err);
      const msg = extractErrorMessage(err);
      setSubmitError(msg);
      showToast(msg, "error");
    } finally {
      setSubmittingPortfolio(false);
    }
  };

  // Total steps: 3 for new users (account → portfolio → confirm), then guidance step
  // For authenticated users: 2 steps (password → portfolio → confirm), then guidance
  // We show 3 dots for all (password-change, portfolio, confirm) and add a 4th if guidance
  const isNewUser = backendWorkspaceReady === false;
  const totalSteps = state.step === 4 ? 4 : 3;

  return (
    <div className="bg-[var(--color-bg-base)] min-h-screen flex flex-col">
      <div className="safe-top" />
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col">
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 4 }}>
          <img
            src="/startix-mark-64.png"
            alt="Startix"
            width={40}
            height={40}
            style={{ borderRadius: 10 }}
          />
        </div>
        <ProgressDots step={state.step} total={totalSteps} />
        <div className="flex-1 flex flex-col">
        {/* Step 1: Account setup — only shown for new users (no backend workspace yet) */}
        {state.step === 1 && isNewUser && (
          <Step1 state={state} update={update} onNext={() => update("step", 2)} />
        )}

        {/* Step 2: Portfolio entry */}
        {state.step === 2 && (
          <StepPortfolio
            state={ensureOneAccount(state)}
            update={update}
            onBack={() => update("step", 1)}
            onNext={() => update("step", 3)}
          />
        )}

        {/* Step 3: Confirm & Launch */}
        {state.step === 3 && (
          <div className="flex flex-col flex-1">
            <StepConfirm state={state} />
            {submitError && (
              <div className="px-5 pb-2">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-xs text-[var(--color-accent-red)] font-medium">Setup failed</p>
                  <p className="text-[11px] text-[var(--color-accent-red)] mt-1">{submitError}</p>
                </div>
              </div>
            )}
            <BottomBar
              onBack={() => update("step", 2)}
              onNext={handleSubmit}
              nextLabel={submittingPortfolio ? t("onboardLaunching", language) : t("onboardContinue", language)}
              nextDisabled={submittingPortfolio}
              showBack={true}
            />
          </div>
        )}

        {/* Step 4: Position Guidance */}
        {state.step === 4 && (
          <StepGuidance
            tickers={tickersForGuidance}
            guidance={state.positionGuidance}
            updateGuidance={updateGuidance}
            onBack={() => update("step", 3)}
            onSkip={() => void completeGuidanceAndLaunch(true)}
            onLaunch={() => void completeGuidanceAndLaunch(false)}
            launchError={launchError}
          />
        )}
        </div>
      </div>
    </div>
  );
}
