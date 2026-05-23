import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/react";
import { useToastStore } from "../store/toastStore";
import { usePreferencesStore, type Theme } from "../store/preferencesStore";
import { t, type TranslationKey } from "../store/i18n";
import { apiClient } from "../api/client";
import {
  connectTelegram,
  disconnectTelegram,
  fetchOnboardStatus,
} from "../api/onboarding";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "../components/ui/Card";
import { User, Lock, Clock, Bot, LogOut, ChevronRight, ChevronDown, X, Sun, Moon, Monitor, Bell } from "lucide-react";
import type { NotificationPreferences } from "../types/api";
import { AnalystPipelineConfig } from "../components/AnalystPipelineConfig";

const DAY_KEYS: Array<{ value: string; key: TranslationKey }> = [
  { value: "sunday", key: "daySunday" },
  { value: "monday", key: "dayMonday" },
  { value: "tuesday", key: "dayTuesday" },
  { value: "wednesday", key: "dayWednesday" },
  { value: "thursday", key: "dayThursday" },
  { value: "friday", key: "dayFriday" },
  { value: "saturday", key: "daySaturday" },
];

const TIMEZONES = [
  { value: "Asia/Jerusalem", label: "Asia/Jerusalem (UTC+3)" },
  { value: "America/New_York", label: "America/New_York (UTC-5)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8)" },
  { value: "America/Chicago", label: "America/Chicago (UTC-6)" },
  { value: "Europe/London", label: "Europe/London (UTC+0)" },
  { value: "Europe/Paris", label: "Europe/Paris (UTC+1)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+8)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (UTC+11)" },
];

const inputCls = "w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] appearance-none";
const labelCls = "text-xs font-medium text-[var(--color-fg-muted)] mb-1.5 block";
const guideItemCls = "text-xs leading-5 text-[var(--color-fg-muted)]";

const defaultPilotNotifications: NotificationPreferences = {
  primaryChannel: "telegram",
  enabledChannels: {
    telegram: true,
    web: true,
    whatsapp: false,
  },
  categories: {
    dailyBriefs: true,
    reportRuns: true,
    marketNews: true,
  },
};

const sanitizePilotNotifications = (preferences?: NotificationPreferences): NotificationPreferences => ({
  primaryChannel: preferences?.primaryChannel === "whatsapp" ? "web" : preferences?.primaryChannel ?? defaultPilotNotifications.primaryChannel,
  enabledChannels: {
    telegram: preferences?.enabledChannels.telegram ?? defaultPilotNotifications.enabledChannels.telegram,
    web: preferences?.enabledChannels.web ?? defaultPilotNotifications.enabledChannels.web,
    whatsapp: false,
  },
  categories: preferences?.categories ?? defaultPilotNotifications.categories,
});

export function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const showToast = useToastStore((s) => s.show);
  const lang = usePreferencesStore((s) => s.language);
  const currentTheme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);

  const { data: onboardStatus, refetch: refetchOnboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  // Display name edit
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [displayNameLoading, setDisplayNameLoading] = useState(false);

  // Change password form
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Schedule form
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedule, setSchedule] = useState({
    dailyBriefTime: onboardStatus?.schedule?.dailyBriefTime ?? "08:00",
    weeklyResearchDay: onboardStatus?.schedule?.weeklyResearchDay ?? "sunday",
    weeklyResearchTime: onboardStatus?.schedule?.weeklyResearchTime ?? "19:00",
    timezone: onboardStatus?.schedule?.timezone ?? "Asia/Jerusalem",
  });
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Telegram form
  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPreferences>(() =>
    sanitizePilotNotifications(onboardStatus?.notifications)
  );
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const handleLogout = () => {
    void signOut(() => navigate("/login"));
  };

  const refreshOnboardStatus = async () => {
    await queryClient.invalidateQueries({ queryKey: ["onboard-status"] });
    await refetchOnboardStatus();
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    if (!currentPassword) { setPasswordError(t("errorCurrentPasswordRequired", lang)); return; }
    if (!newPassword || newPassword.length < 8) { setPasswordError(t("errorPasswordTooShort", lang)); return; }
    if (newPassword !== confirmPassword) { setPasswordError(t("errorPasswordMismatch", lang)); return; }

    setPasswordLoading(true);
    try {
      await apiClient.post("/onboard/change-password", { currentPassword, newPassword });
      showToast(t("passwordChangedSuccess", lang), "success");
      setShowPasswordForm(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      if (axiosErr.response?.data?.error === "incorrect_password") {
        setPasswordError(t("errorIncorrectPassword", lang));
      } else {
        setPasswordError(t("errorChangePassword", lang));
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    setScheduleLoading(true);
    try {
      await apiClient.patch("/onboard/schedule", schedule);
      showToast(t("scheduleUpdated", lang), "success");
      setShowScheduleForm(false);
    } catch {
      showToast(t("errorUpdateSchedule", lang), "error");
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleConnectTelegram = async () => {
    setTelegramError("");
    if (!botToken.trim() || !telegramChatId.trim()) {
      setTelegramError(t("errorBothFields", lang));
      return;
    }
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
      setTelegramError(t("errorInvalidBotToken", lang));
      return;
    }
    if (!/^\d+$/.test(telegramChatId)) {
      setTelegramError(t("errorInvalidChatId", lang));
      return;
    }
    setTelegramLoading(true);
    try {
      await connectTelegram({ botToken, telegramChatId });
      await refreshOnboardStatus();
      showToast(t("telegramConnected", lang), "success");
      setShowTelegramForm(false);
      setBotToken("");
      setTelegramChatId("");
    } catch {
      setTelegramError(t("errorConnectTelegram", lang));
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    setTelegramError("");
    setTelegramLoading(true);
    try {
      await disconnectTelegram();
      await refreshOnboardStatus();
      showToast(t("channelDisconnected", lang), "success");
      setShowTelegramForm(false);
      setBotToken("");
      setTelegramChatId("");
    } catch {
      setTelegramError(t("errorConnectTelegram", lang));
      showToast(t("errorConnectTelegram", lang), "error");
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleSaveNotifications = async () => {
    const sanitizedNotifications = sanitizePilotNotifications(notifications);
    setNotifications(sanitizedNotifications);
    setNotificationsLoading(true);
    try {
      await apiClient.patch("/onboard/notifications", sanitizedNotifications);
      await refreshOnboardStatus();
      showToast(t("notificationsUpdated", lang), "success");
    } catch {
      showToast(t("errorUpdateNotifications", lang), "error");
    } finally {
      setNotificationsLoading(false);
    }
  };

  const handleSaveDisplayName = async () => {
    const trimmed = displayNameInput.trim();
    if (!trimmed) return;
    setDisplayNameLoading(true);
    try {
      await apiClient.patch("/onboard/display-name", { displayName: trimmed });
      await refreshOnboardStatus();
      showToast("Display name updated", "success");
      setEditingDisplayName(false);
    } catch {
      showToast("Failed to update display name", "error");
    } finally {
      setDisplayNameLoading(false);
    }
  };

  const statusSchedule = onboardStatus?.schedule;
  const connectivity = onboardStatus?.connectivity;
  const telegramConnected = connectivity?.telegram.connected ?? onboardStatus?.telegramConnected ?? false;

  useEffect(() => {
    setNotifications(sanitizePilotNotifications(onboardStatus?.notifications));
  }, [onboardStatus?.notifications]);

  const themeOptions: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
    { value: "dark", label: t("dark", lang), icon: <Moon size={16} /> },
    { value: "middle", label: t("middle", lang), icon: <Monitor size={16} /> },
    { value: "bright", label: t("bright", lang), icon: <Sun size={16} /> },
  ];

  return (
    <div className="bg-[var(--color-bg-base)] min-h-screen pb-20">
      <div style={{ padding: "20px 16px 8px" }}>
        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)", color: "var(--text-primary)", margin: 0 }}>
          {t("settings", lang)}
        </h1>
      </div>

      <div className="p-4 space-y-4">

        {/* Account — display name editable */}
        <section>
          <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <User size={15} /> {t("account", lang).toUpperCase()}
          </h3>
          <Card className="p-4">
            {!editingDisplayName ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-[var(--color-fg-muted)]">{t("displayName", lang)}</p>
                  <p className="text-sm font-bold text-[var(--color-fg-default)]">{onboardStatus?.displayName ?? "—"}</p>
                </div>
                <button
                  onClick={() => {
                    setDisplayNameInput(onboardStatus?.displayName ?? "");
                    setEditingDisplayName(true);
                  }}
                  className="py-1.5 px-3 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)]"
                >
                  {t("edit", lang)}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>{t("displayName", lang)}</label>
                  <input
                    type="text"
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    maxLength={64}
                    className={inputCls}
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingDisplayName(false)}
                    className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg-muted)]"
                  >
                    {t("cancel", lang)}
                  </button>
                  <button
                    onClick={handleSaveDisplayName}
                    disabled={displayNameLoading || !displayNameInput.trim()}
                    className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold disabled:opacity-50"
                  >
                    {displayNameLoading ? "..." : t("save", lang)}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* Appearance — theme only, no language toggle */}
        <section>
          <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Sun size={15} /> {t("appearance", lang).toUpperCase()}
          </h3>
          <Card className="p-4">
            <p className="text-xs text-[var(--color-fg-muted)] mb-2">{t("theme", lang)}</p>
            <div className="flex gap-2">
              {themeOptions.map((opt) => {
                const isActive = currentTheme === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border text-xs font-medium transition-colors ${
                      isActive
                        ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
                        : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)]"
                    }`}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </section>

        {/* Security */}
        <section>
          <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Lock size={15} /> {t("security", lang).toUpperCase()}
          </h3>
          <Card className="p-0 divide-y divide-[var(--color-border)]">
            {!showPasswordForm ? (
              <button
                onClick={() => setShowPasswordForm(true)}
                className="w-full flex items-center justify-between p-4 text-sm text-[var(--color-fg-default)] hover:bg-[var(--color-bg-muted)] transition-colors"
              >
                <span>{t("changePassword", lang)}</span>
                <ChevronRight size={16} className="text-[var(--color-fg-subtle)]" />
              </button>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-[var(--color-fg-default)]">{t("changePassword", lang)}</p>
                  <button onClick={() => setShowPasswordForm(false)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
                    <X size={16} />
                  </button>
                </div>
                <div>
                  <label className={labelCls}>{t("currentPassword", lang)}</label>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("newPassword", lang)}</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("confirmPassword", lang)}</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
                </div>
                {passwordError && <p className="text-[10px] text-[var(--color-accent-red)]">{passwordError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setShowPasswordForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg-muted)]">{t("cancel", lang)}</button>
                  <button onClick={handleChangePassword} disabled={passwordLoading} className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold disabled:opacity-50">
                    {passwordLoading ? "..." : t("save", lang)}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* Schedule */}
        <section>
          <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Clock size={15} /> {t("schedule", lang).toUpperCase()}
          </h3>
          {!showScheduleForm ? (
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-fg-muted)]">{t("dailyBrief", lang)}</span>
                <span className="text-[var(--color-fg-default)] font-medium">{statusSchedule?.dailyBriefTime ?? "08:00"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-fg-muted)]">{t("weeklyResearch", lang)}</span>
                <span className="text-[var(--color-fg-default)] font-medium">
                  {t(DAY_KEYS.find(d => d.value === (statusSchedule?.weeklyResearchDay ?? "sunday"))?.key ?? "daySunday", lang)} {statusSchedule?.weeklyResearchTime ?? "19:00"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-fg-muted)]">{t("timezone", lang)}</span>
                <span className="text-[var(--color-fg-default)] font-medium">{statusSchedule?.timezone ?? "Asia/Jerusalem"}</span>
              </div>
              <button
                onClick={() => setShowScheduleForm(true)}
                className="w-full mt-2 py-2 rounded-lg border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg-default)]"
              >
                {t("edit", lang)}
              </button>
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-[var(--color-fg-default)]">{t("schedule", lang)}</p>
                <button onClick={() => setShowScheduleForm(false)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
                  <X size={16} />
                </button>
              </div>
              <div>
                <label className={labelCls}>{t("dailyBrief", lang)}</label>
                <input type="time" value={schedule.dailyBriefTime} onChange={(e) => setSchedule(s => ({ ...s, dailyBriefTime: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("weeklyResearch", lang)}</label>
                <div className="relative">
                  <select value={schedule.weeklyResearchDay} onChange={(e) => setSchedule(s => ({ ...s, weeklyResearchDay: e.target.value }))} className={inputCls}>
                    {DAY_KEYS.map(d => <option key={d.value} value={d.value}>{t(d.key, lang)}</option>)}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" />
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("weeklyResearch", lang)}</label>
                <input type="time" value={schedule.weeklyResearchTime} onChange={(e) => setSchedule(s => ({ ...s, weeklyResearchTime: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("timezone", lang)}</label>
                <div className="relative">
                  <select value={schedule.timezone} onChange={(e) => setSchedule(s => ({ ...s, timezone: e.target.value }))} className={inputCls}>
                    {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowScheduleForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg-muted)]">{t("cancel", lang)}</button>
                <button onClick={handleSaveSchedule} disabled={scheduleLoading} className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold disabled:opacity-50">
                  {scheduleLoading ? "..." : t("save", lang)}
                </button>
              </div>
            </Card>
          )}
        </section>

        {/* Telegram */}
        <section>
          <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Bot size={15} /> {t("telegram", lang).toUpperCase()}
          </h3>
          {!showTelegramForm ? (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[var(--color-fg-default)]">
                    {telegramConnected ? `✓ ${t("statusConnected", lang)}` : `✗ ${t("statusNotConnected", lang)}`}
                  </p>
                  <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                    {telegramConnected && connectivity?.telegram.target
                      ? `${t("connectedTo", lang)} ${connectivity.telegram.target}`
                      : t("telegramGuideStep1", lang)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (telegramConnected) {
                      void handleDisconnectTelegram();
                      return;
                    }
                    setShowTelegramForm(true);
                  }}
                  disabled={telegramLoading}
                  className="py-1.5 px-3 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold"
                >
                  {telegramLoading ? "..." : telegramConnected ? t("disconnect", lang) : t("connect", lang)}
                </button>
              </div>
              <div className="rounded-lg bg-[var(--color-bg-muted)] p-3">
                <p className="text-[11px] font-bold text-[var(--color-fg-default)] mb-2">{t("setupGuide", lang)}</p>
                <ol className="space-y-1">
                  <li className={guideItemCls}>1. {t("telegramGuideStep1", lang)}</li>
                  <li className={guideItemCls}>2. {t("telegramGuideStep2", lang)}</li>
                  <li className={guideItemCls}>3. {t("telegramGuideStep3", lang)}</li>
                </ol>
              </div>
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-[var(--color-fg-default)]">{t("telegram", lang)}</p>
                <button onClick={() => setShowTelegramForm(false)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
                  <X size={16} />
                </button>
              </div>
              <div>
                <label className={labelCls}>{t("botToken", lang)}</label>
                <input type="text" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:ABC-xyz..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("chatId", lang)}</label>
                <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value.replace(/\D/g, ""))} placeholder="123456789" className={inputCls} />
              </div>
              <div className="rounded-lg bg-[var(--color-bg-muted)] p-3">
                <p className="text-[11px] font-bold text-[var(--color-fg-default)] mb-2">{t("setupGuide", lang)}</p>
                <ol className="space-y-1">
                  <li className={guideItemCls}>1. {t("telegramGuideStep1", lang)}</li>
                  <li className={guideItemCls}>2. {t("telegramGuideStep2", lang)}</li>
                  <li className={guideItemCls}>3. {t("telegramGuideStep3", lang)}</li>
                </ol>
              </div>
              {telegramError && <p className="text-[10px] text-[var(--color-accent-red)]">{telegramError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowTelegramForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg-muted)]">{t("cancel", lang)}</button>
                <button onClick={handleConnectTelegram} disabled={telegramLoading} className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-fg)] text-xs font-bold disabled:opacity-50">
                  {telegramLoading ? "..." : t("connect", lang)}
                </button>
              </div>
            </Card>
          )}
        </section>

        <section>
          <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Bell size={15} /> {t("notifications", lang).toUpperCase()}
          </h3>
          <Card className="p-4 space-y-4">
            <div>
              <label className={labelCls}>{t("primaryChannel", lang)}</label>
              <div className="relative">
                <select
                  value={notifications.primaryChannel}
                  onChange={(e) =>
                    setNotifications((current) => ({
                      ...current,
                      primaryChannel: e.target.value as NotificationPreferences["primaryChannel"],
                    }))
                  }
                  className={inputCls}
                >
                  {telegramConnected && <option value="telegram">{t("telegram", lang)}</option>}
                  <option value="web">{t("webChannel", lang)}</option>
                  <option value="none">{t("noAlerts", lang)}</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--color-fg-muted)]">{t("notificationChannels", lang)}</p>
              {([
                ["telegram", t("telegram", lang), telegramConnected],
                ["web", t("webChannel", lang), true],
              ] as const).map(([channel, label, available]) => (
                <label key={channel} className="flex items-center justify-between text-sm text-[var(--color-fg-default)]">
                  <span className={available ? "" : "text-[var(--color-fg-subtle)]"}>{label}</span>
                  <input
                    type="checkbox"
                    checked={notifications.enabledChannels[channel]}
                    disabled={!available}
                    onChange={(e) =>
                      setNotifications((current) => ({
                        ...current,
                        enabledChannels: {
                          ...current.enabledChannels,
                          [channel]: e.target.checked,
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--color-fg-muted)]">{t("notifyMeAbout", lang)}</p>
              {([
                ["dailyBriefs", t("dailyBriefsLabel", lang)],
                ["reportRuns", t("reportRunsLabel", lang)],
                ["marketNews", t("marketNewsLabel", lang)],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between text-sm text-[var(--color-fg-default)]">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={notifications.categories[key]}
                    onChange={(e) =>
                      setNotifications((current) => ({
                        ...current,
                        categories: {
                          ...current.categories,
                          [key]: e.target.checked,
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            <button
              onClick={handleSaveNotifications}
              disabled={notificationsLoading}
              className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-bold text-[var(--color-primary-fg)] disabled:opacity-60"
            >
              {notificationsLoading ? t("saving", lang) : t("save", lang)}
            </button>
          </Card>
        </section>

        {/* Controls & Jobs */}
        <section>
          <button
            onClick={() => navigate("/controls")}
            className="w-full py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-colors"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-fg-default)",
              background: "var(--color-bg-subtle)",
            }}
          >
            <ChevronRight size={16} />
            Controls &amp; Jobs
          </button>
        </section>

        {/* Analyst Pipeline */}
        <section>
          <AnalystPipelineConfig />
        </section>

        {/* Logout */}
        <section>
          <button
            onClick={handleLogout}
            className="w-full py-3 rounded-lg bg-[var(--color-accent-red)] text-white text-sm font-bold flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            {t("logout", lang)}
          </button>
        </section>

      </div>
    </div>
  );
}
