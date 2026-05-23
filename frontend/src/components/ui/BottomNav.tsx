import { NavLink } from "react-router-dom";
import { TrendingUp, MessageCircle, FileText, BarChart2, Settings } from "lucide-react";
import { clsx } from "clsx";
import { t } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

const tabs = [
  { to: "/portfolio", icon: TrendingUp, labelKey: "portfolioTab" as const },
  { to: "/chat", icon: MessageCircle, labelKey: "chatTab" as const },
  { to: "/reports", icon: FileText, labelKey: "reportsTab" as const },
  { to: "/strategies", icon: BarChart2, labelKey: "strategiesTab" as const },
  { to: "/settings", icon: Settings, labelKey: "settingsTab" as const },
];

export function BottomNav() {
  const lang = usePreferencesStore((s) => s.language);
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--bg-border)] safe-bottom"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="flex h-14">
        {tabs.map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-120",
                isActive
                  ? "text-[var(--color-green)]"
                  : "text-[var(--text-tertiary)]"
              )
            }
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{t(labelKey, lang)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
