import type { Language } from "./preferencesStore";

export type TranslationKey =
  // Navigation
  | "settingsTab" | "portfolioTab" | "alertsTab" | "reportsTab" | "strategiesTab" | "controlsTab" | "chatTab"
  // Login
  | "loginTitle" | "loginSubtitle" | "loginUserId" | "loginPassword"
  | "loginSignIn" | "loginSigningIn" | "loginError"
  // Common actions
  | "save" | "cancel" | "edit" | "retry" | "run" | "loading" | "saving"
  | "back" | "next" | "skip" | "confirm" | "delete" | "rename"
  | "sending" | "sendMessage" | "contactAdmin" | "contactAdminTitle" | "contactAdminSubtitle"
  | "contactAdminSubject" | "contactAdminMessage" | "contactAdminSubjectPlaceholder"
  | "contactAdminMessagePlaceholder" | "contactAdminContext" | "contactAdminSent" | "contactAdminFailed"
  // Settings page
  | "settings" | "account" | "displayName" | "security" | "changePassword"
  | "schedule" | "dailyBrief" | "weeklyResearch" | "timezone"
  | "telegram" | "whatsapp" | "webChannel" | "notifications"
  | "statusConnected" | "statusNotConnected" | "connect" | "disconnect"
  | "connectedTo" | "notConnected" | "manageConnection" | "setupGuide"
  | "telegramGuideStep1" | "telegramGuideStep2" | "telegramGuideStep3"
  | "whatsAppGuideStep1" | "whatsAppGuideStep2" | "whatsAppGuideStep3"
  | "rateLimits" | "fullReport" | "dailyBriefLimit" | "deepDiveLimit" | "newIdeasLimit"
  | "setByAdmin" | "logout" | "theme" | "language" | "dark" | "bright" | "middle"
  | "english" | "hebrew" | "appearance"
  | "currentPassword" | "newPassword" | "confirmPassword"
  | "errorCurrentPasswordRequired" | "errorPasswordTooShort" | "errorPasswordMismatch"
  | "passwordChangedSuccess" | "errorIncorrectPassword" | "errorChangePassword"
  | "scheduleUpdated" | "errorUpdateSchedule"
  | "botToken" | "chatId" | "telegramConnected" | "whatsappConnected" | "channelDisconnected"
  | "errorConnectTelegram" | "errorConnectWhatsApp" | "errorBothFields"
  | "errorInvalidBotToken" | "errorInvalidChatId" | "errorInvalidPhoneNumberId"
  | "errorInvalidRecipientPhone" | "errorInvalidAccessToken"
  | "accessToken" | "phoneNumberId" | "recipientPhone"
  | "primaryChannel" | "notificationChannels" | "notifyMeAbout"
  | "dailyBriefsLabel" | "reportRunsLabel" | "marketNewsLabel"
  | "notificationsUpdated" | "errorUpdateNotifications" | "noAlerts"
  | "perWeek" | "perDay"
  // Days of week
  | "daySunday" | "dayMonday" | "dayTuesday" | "dayWednesday"
  | "dayThursday" | "dayFriday" | "daySaturday"
  // Portfolio
  | "portfolio" | "errorLoadPortfolio" | "emptyPortfolio" | "addPosition"
  | "colTicker" | "colShares" | "colAvgPrice" | "colLivePrice" | "colValue"
  | "colPlPct" | "colPl" | "colWeight" | "colVerdict" | "colDayPct"
  | "shares" | "avgBuyPrice" | "livePrice" | "currentValue" | "costBasis" | "weight" | "accounts"
  | "priceStale" | "jobsRunning" | "editPosition" | "priceHistory"
  | "saveChanges" | "noChartData"
  // Summary strip
  | "totalValue" | "totalPL" | "today" | "positions" | "usdIls" | "updatedAt"
  // Portfolio empty account
  | "emptyAccount"
  // Strategies
  | "strategies" | "errorLoadStrategies" | "emptyStrategies" | "noStrategyMatches"
  | "searchTicker" | "filterAll" | "expiredCatalyst" | "strategyTabPortfolio" | "strategyTabNonPortfolio"
  | "searchNoResults" | "searchLoading" | "searchUnexpectedError" | "searchUnexpectedErrorHelp"
  | "colConfidence" | "colTimeframe" | "colSize" | "colWeightPct" | "colReasoning" | "colUpdated"
  // Controls
  | "controls" | "activeJobs" | "recentJobs" | "noJobs" | "enterTicker" | "tickerRequired"
  | "jobDailyTitle" | "jobDailyDesc" | "jobFullTitle" | "jobFullDesc"
  | "jobDeepDiveTitle" | "jobDeepDiveDesc" | "jobNewIdeasTitle" | "jobNewIdeasDesc"
  | "jobWeeklyTitle" | "jobWeeklyDesc" | "jobWeeklyBlockedReason" | "jobNewIdeasBlockedReason"
  | "jobQueued" | "jobFailed" | "jobCompleted" | "jobCompletedNotif" | "jobFailedNotif"
  // Reports
  | "feed" | "reports" | "emptyReports" | "newerBtn" | "olderBtn" | "reportLoadError" | "pageOf"
  // Strategy Modal
  | "reasoning" | "bullCase" | "bearCase" | "entryConditions" | "exitConditions" | "catalysts"
  | "noExpiry" | "triggered" | "comingSoon" | "failedLoadStrategy" | "runDeepDive"
  | "strategyUpdated"
  // Confidence levels (dynamic data display)
  | "confidenceHigh" | "confidenceMedium" | "confidenceLow"
  // Timeframes
  | "timeframeWeek" | "timeframeMonths" | "timeframeLongTerm" | "timeframeUndefined"
  // Verdicts
  | "verdictBuy" | "verdictAdd" | "verdictHold" | "verdictReduce" | "verdictSell" | "verdictClose"
  // Job card
  | "jobInitializing" | "jobTickersComplete" | "jobQueued2" | "jobDone" | "jobCompletedOk"
  // Alerts
  | "alerts" | "errorLoadAlerts" | "emptyAlerts" | "alertsNeedAttention"
  | "alertCritical" | "alertWarning" | "alertOpportunities" | "runNow"
  | "escalationNeeds" | "fullReportStarted" | "errorStartFullReport"
  // App banner
  | "healthBanner"
  // Onboarding
  | "onboardStep1Title" | "onboardStep1Sub" | "onboardAdminKey" | "onboardUserId"
  | "onboardPassword" | "onboardConfirmPassword" | "onboardDisplayName"
  | "onboardUserIdHint" | "onboardUserIdError" | "onboardPasswordHint"
  | "onboardPasswordError" | "onboardPasswordMismatch" | "onboardFieldRequired"
  | "onboardSetPasswordTitle" | "onboardSetPasswordSub"
  | "onboardPasswordIncorrect" | "onboardPasswordChangeFailed"
  | "onboardConnecting" | "onboardContinue"
  | "onboardStep2Title" | "onboardStep2Sub" | "onboardDailyBriefTime"
  | "onboardWeeklyDay" | "onboardWeeklyTime" | "onboardScheduleHint"
  | "onboardStep3Title" | "onboardStep3Sub"
  | "onboardTelegramStep1" | "onboardTelegramStep2" | "onboardTelegramStep3"
  | "onboardBotTokenHint" | "onboardChatIdHint"
  | "onboardSkip" | "onboardConnect" | "onboardBothFields"
  | "onboardInvalidBotToken" | "onboardInvalidChatId"
  | "onboardTelegramConnected" | "onboardTelegramFailed"
  | "onboardStep4Title" | "onboardStep4Sub" | "onboardAddPosition" | "onboardAddAccount"
  | "onboardDefaultAccount" | "onboardReview"
  | "onboardTickerLabel" | "onboardSharesLabel" | "onboardAvgPriceLabel" | "onboardExchangeLabel"
  | "onboardDuplicateTicker" | "onboardTickerRequired" | "onboardSharesError"
  | "onboardAvgPriceError" | "onboardAddPositionError"
  | "onboardPriceFetching" | "onboardPriceUnavailable" | "onboardMarketPriceHint"
  | "onboardStep5Title" | "onboardStep5Sub" | "onboardLaunch" | "onboardLaunching"
  | "onboardSetupFailed"
  | "onboardStep6Title" | "onboardStep6Sub" | "onboardStep6Hint"
  | "onboardGuidanceOptional" | "onboardGuidanceThesis" | "onboardGuidanceThesisPlaceholder"
  | "onboardGuidanceHorizon" | "onboardGuidanceHorizonUnspecified" | "onboardGuidanceHorizonDays"
  | "onboardGuidanceHorizonWeeks" | "onboardGuidanceHorizonMonths" | "onboardGuidanceHorizonYears"
  | "onboardGuidanceAdd" | "onboardGuidanceAddPlaceholder"
  | "onboardGuidanceReduce" | "onboardGuidanceReducePlaceholder"
  | "onboardGuidanceNotes" | "onboardGuidanceNotesPlaceholder"
  | "onboardReviewAccount" | "onboardReviewSchedule" | "onboardReviewTelegram"
  | "onboardReviewPortfolio" | "onboardTelegramYes" | "onboardTelegramNo"
  // Admin
  | "adminTitle" | "adminLoginSub" | "adminKeyPlaceholder" | "adminLoginError"
  | "adminAddUser" | "adminCreateUser" | "adminCreating" | "adminUserCreationError"
  | "adminUserCreationFailed" | "adminDeleteUser" | "adminConfirmDelete"
  | "adminUserIdLabel" | "adminPasswordLabel" | "adminDisplayNameLabel"
  | "adminTelegramSection" | "adminScheduleSection"
  | "adminDailyTime" | "adminWeeklyDay" | "adminWeeklyTime"
  | "adminModelProfiles" | "adminAddProfile" | "adminProfileName" | "adminProfileNameHint"
  | "adminOrchestrator" | "adminAnalysts" | "adminResearchers"
  | "adminFailedLoadProfiles" | "adminFailedUpdateProfile" | "adminFailedCreateProfile"
  | "adminFailedDeleteProfile" | "adminFailedSwitchProfile" | "adminConfirmDeleteProfile"
  | "adminStatusOk" | "adminStatusError"
  | "adminStateActive" | "adminStateBootstrapping" | "adminStateIncomplete" | "adminPortfolioLoaded" | "adminPortfolioMissing"
  | "adminFailedLoadUsers" | "adminFailedDeleteUser" | "adminUserDeleted"
  | "adminGateway" | "adminUsers" | "adminActive" | "adminRunning" | "adminStopped"
  | "adminNoUsers" | "adminTotal" | "adminSignIn"
  | "adminMax" | "adminPer" | "adminHrs" | "adminRisk"
  | "adminEditTelegram" | "adminAddTelegram" | "adminSaveTelegram"
  | "adminEditLimits" | "adminDeleting"
  | "adminTypeToConfirm" | "adminToConfirmDeletion"
  | "adminTelegramYes" | "adminTelegramNo"
  | "adminDeepDives" | "adminFullReportsLabel"
  // Onboarding additional
  | "onboardPosition" | "onboardPositions" | "onboardAccountSingular"
  | "onboardAcross" | "onboardAt" | "onboardDailyAt" | "onboardLaunchBtn"
  // Greetings
  | "greeting1" | "greeting2" | "greeting3" | "greeting4" | "greeting5" | "greeting6"
  // Today screen — pilot v1
  | "todayTitle"
  | "setupBannerTitle" | "setupBannerBodyChannelAgnostic" | "setupBannerBodyTelegram"
  | "setupBannerProgress" | "setupBannerInProgress"
  | "healthLabelHealthy" | "healthLabelSteady" | "healthLabelWatch"
  | "healthHeroSummary"
  | "attentionHeader" | "attentionClearSuffix"
  | "factoidEarningsInDays" | "factoidCatalystInDays"
  | "factoidReviewDue" | "factoidFreshReview" | "factoidThesisOnTrack"
  | "whyTodayHeader"
  | "whyTodayCatalystExpired" | "whyTodaySellClose" | "whyTodayReduce"
  | "whyTodayMarkedForAttention"
  | "scoreChipAria"
  | "noClearPositions";

type Translations = Record<Language, Record<TranslationKey, string>>;

export const translations: Translations = {
  en: {
    // Navigation
    settingsTab: "Settings",
    portfolioTab: "Portfolio",
    alertsTab: "Feed",
    reportsTab: "Feed",
    strategiesTab: "Strategies",
    controlsTab: "Controls",
    chatTab: "Chat",
    // Login
    loginTitle: "Startix",
    loginSubtitle: "Know exactly what to do with every position",
    loginUserId: "User ID",
    loginPassword: "Password",
    loginSignIn: "Sign In",
    loginSigningIn: "Signing in...",
    loginError: "Invalid credentials. Please try again.",
    // Common actions
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    retry: "Retry",
    run: "Run",
    loading: "Loading...",
    saving: "Saving...",
    back: "← Back",
    next: "Next",
    skip: "Skip for now",
    confirm: "Confirm",
    delete: "Delete",
    rename: "Rename",
    sending: "Sending...",
    sendMessage: "Send message",
    contactAdmin: "Contact Admin",
    contactAdminTitle: "Contact admin",
    contactAdminSubtitle: "Send a quick message to support. Include what happened and what you expected.",
    contactAdminSubject: "Subject",
    contactAdminMessage: "Message",
    contactAdminSubjectPlaceholder: "Short summary",
    contactAdminMessagePlaceholder: "Describe the issue, request, or question...",
    contactAdminContext: "Page context",
    contactAdminSent: "Your message was sent to support",
    contactAdminFailed: "Failed to send message to support",
    // Settings
    settings: "Settings",
    account: "Account",
    displayName: "Display Name",
    security: "Security",
    changePassword: "Change Password",
    schedule: "Schedule",
    dailyBrief: "Daily Brief",
    weeklyResearch: "Weekly Research",
    timezone: "Timezone",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    webChannel: "Web",
    notifications: "Notifications",
    statusConnected: "Status: Connected",
    statusNotConnected: "Status: Not connected",
    connect: "Connect",
    disconnect: "Disconnect",
    connectedTo: "Connected to",
    notConnected: "Not connected",
    manageConnection: "Manage connection",
    setupGuide: "Setup guide",
    telegramGuideStep1: 'Send "/newbot" to exactly @BotFather in Telegram, follow the prompts, and copy the token it gives you.',
    telegramGuideStep2: "Find your new bot by username and send it any message — this activates the chat.",
    telegramGuideStep3: 'Open @userinfobot in Telegram, send any message, and copy the numeric ID it shows.',
    whatsAppGuideStep1: "In Meta for Developers, create a WhatsApp app and open WhatsApp > API Setup.",
    whatsAppGuideStep2: "Copy a permanent access token and the Phone Number ID for your business number.",
    whatsAppGuideStep3: "Enter your WhatsApp recipient phone in international format, for example +14155550123.",
    rateLimits: "Rate Limits",
    fullReport: "Full Report",
    dailyBriefLimit: "Daily Brief",
    deepDiveLimit: "Deep Dive",
    newIdeasLimit: "New Ideas",
    setByAdmin: "(set by admin)",
    logout: "Log Out",
    theme: "Theme",
    language: "Language",
    dark: "Dark",
    bright: "Bright",
    middle: "Middle",
    english: "English",
    hebrew: "Hebrew",
    appearance: "Appearance",
    currentPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm",
    errorCurrentPasswordRequired: "Current password required",
    errorPasswordTooShort: "New password min 8 characters",
    errorPasswordMismatch: "Passwords do not match",
    passwordChangedSuccess: "Password changed successfully",
    errorIncorrectPassword: "Current password is incorrect",
    errorChangePassword: "Failed to change password",
    scheduleUpdated: "Schedule updated",
    errorUpdateSchedule: "Failed to update schedule",
    botToken: "Bot Token",
    chatId: "Chat ID",
    accessToken: "Access Token",
    phoneNumberId: "Phone Number ID",
    recipientPhone: "Recipient Phone",
    telegramConnected: "Telegram connected!",
    whatsappConnected: "WhatsApp connected!",
    channelDisconnected: "Channel disconnected",
    errorConnectTelegram: "Failed to connect Telegram",
    errorConnectWhatsApp: "Failed to connect WhatsApp",
    errorBothFields: "Both fields required",
    errorInvalidBotToken: "Invalid bot token format",
    errorInvalidChatId: "Invalid chat ID",
    errorInvalidPhoneNumberId: "Invalid phone number ID",
    errorInvalidRecipientPhone: "Invalid recipient phone number",
    errorInvalidAccessToken: "Access token looks invalid",
    primaryChannel: "Primary channel",
    notificationChannels: "Channels",
    notifyMeAbout: "What should notify me",
    dailyBriefsLabel: "Daily briefs",
    reportRunsLabel: "Report runs",
    marketNewsLabel: "Market news",
    notificationsUpdated: "Notifications updated",
    errorUpdateNotifications: "Failed to update notifications",
    noAlerts: "No alerts",
    perWeek: "/ week",
    perDay: "/ day",
    // Days
    daySunday: "Sunday",
    dayMonday: "Monday",
    dayTuesday: "Tuesday",
    dayWednesday: "Wednesday",
    dayThursday: "Thursday",
    dayFriday: "Friday",
    daySaturday: "Saturday",
    // Portfolio
    portfolio: "Portfolio",
    errorLoadPortfolio: "Failed to load portfolio",
    emptyPortfolio: "No positions found",
    addPosition: "+ Add Position",
    colTicker: "Ticker",
    colShares: "Shares",
    colAvgPrice: "Avg ₪",
    colLivePrice: "Live ₪",
    colValue: "Value ₪",
    colPlPct: "P/L %",
    colPl: "P/L ₪",
    colWeight: "Weight",
    colVerdict: "Verdict",
    shares: "Shares",
    avgBuyPrice: "Avg Buy Price",
    livePrice: "Live Price",
    currentValue: "Current Value",
    costBasis: "Cost Basis",
    weight: "Weight",
    accounts: "Accounts",
    priceStale: "Price data may be stale",
    jobsRunning: "job(s) running",
    editPosition: "Edit Position",
    priceHistory: "Price History",
    saveChanges: "Save Changes",
    noChartData: "No chart data available",
    colDayPct: "Day %",
    // Summary strip
    totalValue: "Total Value",
    totalPL: "Total P/L",
    today: "Today",
    positions: "Positions",
    usdIls: "USD/ILS",
    updatedAt: "Updated",
    emptyAccount: "No positions. Use '+ Add Position' above or remove this account.",
    // Strategies
    strategies: "Strategies",
    errorLoadStrategies: "Failed to load strategies",
    emptyStrategies: "No strategies yet — run a full report",
    noStrategyMatches: "No strategies match your filter",
    searchTicker: "Search ticker...",
    searchNoResults: "No results for",
    searchLoading: "Searching…",
    searchUnexpectedError: "Something unexpected happened.",
    searchUnexpectedErrorHelp: "Try again and if problem persists - contact help with help button.",
    filterAll: "All",
    expiredCatalyst: "Expired catalyst",
    strategyTabPortfolio: "Portfolio",
    strategyTabNonPortfolio: "Tracking",
    colConfidence: "Confidence",
    colTimeframe: "Timeframe",
    colSize: "Size ₪",
    colWeightPct: "Weight %",
    colReasoning: "Reasoning",
    colUpdated: "Updated",
    // Controls
    controls: "Controls",
    activeJobs: "Active Jobs",
    recentJobs: "Recent Jobs",
    noJobs: "No jobs yet — use the buttons above to get started",
    enterTicker: "TICKER",
    tickerRequired: "Enter a ticker symbol",
    jobDailyTitle: "Daily Brief",
    jobDailyDesc: "Run today's portfolio brief",
    jobFullTitle: "Full Report",
    jobFullDesc: "Analyze all positions",
    jobWeeklyTitle: "Weekly Report",
    jobWeeklyDesc: "Full portfolio review with richer weekly context",
    jobWeeklyBlockedReason: "This is visible for roadmap clarity, but weekly report is currently blocked while the full portfolio review is being rebuilt.",
    jobDeepDiveTitle: "Deep Dive",
    jobDeepDiveDesc: "Full analysis on one ticker",
    jobNewIdeasTitle: "New Ideas",
    jobNewIdeasDesc: "Idea discovery and research pipeline",
    jobNewIdeasBlockedReason: "New ideas stays visible, but it is currently blocked until the research flow is production-ready.",
    jobQueued: "queued — you'll be notified when done",
    jobFailed: "Failed to trigger",
    jobCompleted: "completed",
    jobCompletedNotif: "completed ✓",
    jobFailedNotif: "failed — check logs",
    // Reports
    feed: "Feed",
    reports: "Reports",
    emptyReports: "No reports yet",
    newerBtn: "← Newer",
    olderBtn: "Older →",
    reportLoadError: "Failed to load report",
    pageOf: "Page",
    // Strategy modal
    reasoning: "Reasoning",
    bullCase: "Bull Case",
    bearCase: "Bear Case",
    entryConditions: "Entry Conditions",
    exitConditions: "Exit Conditions",
    catalysts: "Catalysts",
    noExpiry: "No expiry",
    triggered: "Triggered",
    comingSoon: "Coming soon",
    failedLoadStrategy: "Failed to load strategy",
    runDeepDive: "🔬 Run Deep Dive",
    strategyUpdated: "Updated",
    // Confidence
    confidenceHigh: "High",
    confidenceMedium: "Medium",
    confidenceLow: "Low",
    // Timeframes
    timeframeWeek: "Week",
    timeframeMonths: "Months",
    timeframeLongTerm: "Long Term",
    timeframeUndefined: "—",
    // Verdicts
    verdictBuy: "BUY",
    verdictAdd: "ADD",
    verdictHold: "HOLD",
    verdictReduce: "REDUCE",
    verdictSell: "SELL",
    verdictClose: "CLOSE",
    // Job card
    jobInitializing: "Initializing…",
    jobTickersComplete: "tickers complete",
    jobQueued2: "Queued:",
    jobDone: "Done:",
    jobCompletedOk: "Completed successfully.",
    // Alerts
    alerts: "Feed",
    errorLoadAlerts: "Failed to load alerts",
    emptyAlerts: "No feed items yet",
    alertsNeedAttention: "need attention",
    alertCritical: "Sell / Close",
    alertWarning: "Reduce",
    alertOpportunities: "Buy / Add",
    runNow: "Run Now",
    escalationNeeds: "position(s) need deep analysis",
    fullReportStarted: "Full portfolio analysis started — you'll be notified when ready",
    errorStartFullReport: "Failed to start full report",
    // App banner
    healthBanner: "Startix AI is experiencing issues. Strategy updates may be delayed — please contact support.",
    // Onboarding
    onboardStep1Title: "Account Setup",
    onboardStep1Sub: "Create your Startix account",
    onboardAdminKey: "Beta Access Code",
    onboardUserId: "User ID",
    onboardPassword: "Password",
    onboardConfirmPassword: "Confirm Password",
    onboardDisplayName: "Display Name",
    onboardUserIdHint: "Login identifier. Cannot be changed.",
    onboardUserIdError: "4–32 characters: letters, numbers, hyphens",
    onboardPasswordHint: "Min 8 characters",
    onboardPasswordError: "Min 8 characters",
    onboardPasswordMismatch: "Passwords do not match",
    onboardFieldRequired: "Required",
    onboardSetPasswordTitle: "🔐 Set Your Password",
    onboardSetPasswordSub: "You've been given a temporary password by your admin. Please set a new one now.",
    onboardPasswordIncorrect: "Current password is incorrect",
    onboardPasswordChangeFailed: "Failed to change password",
    onboardConnecting: "Connecting...",
    onboardContinue: "Continue →",
    onboardStep2Title: "⏰ Your Brief Schedule",
    onboardStep2Sub: "When should your daily portfolio brief run?",
    onboardDailyBriefTime: "Daily Brief Time",
    onboardWeeklyDay: "Weekly Research Day",
    onboardWeeklyTime: "Weekly Research Time",
    onboardScheduleHint: "All times in your selected timezone. Daily briefs run on weekdays only.",
    onboardStep3Title: "🤖 Connect Telegram (Optional)",
    onboardStep3Sub: "Get portfolio alerts and interact with your agent via Telegram.",
    onboardTelegramStep1: "1. Open Telegram → find @BotFather",
    onboardTelegramStep2: "2. Send /newbot → follow instructions",
    onboardTelegramStep3: "3. Paste your bot token below",
    onboardBotTokenHint: "format: 123456789:ABC-xyz...",
    onboardChatIdHint: "Get from @userinfobot on Telegram",
    onboardSkip: "Skip for now",
    onboardConnect: "Connect & Continue →",
    onboardBothFields: "Both bot token and chat ID are required",
    onboardInvalidBotToken: "Invalid bot token format",
    onboardInvalidChatId: "Invalid chat ID format",
    onboardTelegramConnected: "Telegram connected!",
    onboardTelegramFailed: "Failed to connect Telegram. Check your token and chat ID.",
    onboardStep4Title: "Portfolio",
    onboardStep4Sub: "Add your positions across all accounts",
    onboardAddPosition: "+ Add Position",
    onboardAddAccount: "+ Add Account",
    onboardDefaultAccount: "Account",
    onboardReview: "Review",
    onboardTickerLabel: "Ticker",
    onboardSharesLabel: "Shares",
    onboardAvgPriceLabel: "Market price",
    onboardMarketPriceHint: "Live quote",
    onboardPriceFetching: "Fetching live price…",
    onboardPriceUnavailable: "Could not fetch price. Try another ticker.",
    onboardExchangeLabel: "Exchange",
    onboardDuplicateTicker: "Duplicate ticker",
    onboardTickerRequired: "Ticker required",
    onboardSharesError: "Positive integer",
    onboardAvgPriceError: "Price required",
    onboardAddPositionError: "Add at least one position",
    onboardStep5Title: "Confirm & Launch",
    onboardStep5Sub: "Review before launching",
    onboardLaunch: "Launch →",
    onboardLaunching: "Launching...",
    onboardSetupFailed: "Setup failed. Please check your details and try again.",
    onboardStep6Title: "Position Guidance",
    onboardStep6Sub: "Optional: add your own thinking before the first analysis pass.",
    onboardStep6Hint: "You can skip this step, annotate a few important positions, or fill everything. Startix will use this as structured context for the first strategy pass.",
    onboardGuidanceOptional: "Optional per-position context",
    onboardGuidanceThesis: "Why do you own it?",
    onboardGuidanceThesisPlaceholder: "Brief thesis or what you think matters here.",
    onboardGuidanceHorizon: "Intended horizon",
    onboardGuidanceHorizonUnspecified: "Unspecified",
    onboardGuidanceHorizonDays: "Days",
    onboardGuidanceHorizonWeeks: "Weeks",
    onboardGuidanceHorizonMonths: "Months",
    onboardGuidanceHorizonYears: "Years",
    onboardGuidanceAdd: "What would make you add?",
    onboardGuidanceAddPlaceholder: "Optional add condition or confirmation you care about.",
    onboardGuidanceReduce: "What would make you reduce?",
    onboardGuidanceReducePlaceholder: "Optional reduce condition or risk you care about.",
    onboardGuidanceNotes: "Other notes",
    onboardGuidanceNotesPlaceholder: "Anything else the first strategy pass should know.",
    onboardReviewAccount: "Account",
    onboardReviewSchedule: "Schedule",
    onboardReviewTelegram: "Telegram",
    onboardReviewPortfolio: "Portfolio",
    onboardTelegramYes: "✓ Connected",
    onboardTelegramNo: "Not connected",
    // Admin
    adminTitle: "Admin Panel",
    adminLoginSub: "startix.app",
    adminKeyPlaceholder: "Admin Key",
    adminLoginError: "Invalid admin key",
    adminAddUser: "Add User",
    adminCreateUser: "Create User",
    adminCreating: "Creating...",
    adminUserCreationError: "User ID and password required",
    adminUserCreationFailed: "Failed to create user",
    adminDeleteUser: "Delete user",
    adminConfirmDelete: "Delete user",
    adminUserIdLabel: "User ID",
    adminPasswordLabel: "Password",
    adminDisplayNameLabel: "Display Name",
    adminTelegramSection: "Telegram (optional)",
    adminScheduleSection: "Schedule",
    adminDailyTime: "Daily time",
    adminWeeklyDay: "Weekly day",
    adminWeeklyTime: "Weekly time",
    adminModelProfiles: "Model Profiles",
    adminAddProfile: "+ Add Profile",
    adminProfileName: "Profile Name",
    adminProfileNameHint: "e.g. budget",
    adminOrchestrator: "Orchestrator",
    adminAnalysts: "Analysts",
    adminResearchers: "Researchers",
    adminFailedLoadProfiles: "Failed to load profiles",
    adminFailedUpdateProfile: "Failed to update profile",
    adminFailedCreateProfile: "Failed to create profile",
    adminFailedDeleteProfile: "Failed to delete profile",
    adminFailedSwitchProfile: "Failed to switch profile",
    adminConfirmDeleteProfile: "Delete profile",
    adminStatusOk: "OK",
    adminStatusError: "Error ⚠",
    adminStateActive: "ACTIVE",
    adminStateBootstrapping: "BOOTSTRAPPING",
    adminStateIncomplete: "INCOMPLETE",
    adminPortfolioLoaded: "portfolio ✓",
    adminPortfolioMissing: "portfolio ✗",
    adminFailedLoadUsers: "Failed to load users",
    adminFailedDeleteUser: "Failed to delete user",
    adminUserDeleted: "User deleted",
    adminGateway: "Gateway",
    adminUsers: "Users",
    adminActive: "Active",
    adminRunning: "🟢 running",
    adminStopped: "🔴 stopped",
    adminNoUsers: "No users yet",
    adminTotal: "total",
    adminSignIn: "Sign In",
    adminMax: "max",
    adminPer: "per",
    adminHrs: "hrs",
    adminRisk: "Risk",
    adminEditTelegram: "Edit Telegram",
    adminAddTelegram: "Add Telegram",
    adminSaveTelegram: "Save Telegram",
    adminEditLimits: "Edit Limits",
    adminDeleting: "Deleting...",
    adminTypeToConfirm: "Type",
    adminToConfirmDeletion: "to confirm deletion:",
    adminTelegramYes: "Telegram: ✅ connected",
    adminTelegramNo: "Telegram: ✗ not connected",
    adminDeepDives: "Deep dives:",
    adminFullReportsLabel: "Full reports:",
    // Onboarding additional
    onboardPosition: "position",
    onboardPositions: "positions",
    onboardAccountSingular: "account",
    onboardAcross: "across",
    onboardAt: "at",
    onboardDailyAt: "Daily at",
    onboardLaunchBtn: "Launch Startix 🚀",
    // Greetings
    greeting1: "Strategy check — let's see what needs attention 📊",
    greeting2: "Every position has a story. Let's read yours 📈",
    greeting3: "Stay ahead of every position 🎯",
    greeting4: "What's your strategy saying today? 📊",
    greeting5: "Good to have you back. Let's sync up 🔄",
    greeting6: "Positions don't manage themselves. You do 💡",
    // Today screen — pilot v1
    todayTitle: "Today",
    setupBannerTitle: "Startix is analyzing your positions",
    setupBannerBodyChannelAgnostic: "We'll notify you when ready.",
    setupBannerBodyTelegram: "We'll notify you on Telegram when ready.",
    setupBannerProgress: "Analyzed {analyzed} of {total} positions",
    setupBannerInProgress: "{tickers} in progress",
    healthLabelHealthy: "Healthy",
    healthLabelSteady: "Steady",
    healthLabelWatch: "Watch",
    healthHeroSummary: "{clear} of {total} clear · reviewed {timeAgo}",
    attentionHeader: "{count} need attention",
    attentionClearSuffix: "{count} clear",
    factoidEarningsInDays: "Earnings in {days}d",
    factoidCatalystInDays: "Catalyst in {days}d",
    factoidReviewDue: "Review due in {days}d",
    factoidFreshReview: "Fresh review · catalyst {date}",
    factoidThesisOnTrack: "Thesis on track",
    whyTodayHeader: "Why this fired today",
    whyTodayCatalystExpired: "{description} expired {days} days ago",
    whyTodaySellClose: "{verdict} · {reasoning}",
    whyTodayReduce: "REDUCE · {reasoning}",
    whyTodayMarkedForAttention: "Marked for attention",
    scoreChipAria: "Health score {score} of 100",
    noClearPositions: "All positions are in attention.",
  },
  he: {
    // Navigation
    settingsTab: "הגדרות",
    portfolioTab: "תיק",
    alertsTab: "פיד",
    reportsTab: "פיד",
    strategiesTab: "אסטרטגיות",
    controlsTab: "בקרה",
    chatTab: "צ'אט",
    // Login
    loginTitle: "Startix",
    loginSubtitle: "תמיד מסונכרן עם האסטרטגיה של הפוזיציות שלך",
    loginUserId: "מזהה משתמש",
    loginPassword: "סיסמה",
    loginSignIn: "כניסה",
    loginSigningIn: "מתחבר...",
    loginError: "פרטי כניסה שגויים. נסה שנית.",
    // Common actions
    save: "שמירה",
    cancel: "ביטול",
    edit: "עריכה",
    retry: "נסה שנית",
    run: "הפעל",
    loading: "טוען...",
    saving: "שומר...",
    back: "→ חזרה",
    next: "הבא",
    skip: "דלג לעת עתה",
    confirm: "אישור",
    delete: "מחיקה",
    rename: "שינוי שם",
    sending: "שולח...",
    sendMessage: "שלח הודעה",
    contactAdmin: "צור קשר עם המנהל",
    contactAdminTitle: "פנייה למנהל",
    contactAdminSubtitle: "שלח הודעה קצרה לתמיכה. כתוב מה קרה ומה ציפית שיקרה.",
    contactAdminSubject: "נושא",
    contactAdminMessage: "הודעה",
    contactAdminSubjectPlaceholder: "סיכום קצר",
    contactAdminMessagePlaceholder: "תאר את הבעיה, הבקשה או השאלה...",
    contactAdminContext: "הקשר עמוד",
    contactAdminSent: "ההודעה נשלחה לתמיכה",
    contactAdminFailed: "שליחת ההודעה לתמיכה נכשלה",
    // Settings
    settings: "הגדרות",
    account: "חשבון",
    displayName: "שם תצוגה",
    security: "אבטחה",
    changePassword: "שינוי סיסמה",
    schedule: "לוח זמנים",
    dailyBrief: "סיכום יומי",
    weeklyResearch: "מחקר שבועי",
    timezone: "אזור זמן",
    telegram: "טלגרם",
    whatsapp: "וואטסאפ",
    webChannel: "ווב",
    notifications: "התראות",
    statusConnected: "סטטוס: מחובר",
    statusNotConnected: "סטטוס: לא מחובר",
    connect: "חיבור",
    disconnect: "ניתוק",
    connectedTo: "מחובר אל",
    notConnected: "לא מחובר",
    manageConnection: "ניהול חיבור",
    setupGuide: "מדריך חיבור",
    telegramGuideStep1: 'שלחו "/newbot" ל־@BotFather בטלגרם, עקבו אחרי ההוראות, והעתיקו את הטוקן שקיבלתם.',
    telegramGuideStep2: "חפשו את הבוט לפי שם המשתמש ושלחו לו הודעה כלשהי — זה מפעיל את הצ'אט.",
    telegramGuideStep3: "פתחו את @userinfobot, שלחו הודעה כלשהי, והעתיקו את המזהה המספרי שמוצג.",
    whatsAppGuideStep1: "ב־Meta for Developers צרו אפליקציית WhatsApp ופתחו WhatsApp > API Setup.",
    whatsAppGuideStep2: "העתיקו Permanent Access Token ואת מזהה Phone Number ID של המספר העסקי.",
    whatsAppGuideStep3: "הזינו את מספר הוואטסאפ שלכם בפורמט בינלאומי, למשל +14155550123.",
    rateLimits: "מגבלות שימוש",
    fullReport: "דוח מלא",
    dailyBriefLimit: "סיכום יומי",
    deepDiveLimit: "צלילה עמוקה",
    newIdeasLimit: "רעיונות חדשים",
    setByAdmin: "(מוגדר ע\"י מנהל)",
    logout: "התנתקות",
    theme: "נושא",
    language: "שפה",
    dark: "כהה",
    bright: "בהיר",
    middle: "בינוני",
    english: "אנגלית",
    hebrew: "עברית",
    appearance: "מראה",
    currentPassword: "סיסמה נוכחית",
    newPassword: "סיסמה חדשה",
    confirmPassword: "אישור",
    errorCurrentPasswordRequired: "יש להזין את הסיסמה הנוכחית",
    errorPasswordTooShort: "סיסמה חדשה — מינימום 8 תווים",
    errorPasswordMismatch: "הסיסמאות אינן תואמות",
    passwordChangedSuccess: "הסיסמה שונתה בהצלחה",
    errorIncorrectPassword: "הסיסמה הנוכחית שגויה",
    errorChangePassword: "שינוי הסיסמה נכשל",
    scheduleUpdated: "לוח הזמנים עודכן",
    errorUpdateSchedule: "עדכון לוח הזמנים נכשל",
    botToken: "טוקן בוט",
    chatId: "מזהה שיחה",
    accessToken: "Access Token",
    phoneNumberId: "מזהה מספר עסקי",
    recipientPhone: "מספר יעד",
    telegramConnected: "טלגרם חובר בהצלחה!",
    whatsappConnected: "וואטסאפ חובר בהצלחה!",
    channelDisconnected: "החיבור נותק",
    errorConnectTelegram: "חיבור הטלגרם נכשל",
    errorConnectWhatsApp: "חיבור הוואטסאפ נכשל",
    errorBothFields: "שני השדות נדרשים",
    errorInvalidBotToken: "פורמט טוקן בוט לא תקין",
    errorInvalidChatId: "מזהה שיחה לא תקין",
    errorInvalidPhoneNumberId: "מזהה מספר עסקי לא תקין",
    errorInvalidRecipientPhone: "מספר יעד לא תקין",
    errorInvalidAccessToken: "Access Token לא נראה תקין",
    primaryChannel: "ערוץ ראשי",
    notificationChannels: "ערוצים",
    notifyMeAbout: "על מה להתראות",
    dailyBriefsLabel: "סיכומים יומיים",
    reportRunsLabel: "הרצות דוחות",
    marketNewsLabel: "חדשות שוק",
    notificationsUpdated: "ההתראות עודכנו",
    errorUpdateNotifications: "עדכון ההתראות נכשל",
    noAlerts: "ללא התראות",
    perWeek: "/ שבוע",
    perDay: "/ יום",
    // Days
    daySunday: "ראשון",
    dayMonday: "שני",
    dayTuesday: "שלישי",
    dayWednesday: "רביעי",
    dayThursday: "חמישי",
    dayFriday: "שישי",
    daySaturday: "שבת",
    // Portfolio
    portfolio: "תיק השקעות",
    errorLoadPortfolio: "טעינת תיק ההשקעות נכשלה",
    emptyPortfolio: "לא נמצאו פוזיציות",
    addPosition: "+ הוסף פוזיציה",
    colTicker: "מניה",
    colShares: "כמות",
    colAvgPrice: "ממוצע ₪",
    colLivePrice: "מחיר ₪",
    colValue: "ערך ₪",
    colPlPct: "ר/ה %",
    colPl: "ר/ה ₪",
    colWeight: "משקל",
    colVerdict: "המלצה",
    colDayPct: "שינוי %",
    shares: "כמות מניות",
    avgBuyPrice: "מחיר ממוצע",
    livePrice: "מחיר חי",
    currentValue: "ערך נוכחי",
    costBasis: "בסיס עלות",
    weight: "משקל",
    accounts: "חשבונות",
    priceStale: "נתוני מחיר עלולים להיות ישנים",
    jobsRunning: "משימות רצות",
    editPosition: "ערוך פוזיציה",
    priceHistory: "היסטוריית מחירים",
    saveChanges: "שמור שינויים",
    noChartData: "אין נתוני גרף זמינים",
    // Summary strip
    totalValue: "ערך כולל",
    totalPL: "ר/ה כולל",
    today: "היום",
    positions: "פוזיציות",
    usdIls: "דולר/שקל",
    updatedAt: "עודכן",
    emptyAccount: "אין פוזיציות. השתמשו ב'+ הוסף פוזיציה' למעלה, או הסירו את החשבון.",
    // Strategies
    strategies: "אסטרטגיות",
    errorLoadStrategies: "טעינת האסטרטגיות נכשלה",
    emptyStrategies: "אין אסטרטגיות עדיין — הפעל דוח מלא",
    noStrategyMatches: "לא נמצאו אסטרטגיות התואמות לסינון",
    searchTicker: "חיפוש מניה...",
    searchNoResults: "לא נמצאו תוצאות עבור",
    searchLoading: "מחפש…",
    searchUnexpectedError: "קרה משהו לא צפוי.",
    searchUnexpectedErrorHelp: "נסה שוב ואם הבעיה נמשכת - פנה לעזרה דרך כפתור העזרה.",
    filterAll: "הכל",
    expiredCatalyst: "קטליזטור פג תוקף",
    strategyTabPortfolio: "בתיק",
    strategyTabNonPortfolio: "מעקב",
    colConfidence: "ביטחון",
    colTimeframe: "מסגרת זמן",
    colSize: "גודל ₪",
    colWeightPct: "משקל %",
    colReasoning: "נימוק",
    colUpdated: "עדכון",
    // Controls
    controls: "בקרה",
    activeJobs: "משימות פעילות",
    recentJobs: "משימות אחרונות",
    noJobs: "אין משימות עדיין — השתמש בכפתורים למעלה להתחיל",
    enterTicker: "מניה",
    tickerRequired: "הזן סמל מניה",
    jobDailyTitle: "סיכום יומי",
    jobDailyDesc: "הפעל סיכום יומי של תיק ההשקעות",
    jobFullTitle: "דוח מלא",
    jobFullDesc: "נתח את כל הפוזיציות",
    jobWeeklyTitle: "דוח שבועי",
    jobWeeklyDesc: "סקירת תיק מלאה עם הקשר שבועי רחב יותר",
    jobWeeklyBlockedReason: "הפיצ'ר מוצג כדי לשקף את מפת הדרך, אבל הדוח השבועי חסום כרגע בזמן שבונים מחדש את זרימת הסקירה המלאה.",
    jobDeepDiveTitle: "צלילה עמוקה",
    jobDeepDiveDesc: "ניתוח מלא למניה אחת",
    jobNewIdeasTitle: "רעיונות חדשים",
    jobNewIdeasDesc: "גילוי רעיונות וזרימת מחקר",
    jobNewIdeasBlockedReason: "רעיונות חדשים נשאר גלוי, אבל חסום כרגע עד שזרימת המחקר תהיה מוכנה לפרודקשן.",
    jobQueued: "נוסף לתור — תקבל התראה בסיום",
    jobFailed: "הפעלה נכשלה",
    jobCompleted: "הושלם",
    jobCompletedNotif: "הושלם ✓",
    jobFailedNotif: "נכשל — בדוק את הלוגים",
    // Reports
    feed: "פיד",
    reports: "דוחות",
    emptyReports: "אין דוחות עדיין",
    newerBtn: "→ חדשים",
    olderBtn: "ישנים ←",
    reportLoadError: "טעינת הדוח נכשלה",
    pageOf: "עמוד",
    // Strategy modal
    reasoning: "נימוק",
    bullCase: "תרחיש שורי",
    bearCase: "תרחיש דובי",
    entryConditions: "תנאי כניסה",
    exitConditions: "תנאי יציאה",
    catalysts: "קטליזטורים",
    noExpiry: "ללא תפוגה",
    triggered: "הופעל",
    comingSoon: "בקרוב",
    failedLoadStrategy: "טעינת האסטרטגיה נכשלה",
    runDeepDive: "🔬 הפעל צלילה עמוקה",
    strategyUpdated: "עודכן",
    // Confidence
    confidenceHigh: "גבוה",
    confidenceMedium: "בינוני",
    confidenceLow: "נמוך",
    // Timeframes
    timeframeWeek: "שבוע",
    timeframeMonths: "חודשים",
    timeframeLongTerm: "טווח ארוך",
    timeframeUndefined: "—",
    // Verdicts
    verdictBuy: "קנה",
    verdictAdd: "הוסף",
    verdictHold: "החזק",
    verdictReduce: "הפחת",
    verdictSell: "מכור",
    verdictClose: "סגור",
    // Job card
    jobInitializing: "מאתחל…",
    jobTickersComplete: "מניות הושלמו",
    jobQueued2: "נוצר בתור:",
    jobDone: "הושלם:",
    jobCompletedOk: "הושלם בהצלחה.",
    // Alerts
    alerts: "פיד",
    errorLoadAlerts: "טעינת ההתראות נכשלה",
    emptyAlerts: "עדיין אין פריטי פיד",
    alertsNeedAttention: "דורשות תשומת לב",
    alertCritical: "מכור / סגור",
    alertWarning: "הפחת",
    alertOpportunities: "קנה / הוסף",
    runNow: "הפעל עכשיו",
    escalationNeeds: "פוזיציות דורשות ניתוח עמוק",
    fullReportStarted: "ניתוח תיק מלא החל — תקבל התראה כשיסתיים",
    errorStartFullReport: "הפעלת הדוח המלא נכשלה",
    // App banner
    healthBanner: "היועץ ה-AI חווה בעיות. הדוחות עלולים להתעכב — אנא פנה לתמיכה.",
    // Onboarding
    onboardStep1Title: "הגדרת חשבון",
    onboardStep1Sub: "צור את חשבון סוכן התיק שלך",
    onboardAdminKey: "קוד גישה",
    onboardUserId: "מזהה משתמש",
    onboardPassword: "סיסמה",
    onboardConfirmPassword: "אישור סיסמה",
    onboardDisplayName: "שם תצוגה",
    onboardUserIdHint: "מזהה כניסה. לא ניתן לשינוי.",
    onboardUserIdError: "4–32 תווים: אותיות, ספרות, מקפים",
    onboardPasswordHint: "מינימום 8 תווים",
    onboardPasswordError: "מינימום 8 תווים",
    onboardPasswordMismatch: "הסיסמאות אינן תואמות",
    onboardFieldRequired: "שדה חובה",
    onboardSetPasswordTitle: "🔐 הגדר סיסמה",
    onboardSetPasswordSub: "קיבלת סיסמה זמנית מהמנהל. אנא הגדר סיסמה חדשה.",
    onboardPasswordIncorrect: "הסיסמה הנוכחית שגויה",
    onboardPasswordChangeFailed: "שינוי הסיסמה נכשל",
    onboardConnecting: "מתחבר...",
    onboardContinue: "המשך ←",
    onboardStep2Title: "⏰ לוח הזמנים שלך",
    onboardStep2Sub: "מתי להפעיל את הסיכום היומי?",
    onboardDailyBriefTime: "שעת סיכום יומי",
    onboardWeeklyDay: "יום מחקר שבועי",
    onboardWeeklyTime: "שעת מחקר שבועי",
    onboardScheduleHint: "כל השעות באזור הזמן שנבחר. סיכומים יומיים בימי חול בלבד.",
    onboardStep3Title: "🤖 חיבור טלגרם (אופציונלי)",
    onboardStep3Sub: "קבל התראות ותקשר עם הסוכן שלך דרך טלגרם.",
    onboardTelegramStep1: "1. פתח טלגרם → חפש @BotFather",
    onboardTelegramStep2: "2. שלח /newbot → עקוב אחר ההוראות",
    onboardTelegramStep3: "3. הדבק את טוקן הבוט למטה",
    onboardBotTokenHint: "פורמט: 123456789:ABC-xyz...",
    onboardChatIdHint: "קבל מ-@userinfobot בטלגרם",
    onboardSkip: "דלג לעת עתה",
    onboardConnect: "חבר והמשך ←",
    onboardBothFields: "טוקן בוט ומזהה שיחה נדרשים",
    onboardInvalidBotToken: "פורמט טוקן בוט לא תקין",
    onboardInvalidChatId: "פורמט מזהה שיחה לא תקין",
    onboardTelegramConnected: "טלגרם חובר בהצלחה!",
    onboardTelegramFailed: "חיבור הטלגרם נכשל. בדוק את הטוקן ומזהה השיחה.",
    onboardStep4Title: "תיק השקעות",
    onboardStep4Sub: "הוסף את הפוזיציות שלך בכל החשבונות",
    onboardAddPosition: "+ הוסף פוזיציה",
    onboardAddAccount: "+ הוסף חשבון",
    onboardDefaultAccount: "חשבון",
    onboardReview: "סקירה",
    onboardTickerLabel: "מניה",
    onboardSharesLabel: "כמות",
    onboardAvgPriceLabel: "מחיר שוק",
    onboardMarketPriceHint: "מחיר חי",
    onboardPriceFetching: "טוען מחיר חי…",
    onboardPriceUnavailable: "לא ניתן לטעון מחיר. נסה מניה אחרת.",
    onboardExchangeLabel: "בורסה",
    onboardDuplicateTicker: "מניה כפולה",
    onboardTickerRequired: "מניה נדרשת",
    onboardSharesError: "מספר שלם חיובי",
    onboardAvgPriceError: "מחיר נדרש",
    onboardAddPositionError: "הוסף לפחות פוזיציה אחת",
    onboardStep5Title: "אישור והשקה",
    onboardStep5Sub: "בדוק לפני ההשקה",
    onboardLaunch: "השקה ←",
    onboardLaunching: "משיק...",
    onboardSetupFailed: "ההגדרה נכשלה. בדוק את הפרטים ונסה שנית.",
    onboardStep6Title: "הכוונה לפוזיציות",
    onboardStep6Sub: "אופציונלי: הוסיפו את החשיבה שלכם לפני סבב הניתוח הראשון.",
    onboardStep6Hint: "אפשר לדלג, למלא רק כמה פוזיציות חשובות, או למלא את כולן. עוזר התיק ישתמש בזה כהקשר מובנה לסבב האסטרטגיה הראשון.",
    onboardGuidanceOptional: "הקשר אופציונלי לפוזיציה",
    onboardGuidanceThesis: "למה אתם מחזיקים אותה?",
    onboardGuidanceThesisPlaceholder: "תזה קצרה או מה לדעתכם חשוב כאן.",
    onboardGuidanceHorizon: "אופק מתוכנן",
    onboardGuidanceHorizonUnspecified: "לא מוגדר",
    onboardGuidanceHorizonDays: "ימים",
    onboardGuidanceHorizonWeeks: "שבועות",
    onboardGuidanceHorizonMonths: "חודשים",
    onboardGuidanceHorizonYears: "שנים",
    onboardGuidanceAdd: "מה יגרום לכם להוסיף?",
    onboardGuidanceAddPlaceholder: "תנאי הוספה או אישור שאתם רוצים לראות.",
    onboardGuidanceReduce: "מה יגרום לכם להפחית?",
    onboardGuidanceReducePlaceholder: "תנאי הפחתה או סיכון שמעניין אתכם.",
    onboardGuidanceNotes: "הערות נוספות",
    onboardGuidanceNotesPlaceholder: "כל דבר נוסף שסבב האסטרטגיה הראשון צריך לדעת.",
    onboardReviewAccount: "חשבון",
    onboardReviewSchedule: "לוח זמנים",
    onboardReviewTelegram: "טלגרם",
    onboardReviewPortfolio: "תיק השקעות",
    onboardTelegramYes: "✓ מחובר",
    onboardTelegramNo: "לא מחובר",
    // Admin
    adminTitle: "לוח ניהול",
    adminLoginSub: "startix.app",
    adminKeyPlaceholder: "מפתח מנהל",
    adminLoginError: "מפתח מנהל שגוי",
    adminAddUser: "הוסף משתמש",
    adminCreateUser: "צור משתמש",
    adminCreating: "יוצר...",
    adminUserCreationError: "מזהה משתמש וסיסמה נדרשים",
    adminUserCreationFailed: "יצירת המשתמש נכשלה",
    adminDeleteUser: "מחק משתמש",
    adminConfirmDelete: "מחק משתמש",
    adminUserIdLabel: "מזהה משתמש",
    adminPasswordLabel: "סיסמה",
    adminDisplayNameLabel: "שם תצוגה",
    adminTelegramSection: "טלגרם (אופציונלי)",
    adminScheduleSection: "לוח זמנים",
    adminDailyTime: "שעה יומית",
    adminWeeklyDay: "יום שבועי",
    adminWeeklyTime: "שעה שבועית",
    adminModelProfiles: "פרופילי מודל",
    adminAddProfile: "+ הוסף פרופיל",
    adminProfileName: "שם פרופיל",
    adminProfileNameHint: "לדוגמה: budget",
    adminOrchestrator: "מתאם",
    adminAnalysts: "אנליסטים",
    adminResearchers: "חוקרים",
    adminFailedLoadProfiles: "טעינת הפרופילים נכשלה",
    adminFailedUpdateProfile: "עדכון הפרופיל נכשל",
    adminFailedCreateProfile: "יצירת הפרופיל נכשלה",
    adminFailedDeleteProfile: "מחיקת הפרופיל נכשלה",
    adminFailedSwitchProfile: "החלפת הפרופיל נכשלה",
    adminConfirmDeleteProfile: "מחק פרופיל",
    adminStatusOk: "תקין",
    adminStatusError: "שגיאה ⚠",
    adminStateActive: "פעיל",
    adminStateBootstrapping: "מאתחל",
    adminStateIncomplete: "לא הושלם",
    adminPortfolioLoaded: "תיק ✓",
    adminPortfolioMissing: "תיק ✗",
    adminFailedLoadUsers: "טעינת המשתמשים נכשלה",
    adminFailedDeleteUser: "מחיקת המשתמש נכשלה",
    adminUserDeleted: "המשתמש נמחק",
    adminGateway: "שער",
    adminUsers: "משתמשים",
    adminActive: "פעילים",
    adminRunning: "🟢 פועל",
    adminStopped: "🔴 עצור",
    adminNoUsers: "אין משתמשים עדיין",
    adminTotal: "סה\"כ",
    adminSignIn: "כניסה",
    adminMax: "מקס",
    adminPer: "לכל",
    adminHrs: "שעות",
    adminRisk: "סיכון",
    adminEditTelegram: "ערוך טלגרם",
    adminAddTelegram: "הוסף טלגרם",
    adminSaveTelegram: "שמור טלגרם",
    adminEditLimits: "ערוך מגבלות",
    adminDeleting: "מוחק...",
    adminTypeToConfirm: "הקלד",
    adminToConfirmDeletion: "לאישור המחיקה:",
    adminTelegramYes: "טלגרם: ✅ מחובר",
    adminTelegramNo: "טלגרם: ✗ לא מחובר",
    adminDeepDives: "צלילות עמוקות:",
    adminFullReportsLabel: "דוחות מלאים:",
    // Onboarding additional
    onboardPosition: "פוזיציה",
    onboardPositions: "פוזיציות",
    onboardAccountSingular: "חשבון",
    onboardAcross: "על פני",
    onboardAt: "ב-",
    onboardDailyAt: "יומי ב-",
    onboardLaunchBtn: "הפעלת Startix 🚀",
    // Greetings
    greeting1: "בדיקת אסטרטגיה — בואו נראה מה דורש תשומת לב 📊",
    greeting2: "לכל פוזיציה יש סיפור. בואו נקרא את שלך 📈",
    greeting3: "תמיד צעד אחד לפני הפוזיציות שלך 🎯",
    greeting4: "מה האסטרטגיה אומרת היום? 📊",
    greeting5: "כיף שחזרת. בואו נסתנכרן 🔄",
    greeting6: "פוזיציות לא מנהלות את עצמן. אתה כאן בשביל זה 💡",
    // Today screen — pilot v1
    todayTitle: "היום",
    setupBannerTitle: "Startix מנתח את הפוזיציות שלך",
    setupBannerBodyChannelAgnostic: "נעדכן אותך כשהפעולה תסתיים.",
    setupBannerBodyTelegram: "נעדכן אותך בטלגרם כשהפעולה תסתיים.",
    setupBannerProgress: "נותחו {analyzed} מתוך {total} פוזיציות",
    setupBannerInProgress: "{tickers} בתהליך",
    healthLabelHealthy: "בריא",
    healthLabelSteady: "יציב",
    healthLabelWatch: "מעקב",
    healthHeroSummary: "{clear} מתוך {total} תקין · נבדק {timeAgo}",
    attentionHeader: "{count} דורשות תשומת לב",
    attentionClearSuffix: "{count} תקינות",
    factoidEarningsInDays: "דוחות בעוד {days} ימים",
    factoidCatalystInDays: "קטליזטור בעוד {days} ימים",
    factoidReviewDue: "סקירה בעוד {days} ימים",
    factoidFreshReview: "סקירה עדכנית · קטליזטור {date}",
    factoidThesisOnTrack: "התזה על המסלול",
    whyTodayHeader: "למה זה הופיע היום",
    whyTodayCatalystExpired: "{description} פג לפני {days} ימים",
    whyTodaySellClose: "{verdict} · {reasoning}",
    whyTodayReduce: "צמצם · {reasoning}",
    whyTodayMarkedForAttention: "סומן לתשומת לב",
    scoreChipAria: "ציון בריאות {score} מתוך 100",
    noClearPositions: "כל הפוזיציות דורשות תשומת לב.",
  },
};

export function t(key: TranslationKey, language: Language): string {
  return translations[language][key] ?? translations.en[key] ?? key;
}

/**
 * Substitute {name}-style placeholders in a translated template.
 * Unknown placeholders are left intact (visible in dev) rather than blanked.
 */
export function tInterpolate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

export function tConfidence(confidence: string, language: Language): string {
  if (confidence === "high") return t("confidenceHigh", language);
  if (confidence === "medium") return t("confidenceMedium", language);
  if (confidence === "low") return t("confidenceLow", language);
  return confidence;
}

export function tTimeframe(timeframe: string, language: Language): string {
  if (timeframe === "week") return t("timeframeWeek", language);
  if (timeframe === "months") return t("timeframeMonths", language);
  if (timeframe === "long_term") return t("timeframeLongTerm", language);
  if (timeframe === "undefined") return t("timeframeUndefined", language);
  return timeframe;
}

export function getGreeting(name: string | null | undefined, language: Language): string {
  const keys: TranslationKey[] = ["greeting1", "greeting2", "greeting3", "greeting4", "greeting5", "greeting6"];
  const randomKey = keys[Math.floor(Math.random() * keys.length)]!;
  const phrase = t(randomKey, language);
  if (!name) return phrase;
  if (language === "he") return `שלום ${name} — ${phrase}`;
  return `Hello ${name} — ${phrase}`;
}
