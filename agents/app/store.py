"""All Postgres data access for the agents service."""

from __future__ import annotations

import json
import uuid
from datetime import timezone
from typing import Any

from agents.app.db import execute, fetch_all, fetch_one
from agents.app.schemas import (
    BootstrapJobState,
    BootstrapStartRequest,
    BootstrapTickerState,
    ConversationHistory,
    ConversationTurn,
    JobProgress,
    JobRecord,
    JobsResponse,
    SavedConversation,
    TickerStrategyDraft,
    utc_now,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _ts(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "strftime"):
        if hasattr(value, "tzinfo") and value.tzinfo is not None:
            return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value)


def _normalize_lifecycle(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    onboarding = raw.get("onboarding")
    if not isinstance(onboarding, dict):
        onboarding = {}
    return {
        "lastFullReportAt": raw.get("lastFullReportAt"),
        "lastDailyAt": raw.get("lastDailyAt"),
        "pendingDeepDives": list(raw.get("pendingDeepDives") or []),
        "bootstrapProgress": raw.get("bootstrapProgress"),
        "onboarding": {
            "portfolioSubmittedAt": onboarding.get("portfolioSubmittedAt"),
            "positionGuidanceStatus": onboarding.get("positionGuidanceStatus") or "not_started",
            "positionGuidance": onboarding.get("positionGuidance") if isinstance(onboarding.get("positionGuidance"), dict) else {},
        },
    }


# ── User / bootstrap ──────────────────────────────────────────────────────────


def upsert_user(user_id: str, display_name: str, schedule: dict, guidance: dict | None = None) -> None:
    current = fetch_one("SELECT lifecycle FROM users WHERE user_id = %s", (user_id,))
    lifecycle = _normalize_lifecycle(current.get("lifecycle") if current else None)
    onboarding = lifecycle["onboarding"]
    onboarding["portfolioSubmittedAt"] = onboarding.get("portfolioSubmittedAt") or utc_now()
    if guidance is not None:
        onboarding["positionGuidance"] = guidance
        onboarding["positionGuidanceStatus"] = "completed" if guidance else "skipped"
    execute(
        """
        INSERT INTO users (user_id, display_name, password_hash, schedule, lifecycle, state)
        VALUES (%s, %s, '', %s::jsonb, %s::jsonb, 'BOOTSTRAPPING')
        ON CONFLICT (user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          schedule = EXCLUDED.schedule,
          lifecycle = EXCLUDED.lifecycle,
          state = 'BOOTSTRAPPING',
          updated_at = NOW()
        """,
        (user_id, display_name, json.dumps(schedule), json.dumps(lifecycle)),
    )


def save_bootstrap_progress(user_id: str, total_tickers: int, completed_tickers: list[str]) -> None:
    row = fetch_one("SELECT lifecycle FROM users WHERE user_id = %s", (user_id,))
    lifecycle = _normalize_lifecycle(row.get("lifecycle") if row else None)
    lifecycle["bootstrapProgress"] = {
        "total": total_tickers,
        "completed": len(completed_tickers),
        "completedTickers": completed_tickers,
    }
    onboarding = lifecycle["onboarding"]
    if onboarding.get("positionGuidanceStatus") == "not_started":
        onboarding["positionGuidanceStatus"] = "completed" if onboarding.get("positionGuidance") else "skipped"
    execute(
        """
        UPDATE users
        SET state = 'BOOTSTRAPPING', lifecycle = %s::jsonb, updated_at = NOW()
        WHERE user_id = %s
        """,
        (json.dumps(lifecycle), user_id),
    )


def finish_bootstrap(user_id: str, completed_tickers: list[str], failed_tickers: list[str]) -> None:
    row = fetch_one("SELECT lifecycle FROM users WHERE user_id = %s", (user_id,))
    lifecycle = _normalize_lifecycle(row.get("lifecycle") if row else None)
    pending = set(lifecycle["pendingDeepDives"])
    pending.update(failed_tickers)
    lifecycle["pendingDeepDives"] = sorted(pending)
    lifecycle["bootstrapProgress"] = None
    onboarding = lifecycle["onboarding"]
    if onboarding.get("positionGuidanceStatus") == "not_started":
        onboarding["positionGuidanceStatus"] = "completed" if onboarding.get("positionGuidance") else "skipped"
    next_state = "ACTIVE" if completed_tickers else "INCOMPLETE"
    execute(
        """
        UPDATE users
        SET state = %s, lifecycle = %s::jsonb, updated_at = NOW()
        WHERE user_id = %s
        """,
        (next_state, json.dumps(lifecycle), user_id),
    )


def upsert_portfolio(user_id: str, body: dict) -> None:
    execute(
        """
        INSERT INTO user_portfolios (user_id, body, updated_at)
        VALUES (%s, %s::jsonb, NOW())
        ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
        """,
        (user_id, json.dumps(body)),
    )


def load_portfolio(user_id: str) -> dict[str, list[dict]]:
    row = fetch_one("SELECT body FROM user_portfolios WHERE user_id = %s", (user_id,))
    if not row:
        return {}
    body = row["body"]
    accounts = body.get("accounts") if isinstance(body, dict) else {}
    return accounts if isinstance(accounts, dict) else {}


def load_position_lookup(user_id: str) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for account_name, positions in load_portfolio(user_id).items():
        if not isinstance(positions, list):
            continue
        for raw in positions:
            if not isinstance(raw, dict):
                continue
            ticker = str(raw.get("ticker", "")).strip().upper()
            if ticker and ticker not in lookup:
                lookup[ticker] = {**raw, "ticker": ticker, "account": account_name}
    return lookup


def load_guidance(user_id: str) -> dict[str, dict]:
    row = fetch_one("SELECT lifecycle FROM users WHERE user_id = %s", (user_id,))
    if not row or not row.get("lifecycle"):
        return {}
    lifecycle = row["lifecycle"]
    if not isinstance(lifecycle, dict):
        return {}
    onboarding = lifecycle.get("onboarding")
    if not isinstance(onboarding, dict):
        return {}
    guidance = onboarding.get("positionGuidance")
    return guidance if isinstance(guidance, dict) else {}


# ── Strategies ────────────────────────────────────────────────────────────────


def upsert_strategy(user_id: str, ticker: str, draft: TickerStrategyDraft, *, guidance_applied: bool) -> None:
    execute(
        """
        INSERT INTO strategies (
          user_id, ticker, verdict, confidence, reasoning, timeframe,
          position_size_ils, position_weight_pct,
          bull_case, bear_case, catalysts, exit_conditions, metadata
        ) VALUES (%s, %s, %s, %s, %s, %s, 0, 0, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
        ON CONFLICT (user_id, ticker) DO UPDATE SET
          verdict = EXCLUDED.verdict,
          confidence = EXCLUDED.confidence,
          reasoning = EXCLUDED.reasoning,
          timeframe = EXCLUDED.timeframe,
          bull_case = EXCLUDED.bull_case,
          bear_case = EXCLUDED.bear_case,
          catalysts = EXCLUDED.catalysts,
          exit_conditions = EXCLUDED.exit_conditions,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        """,
        (
            user_id, ticker.upper(),
            draft.verdict, draft.confidence, draft.reasoning, draft.timeframe,
            draft.bull_case, draft.bear_case,
            json.dumps([c.model_dump() for c in draft.catalysts]),
            json.dumps(draft.invalidation_conditions[:5]),
            json.dumps(
                {
                    "source": "bootstrap",
                    "status": "provisional",
                    "generatedAt": utc_now(),
                    "userGuidanceApplied": guidance_applied,
                }
            ),
        ),
    )


def upsert_report_artifact(user_id: str, ticker: str, artifact_key: str, payload: dict) -> None:
    execute(
        """
        INSERT INTO report_artifacts (user_id, ticker, artifact_key, payload, updated_at)
        VALUES (%s, %s, %s, %s::jsonb, NOW())
        ON CONFLICT (user_id, ticker, artifact_key) DO UPDATE SET
          payload = EXCLUDED.payload, updated_at = NOW()
        """,
        (user_id, ticker.upper(), artifact_key, json.dumps(payload)),
    )


def list_strategies(user_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT ticker, verdict, confidence, reasoning, timeframe,
               bull_case, bear_case, catalysts, updated_at
        FROM strategies WHERE user_id = %s ORDER BY updated_at DESC
        """,
        (user_id,),
    )
    return [
        {
            "ticker": r["ticker"],
            "verdict": r["verdict"],
            "confidence": r["confidence"],
            "reasoning": r["reasoning"],
            "timeframe": r["timeframe"],
            "bullCase": r.get("bull_case"),
            "bearCase": r.get("bear_case"),
            "catalysts": r.get("catalysts") or [],
            "updatedAt": _ts(r.get("updated_at")),
        }
        for r in rows
    ]


def load_strategy(user_id: str, ticker: str) -> dict | None:
    row = fetch_one(
        "SELECT payload FROM report_artifacts WHERE user_id = %s AND ticker = %s AND artifact_key = 'strategy'",
        (user_id, ticker.upper()),
    )
    if row and isinstance(row["payload"], dict):
        return row["payload"]
    s = fetch_one(
        "SELECT ticker, verdict, confidence, reasoning, timeframe, bull_case, bear_case FROM strategies WHERE user_id = %s AND ticker = %s",
        (user_id, ticker.upper()),
    )
    if not s:
        return None
    return {
        "ticker": s["ticker"],
        "verdict": s["verdict"],
        "confidence": s["confidence"],
        "reasoning": s["reasoning"],
        "timeframe": s["timeframe"],
        "bullCase": s.get("bull_case"),
        "bearCase": s.get("bear_case"),
    }


def list_report_summaries(user_id: str, limit: int = 5) -> list[dict]:
    rows = fetch_all(
        """
        SELECT payload FROM report_artifacts
        WHERE user_id = %s AND artifact_key IN ('strategy', 'synthesis')
        ORDER BY updated_at DESC LIMIT %s
        """,
        (user_id, limit),
    )
    return [r["payload"] for r in rows if isinstance(r.get("payload"), dict)]


# ── Bootstrap jobs ────────────────────────────────────────────────────────────


def create_bootstrap_job(user_id: str, payload: BootstrapStartRequest) -> BootstrapJobState:
    tickers = sorted({
        position.ticker
        for positions in payload.accounts.values()
        for position in positions
    })
    now = utc_now()
    job_id = f"job_py_bootstrap_{user_id}_{now.replace(':', '').replace('-', '')}"
    job = BootstrapJobState(
        jobId=job_id, userId=user_id, status="pending", createdAt=now,
        totalTickers=len(tickers),
        tickers=[BootstrapTickerState(ticker=t) for t in tickers],
    )
    execute(
        """
        INSERT INTO jobs (id, user_id, action, status, source, model_tier, triggered_at, result)
        VALUES (%s, %s, 'full_report', 'pending', 'bootstrap', 'balanced', NOW(), %s::jsonb)
        ON CONFLICT (id) DO NOTHING
        """,
        (job_id, user_id, json.dumps(job.model_dump())),
    )
    return job


def save_bootstrap_job(job: BootstrapJobState) -> None:
    execute(
        """
        UPDATE jobs SET status = %s, started_at = %s, completed_at = %s,
          failure_reason = %s, result = %s::jsonb
        WHERE id = %s
        """,
        (
            job.status, job.startedAt, job.completedAt, job.error,
            json.dumps(job.model_dump()), job.jobId,
        ),
    )


def load_bootstrap_job(user_id: str, job_id: str) -> BootstrapJobState:
    row = fetch_one("SELECT result FROM jobs WHERE id = %s AND user_id = %s", (job_id, user_id))
    if not row or not row.get("result"):
        raise FileNotFoundError(f"Bootstrap job not found: {job_id}")
    return BootstrapJobState.model_validate(row["result"])


def find_active_bootstrap_job(user_id: str) -> BootstrapJobState | None:
    row = fetch_one(
        """
        SELECT result
        FROM jobs
        WHERE user_id = %s
          AND source = 'bootstrap'
          AND action = 'full_report'
          AND status IN ('pending', 'running')
        ORDER BY triggered_at DESC
        LIMIT 1
        """,
        (user_id,),
    )
    if not row or not row.get("result"):
        return None
    return BootstrapJobState.model_validate(row["result"])


# ── Analysis jobs ─────────────────────────────────────────────────────────────


def create_job(user_id: str, action: str, ticker: str | None, tickers: list[str]) -> JobRecord:
    job_id = f"job_py_{uuid.uuid4().hex[:12]}"
    progress = JobProgress(
        pct=0, currentTicker=ticker, currentStep="queued",
        completedTickers=[], remainingTickers=tickers.copy(),
        totalTickers=len(tickers), completedSteps=0, totalSteps=len(tickers),
    )
    job = JobRecord(
        id=job_id, action=action, ticker=ticker, status="pending",
        triggered_at=utc_now(), user_id=user_id, tickers=tickers, progress=progress,
    )
    extra = {"ticker": ticker, "tickers": tickers, "progress": progress.model_dump()}
    execute(
        """
        INSERT INTO jobs (id, user_id, action, status, source, model_tier, triggered_at, result)
        VALUES (%s, %s, %s, 'pending', 'dashboard_action', 'balanced', NOW(), %s::jsonb)
        """,
        (job_id, user_id, action, json.dumps(extra)),
    )
    return job


def write_job(job: JobRecord) -> None:
    extra = {
        "ticker": job.ticker,
        "tickers": job.tickers,
        "progress": job.progress.model_dump() if job.progress else None,
        "result": job.result,
    }
    execute(
        """
        UPDATE jobs SET status = %s, started_at = %s, completed_at = %s,
          failure_reason = %s, result = %s::jsonb
        WHERE id = %s
        """,
        (job.status, job.started_at, job.completed_at, job.error, json.dumps(extra), job.id),
    )


def read_job(user_id: str, job_id: str) -> JobRecord:
    row = fetch_one(
        "SELECT id, user_id, action, status, triggered_at, started_at, completed_at, failure_reason, result, source FROM jobs WHERE id = %s AND user_id = %s",
        (job_id, user_id),
    )
    if not row:
        raise FileNotFoundError(f"Job not found: {job_id}")
    return _row_to_job(row)


def list_jobs(user_id: str, limit: int = 50) -> JobsResponse:
    rows = fetch_all(
        "SELECT id, user_id, action, status, triggered_at, started_at, completed_at, failure_reason, result, source FROM jobs WHERE user_id = %s ORDER BY triggered_at DESC LIMIT %s",
        (user_id, limit),
    )
    return JobsResponse(jobs=[_row_to_job(r) for r in rows])


def _row_to_job(row: dict) -> JobRecord:
    extra = row.get("result") or {}
    if not isinstance(extra, dict):
        extra = {}
    progress_raw = extra.get("progress")
    progress = JobProgress.model_validate(progress_raw) if progress_raw else None
    return JobRecord(
        id=row["id"],
        action=row["action"],
        ticker=extra.get("ticker"),
        status=row["status"],
        triggered_at=_ts(row["triggered_at"]) or utc_now(),
        started_at=_ts(row.get("started_at")),
        completed_at=_ts(row.get("completed_at")),
        result=extra.get("result"),
        error=row.get("failure_reason"),
        progress=progress,
        source=row.get("source"),
        user_id=row["user_id"],
        tickers=extra.get("tickers") or [],
    )


# ── Conversations ─────────────────────────────────────────────────────────────


def create_conversation(user_id: str, title: str | None) -> SavedConversation:
    conv_id = f"conv_{uuid.uuid4().hex[:12]}"
    execute(
        "INSERT INTO conversations (id, user_id, channel, title, started_at, updated_at) VALUES (%s, %s, 'dashboard', %s, NOW(), NOW())",
        (conv_id, user_id, title),
    )
    now = utc_now()
    return SavedConversation(
        id=conv_id, userId=user_id, title=title,
        startedAt=now, updatedAt=now, lastActivityAt=now,
    )


def list_conversations(user_id: str, limit: int, offset: int) -> list[SavedConversation]:
    rows = fetch_all(
        """
        SELECT id, user_id, channel, title, started_at, updated_at,
               archived_at, expires_at, ended_at, turn_count,
               total_tokens_in, total_tokens_out, total_cost_usd,
               termination_reason, tool_call_count, model
        FROM conversations
        WHERE user_id = %s AND archived_at IS NULL
        ORDER BY updated_at DESC LIMIT %s OFFSET %s
        """,
        (user_id, limit, offset),
    )
    return [_row_to_conversation(r) for r in rows]


def load_conversation(user_id: str, conv_id: str) -> ConversationHistory:
    row = fetch_one(
        """
        SELECT id, user_id, channel, title, started_at, updated_at,
               archived_at, expires_at, ended_at, turn_count,
               total_tokens_in, total_tokens_out, total_cost_usd,
               termination_reason, tool_call_count, model
        FROM conversations WHERE id = %s AND user_id = %s
        """,
        (conv_id, user_id),
    )
    if not row:
        raise FileNotFoundError(f"Conversation not found: {conv_id}")
    turn_rows = fetch_all(
        "SELECT conversation_id, turn_index, role, content, model, tokens_in, tokens_out, cost_usd, latency_ms, created_at FROM conversation_turns WHERE conversation_id = %s ORDER BY turn_index",
        (conv_id,),
    )
    return ConversationHistory(conversation=_row_to_conversation(row), turns=[_row_to_turn(r) for r in turn_rows])


def append_turns(
    user_id: str,
    conv_id: str,
    turns: list[ConversationTurn],
    *,
    model: str | None,
    cost_usd: float,
    tool_call_count: int,
) -> ConversationHistory:
    for turn in turns:
        execute(
            """
            INSERT INTO conversation_turns
              (conversation_id, turn_index, role, content, model, tokens_in, tokens_out, cost_usd, latency_ms)
            VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
            ON CONFLICT (conversation_id, turn_index) DO NOTHING
            """,
            (
                conv_id, turn.turnIndex, turn.role,
                json.dumps(turn.content),
                turn.model, turn.tokensIn, turn.tokensOut, turn.costUsd, turn.latencyMs,
            ),
        )
    ua_count = sum(1 for t in turns if t.role in {"user", "assistant"})
    execute(
        """
        UPDATE conversations SET
          turn_count = turn_count + %s,
          total_cost_usd = total_cost_usd + %s,
          tool_call_count = tool_call_count + %s,
          model = COALESCE(%s, model),
          updated_at = NOW()
        WHERE id = %s
        """,
        (ua_count, cost_usd, tool_call_count, model, conv_id),
    )
    return load_conversation(user_id, conv_id)


def rename_conversation(user_id: str, conv_id: str, title: str) -> SavedConversation:
    execute(
        "UPDATE conversations SET title = %s, updated_at = NOW() WHERE id = %s AND user_id = %s",
        (title, conv_id, user_id),
    )
    row = fetch_one(
        "SELECT id, user_id, channel, title, started_at, updated_at, archived_at, expires_at, ended_at, turn_count, total_tokens_in, total_tokens_out, total_cost_usd, termination_reason, tool_call_count, model FROM conversations WHERE id = %s",
        (conv_id,),
    )
    if not row:
        raise FileNotFoundError(f"Conversation not found: {conv_id}")
    return _row_to_conversation(row)


def archive_conversation(user_id: str, conv_id: str) -> SavedConversation:
    execute(
        "UPDATE conversations SET archived_at = NOW(), updated_at = NOW() WHERE id = %s AND user_id = %s",
        (conv_id, user_id),
    )
    row = fetch_one(
        "SELECT id, user_id, channel, title, started_at, updated_at, archived_at, expires_at, ended_at, turn_count, total_tokens_in, total_tokens_out, total_cost_usd, termination_reason, tool_call_count, model FROM conversations WHERE id = %s",
        (conv_id,),
    )
    if not row:
        raise FileNotFoundError(f"Conversation not found: {conv_id}")
    return _row_to_conversation(row)


def set_termination_reason(conv_id: str, reason: str) -> None:
    execute("UPDATE conversations SET termination_reason = %s WHERE id = %s", (reason, conv_id))


def _row_to_conversation(row: dict) -> SavedConversation:
    archived = _ts(row.get("archived_at"))
    updated = _ts(row.get("updated_at")) or utc_now()
    return SavedConversation(
        id=row["id"],
        userId=row["user_id"],
        channel=row.get("channel", "dashboard"),
        title=row.get("title"),
        startedAt=_ts(row.get("started_at")) or updated,
        updatedAt=updated,
        lastActivityAt=updated,
        archivedAt=archived,
        expiresAt=_ts(row.get("expires_at")),
        endedAt=_ts(row.get("ended_at")),
        turnCount=row.get("turn_count") or 0,
        totalTokensIn=row.get("total_tokens_in") or 0,
        totalTokensOut=row.get("total_tokens_out") or 0,
        totalCostUsd=float(row.get("total_cost_usd") or 0),
        terminationReason=row.get("termination_reason"),
        toolCallCount=row.get("tool_call_count") or 0,
        model=row.get("model"),
        accessState="archived" if archived else "active",
        isArchived=archived is not None,
    )


def _row_to_turn(row: dict) -> ConversationTurn:
    content = row["content"]
    return ConversationTurn(
        conversationId=row["conversation_id"],
        turnIndex=row["turn_index"],
        role=row["role"],
        content=content,
        model=row.get("model"),
        tokensIn=row.get("tokens_in") or 0,
        tokensOut=row.get("tokens_out") or 0,
        costUsd=float(row.get("cost_usd") or 0),
        latencyMs=row.get("latency_ms") or 0,
        createdAt=_ts(row.get("created_at")) or utc_now(),
    )
