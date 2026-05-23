from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


TickerPattern = r"^[A-Z0-9.]{1,12}$"
ConversationIdPattern = r"^[A-Za-z0-9_-]{1,64}$"

JobAction = Literal[
    "daily_brief",
    "full_report",
    "deep_dive",
    "new_ideas",
    "quick_check",
    "switch_production",
    "switch_testing",
]
JobStatus = Literal[
    "pending",
    "paused",
    "running",
    "completed",
    "partial_completed",
    "failed",
    "cancelled",
    "superseded",
]
Verdict = Literal["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"]
Confidence = Literal["high", "medium", "low"]
ConversationRole = Literal["user", "assistant", "tool_result"]
JsonValue = Any


class ScheduleInput(BaseModel):
    dailyBriefTime: str = "08:00"
    weeklyResearchDay: str = "sunday"
    weeklyResearchTime: str = "19:00"
    timezone: str = "Asia/Jerusalem"


class PositionInput(BaseModel):
    ticker: str = Field(pattern=TickerPattern)
    exchange: Literal["TASE", "NYSE", "NASDAQ", "LSE", "XETRA", "EURONEXT", "OTHER"]
    shares: int = Field(gt=0)
    unitAvgBuyPrice: float = Field(gt=0)
    unitCurrency: Literal["USD", "ILA", "GBP", "EUR"]

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        return value.strip().upper()


class PositionGuidanceInput(BaseModel):
    thesis: str = Field(default="", max_length=400)
    horizon: Literal["unspecified", "days", "weeks", "months", "years"] = "unspecified"
    addOn: str = Field(default="", max_length=300)
    reduceOn: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=600)


class BootstrapStartRequest(BaseModel):
    userId: str = Field(min_length=1, max_length=64)
    displayName: str | None = Field(default=None, max_length=50)
    accounts: dict[str, list[PositionInput]]
    guidance: dict[str, PositionGuidanceInput] = Field(default_factory=dict)
    schedule: ScheduleInput = Field(default_factory=ScheduleInput)
    currency: Literal["ILS"] = "ILS"
    transactionFeeILS: float = 0
    note: str = ""

    @field_validator("accounts")
    @classmethod
    def require_accounts(cls, value: dict[str, list[PositionInput]]) -> dict[str, list[PositionInput]]:
        if not value:
            raise ValueError("At least one account is required")
        non_empty = {name: positions for name, positions in value.items() if positions}
        if not non_empty:
            raise ValueError("At least one position is required")
        return non_empty


class StrategyCatalyst(BaseModel):
    description: str = Field(max_length=300)
    expiresAt: str | None = None
    triggered: bool = False


class ResearchEvidence(BaseModel):
    supporting: list[str] = Field(default_factory=list)
    conflicting: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)


class TickerStrategyDraft(BaseModel):
    ticker: str = Field(pattern=TickerPattern)
    thesis: str = Field(max_length=280)
    verdict: Verdict
    confidence: Confidence
    catalysts: list[StrategyCatalyst] = Field(default_factory=list, max_length=10)
    timeframe: Literal["week", "months", "years", "long_term", "undefined"] = "months"
    bull_case: str | None = Field(default=None, max_length=600)
    bear_case: str | None = Field(default=None, max_length=600)
    key_risks: list[str] = Field(default_factory=list, max_length=8)
    invalidation_conditions: list[str] = Field(default_factory=list, max_length=8)
    evidence_summary: ResearchEvidence = Field(default_factory=ResearchEvidence)
    reasoning: str = Field(max_length=800)
    analyst_reports: dict[str, dict[str, Any]] = Field(default_factory=dict)


class BootstrapTickerState(BaseModel):
    ticker: str
    status: Literal["pending", "running", "completed", "failed"] = "pending"
    currentStep: str | None = None
    failureReason: str | None = None
    strategy: TickerStrategyDraft | None = None


class BootstrapJobState(BaseModel):
    jobId: str
    userId: str
    status: Literal["pending", "running", "completed", "failed", "partial_completed"] = "pending"
    createdAt: str
    startedAt: str | None = None
    completedAt: str | None = None
    progressPct: int = 0
    totalTickers: int
    completedTickers: list[str] = Field(default_factory=list)
    failedTickers: list[str] = Field(default_factory=list)
    currentTicker: str | None = None
    currentStep: str | None = None
    tickers: list[BootstrapTickerState]
    error: str | None = None


class BootstrapStartResponse(BaseModel):
    jobId: str
    status: str
    totalTickers: int


class BootstrapJobResult(BaseModel):
    jobId: str
    userId: str
    status: str
    strategies: list[TickerStrategyDraft]
    completedAt: str | None = None


class JobProgress(BaseModel):
    pct: int = 0
    currentTicker: str | None = None
    currentStep: str | None = None
    completedTickers: list[str] = Field(default_factory=list)
    remainingTickers: list[str] = Field(default_factory=list)
    totalTickers: int = 0
    completedSteps: int = 0
    totalSteps: int = 0


class JobRecord(BaseModel):
    id: str
    action: JobAction
    ticker: str | None = None
    status: JobStatus
    triggered_at: str
    started_at: str | None = None
    completed_at: str | None = None
    result: JsonValue = None
    error: str | None = None
    progress: JobProgress | None = None
    source: str | None = "dashboard_action"
    budget_admitted_at: str | None = None
    user_id: str | None = None
    tickers: list[str] = Field(default_factory=list)


class JobsResponse(BaseModel):
    jobs: list[JobRecord]


class TriggerJobRequest(BaseModel):
    action: JobAction
    ticker: str | None = None

    @field_validator("ticker")
    @classmethod
    def normalize_optional_ticker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().upper()


class TriggerResponse(BaseModel):
    jobId: str
    job: JobRecord


class ChatMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    conversationId: str | None = Field(default=None, pattern=ConversationIdPattern)


class ChatMessageResponse(BaseModel):
    conversationId: str
    replyText: str
    terminationReason: str
    totalCostUsd: float
    turnCount: int


class ConversationCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)


class ConversationRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class SavedConversation(BaseModel):
    id: str = Field(pattern=ConversationIdPattern)
    userId: str
    channel: str = "dashboard"
    title: str | None = None
    startedAt: str
    updatedAt: str
    lastActivityAt: str
    archivedAt: str | None = None
    expiresAt: str | None = None
    endedAt: str | None = None
    turnCount: int = 0
    totalTokensIn: int = 0
    totalTokensOut: int = 0
    totalCostUsd: float = 0
    terminationReason: str | None = None
    toolCallCount: int = 0
    model: str | None = None
    accessState: Literal["active", "archived", "expired"] = "active"
    isArchived: bool = False
    isExpired: bool = False


class ConversationTurn(BaseModel):
    conversationId: str = Field(pattern=ConversationIdPattern)
    turnIndex: int = Field(ge=0)
    role: ConversationRole | str
    content: Any
    model: str | None = None
    tokensIn: int = 0
    tokensOut: int = 0
    costUsd: float = 0
    latencyMs: int = 0
    createdAt: str


class SavedConversationListResponse(BaseModel):
    items: list[SavedConversation]
    limit: int
    offset: int


class SavedConversationResponse(BaseModel):
    conversation: SavedConversation


class ConversationHistory(BaseModel):
    conversation: SavedConversation
    turns: list[ConversationTurn]


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
