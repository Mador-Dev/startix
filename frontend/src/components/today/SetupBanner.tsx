import { Loader2 } from "lucide-react";
import { t, tInterpolate } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface SetupBannerProps {
  analyzed: number;
  total: number;
  inProgressTickers: string[];
  telegramConnected: boolean;
}

export function SetupBanner({
  analyzed,
  total,
  inProgressTickers,
  telegramConnected,
}: SetupBannerProps) {
  const language = usePreferencesStore((s) => s.language);

  const body = telegramConnected
    ? t("setupBannerBodyTelegram", language)
    : t("setupBannerBodyChannelAgnostic", language);

  const progress =
    total > 0
      ? tInterpolate(t("setupBannerProgress", language), { analyzed, total })
      : null;

  const inProgress =
    inProgressTickers.length > 0
      ? tInterpolate(t("setupBannerInProgress", language), {
          tickers: inProgressTickers.slice(0, 3).join(", "),
        })
      : null;

  return (
    <div
      style={{
        margin: "12px 16px 4px",
        padding: "12px 16px",
        borderRadius: 12,
        border: "0.5px solid var(--color-info-border)",
        background: "var(--color-info-tint)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Loader2
          size={15}
          className="animate-spin"
          style={{ color: "var(--color-info)", flexShrink: 0 }}
        />
        <h2
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          {t("setupBannerTitle", language)}
        </h2>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {body}
      </p>
      {(progress || inProgress) && (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {progress}
          {progress && inProgress ? <> · {inProgress}</> : inProgress}
        </p>
      )}
    </div>
  );
}
