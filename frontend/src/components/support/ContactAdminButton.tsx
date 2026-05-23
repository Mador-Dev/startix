import { useMemo, useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { submitSupportMessage } from "../../api/support";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t } from "../../store/i18n";
import { useToastStore } from "../../store/toastStore";

interface ContactAdminButtonProps {
  source?: string;
  defaultSubject?: string;
  label?: string;
  variant?: "icon" | "inline";
  className?: string;
}

export function ContactAdminButton({
  source = "ui",
  defaultSubject,
  label,
  variant = "icon",
  className = "",
}: ContactAdminButtonProps) {
  const language = usePreferencesStore((s) => s.language);
  const showToast = useToastStore((s) => s.show);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const computedLabel = label ?? t("contactAdmin", language);
  const page = useMemo(() => location.pathname, [location.pathname]);
  const isHebrew = language === "he";

  const resetAndClose = () => {
    setOpen(false);
    setSubject(defaultSubject ?? "");
    setMessage("");
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim() || submitting) return;
    setSubmitting(true);
    try {
      await submitSupportMessage({
        subject: subject.trim(),
        message: message.trim(),
        source,
        page,
      });
      showToast(t("contactAdminSent", language), "success");
      resetAndClose();
    } catch {
      showToast(t("contactAdminFailed", language), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === "icon"
            ? `inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-2 text-[var(--color-fg-muted)] active:bg-[var(--color-bg-base)] ${className}`.trim()
            : `inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-xs font-bold text-[var(--color-fg-default)] active:bg-[var(--color-bg-base)] ${className}`.trim()
        }
        aria-label={computedLabel}
      >
        <LifeBuoy size={variant === "icon" ? 16 : 14} />
        {variant === "inline" && <span>{computedLabel}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={resetAndClose} />
          <div className="relative z-10 flex w-full max-h-[90vh] flex-col rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-bg-base)] sm:w-full sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--color-fg-default)]">{t("contactAdminTitle", language)}</h2>
                <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{t("contactAdminSubtitle", language)}</p>
              </div>
              <button
                type="button"
                onClick={resetAndClose}
                className="text-xl leading-none text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {t("contactAdminSubject", language)}
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={120}
                  placeholder={t("contactAdminSubjectPlaceholder", language)}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2.5 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {t("contactAdminMessage", language)}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={4000}
                  rows={5}
                  placeholder={t("contactAdminMessagePlaceholder", language)}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2.5 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                />
                <p className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">
                  {t("contactAdminContext", language)}: {page}
                </p>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3">
              <button
                type="button"
                onClick={resetAndClose}
                className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-bold text-[var(--color-fg-muted)]"
              >
                {t("cancel", language)}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!subject.trim() || !message.trim() || submitting}
                className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2 text-xs font-bold text-[var(--color-primary-fg)] disabled:opacity-50"
              >
                {isHebrew ? (submitting ? t("sending", language) : t("sendMessage", language)) : <Send size={13} />}
                {isHebrew ? null : (submitting ? t("sending", language) : t("sendMessage", language))}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
