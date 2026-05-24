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
    ChatMemoryEntry,
    ConversationHistory,
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
    now = utc_now()
    catalysts = [c.model_dump() for c in draft.catalysts]
    entry_conditions: list[str] = []
    exit_conditions = draft.invalidation_conditions[:5]
    avoid_conditions = draft.key_risks[:5]
    metadata = {
        "source": "bootstrap",
        "status": "provisional",
        "generatedAt": now,
        "userGuidanceApplied": guidance_applied,
    }
    execute(
        """
        INSERT INTO strategies (
          user_id, ticker, asset_scope, verdict, confidence, reasoning, timeframe,
          position_size_ils, position_weight_pct, entry_conditions, exit_conditions,
          catalysts, bull_case, bear_case, last_deep_dive_at, metadata,
          action_catalysts, avoid_conditions, asset_class
        ) VALUES (
          %s, %s, 'portfolio', %s, %s, %s, %s, 0, 0, %s::jsonb, %s::jsonb,
          %s::jsonb, %s, %s, %s, %s::jsonb, '[]'::jsonb, %s::jsonb, 'equity'
        )
        ON CONFLICT (user_id, ticker) DO UPDATE SET
          asset_scope = EXCLUDED.asset_scope,
          verdict = EXCLUDED.verdict,
          confidence = EXCLUDED.confidence,
          reasoning = EXCLUDED.reasoning,
          timeframe = EXCLUDED.timeframe,
          entry_conditions = EXCLUDED.entry_conditions,
          bull_case = EXCLUDED.bull_case,
          bear_case = EXCLUDED.bear_case,
          catalysts = EXCLUDED.catalysts,
          exit_conditions = EXCLUDED.exit_conditions,
          last_deep_dive_at = EXCLUDED.last_deep_dive_at,
          metadata = EXCLUDED.metadata,
          action_catalysts = EXCLUDED.action_catalysts,
          avoid_conditions = EXCLUDED.avoid_conditions,
          updated_at = NOW()
        """,
        (
            user_id, ticker.upper(),
            draft.verdict, draft.confidence, draft.reasoning, draft.timeframe,
            json.dumps(entry_conditions),
            json.dumps(exit_conditions),
            json.dumps(catalysts),
            draft.bull_case,
            draft.bear_case,
            now,
            json.dumps(metadata),
            json.dumps(avoid_conditions),
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


def load_active_user_schedules() -> list[tuple[str, dict]]:
    rows = fetch_all("SELECT user_id, schedule FROM users WHERE state = 'ACTIVE'")
    return [(r["user_id"], r["schedule"] or {}) for r in rows]


def was_daily_brief_run_today(user_id: str) -> bool:
    """True if a daily_brief is already pending/running/done within the last 23 hours."""
    row = fetch_one(
        """
        SELECT 1 FROM jobs
        WHERE user_id = %s
          AND action = 'daily_brief'
          AND status IN ('pending', 'running', 'completed', 'partial_completed')
          AND triggered_at > NOW() - INTERVAL '23 hours'
        LIMIT 1
        """,
        (user_id,),
    )
    return row is not None


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


def write_analysis_artifacts(
    user_id: str,
    action: str,
    ticker: str,
    strategy: TickerStrategyDraft,
) -> None:
    now = utc_now()
    strategy_payload = {
        "ticker": ticker,
        "verdict": strategy.verdict,
        "confidence": strategy.confidence,
        "reasoning": strategy.reasoning,
        "timeframe": strategy.timeframe,
        "entryConditions": [],
        "exitConditions": strategy.invalidation_conditions[:5],
        "catalysts": [c.model_dump() for c in strategy.catalysts],
        "bullCase": strategy.bull_case,
        "bearCase": strategy.bear_case,
        "updatedAt": now,
    }
    upsert_report_artifact(user_id, ticker, "strategy", strategy_payload)

    quick_check_payload = {
        "score": None,
        "decision": "escalate" if strategy.verdict in {"REDUCE", "SELL", "CLOSE"} else "safe",
        "signals": [strategy.verdict, strategy.confidence, strategy.timeframe],
        "strategy_health": strategy.invalidation_conditions[:3] or strategy.key_risks[:3],
        "advisor_summary": strategy.reasoning,
        "advisor_reasons": strategy.evidence_summary.supporting[:3] + strategy.evidence_summary.conflicting[:2],
        "escalation_reason": strategy.key_risks[0] if strategy.key_risks else None,
        "updatedAt": now,
        "sourceAction": action,
    }
    upsert_report_artifact(user_id, ticker, "quick_check", quick_check_payload)

    for artifact_key in ("fundamentals", "technical", "sentiment", "macro", "risk"):
        report_payload = strategy.analyst_reports.get(artifact_key)
        if isinstance(report_payload, dict) and report_payload:
            upsert_report_artifact(user_id, ticker, artifact_key, report_payload)

    if strategy.bull_case:
        upsert_report_artifact(
            user_id,
            ticker,
            "bull_case",
            {"coreThesis": strategy.bull_case, "arguments": [], "round": 1},
        )
    if strategy.bear_case:
        upsert_report_artifact(
            user_id,
            ticker,
            "bear_case",
            {"coreConcern": strategy.bear_case, "arguments": [], "round": 1},
        )


def build_job_batch(job: JobRecord, strategies: list[TickerStrategyDraft], completed: list[str]) -> dict[str, Any] | None:
    if not strategies or not completed:
        return None

    entries: dict[str, dict[str, Any]] = {}
    for strategy in strategies:
        ticker = strategy.ticker.strip().upper()
        entries[ticker] = {
            "ticker": ticker,
            "mode": job.action,
            "verdict": strategy.verdict,
            "confidence": strategy.confidence,
            "reasoning": strategy.reasoning,
            "timeframe": strategy.timeframe,
            "analystTypes": (
                ["quick_check"]
                if job.action in {"quick_check", "daily_brief", "full_report"}
                else [k for k in ("fundamentals", "technical", "sentiment", "macro", "risk") if k in strategy.analyst_reports]
            ),
            "hasBullCase": bool(strategy.bull_case),
            "hasBearCase": bool(strategy.bear_case),
        }

    highlights = [
        f"{item.ticker} {item.verdict} ({item.confidence})"
        for item in strategies[:3]
    ]
    summary = None
    if job.action == "daily_brief":
        summary = {
            "headline": f"Daily brief completed across {len(completed)} position{'s' if len(completed) != 1 else ''}.",
            "today": "; ".join(highlights[:2]) if highlights else None,
            "tomorrow": None,
            "marketView": None,
            "securityNote": None,
            "dashboardPath": "/reports",
        }

    return {
        "batchId": job.id,
        "triggeredAt": job.completed_at or job.started_at or job.triggered_at,
        "date": (job.completed_at or job.started_at or job.triggered_at)[:10],
        "mode": job.action,
        "tickers": completed.copy(),
        "tickerCount": len(completed),
        "jobId": job.id,
        "entries": entries,
        "summary": summary,
        "highlights": highlights,
    }


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
    payload = row["result"]
    if not isinstance(payload, dict):
        raise FileNotFoundError(f"Bootstrap job not found: {job_id}")

    raw_tickers = payload.get("tickers")
    normalized_tickers: list[dict[str, Any]] = []
    if isinstance(raw_tickers, list):
        for item in raw_tickers:
            if isinstance(item, dict):
                ticker_value = item.get("ticker")
                if isinstance(ticker_value, str) and ticker_value.strip():
                    normalized_tickers.append({**item, "ticker": ticker_value.strip().upper()})
            elif isinstance(item, str):
                ticker = item.strip().upper()
                if ticker:
                    normalized_tickers.append({"ticker": ticker, "status": "pending"})
    payload["tickers"] = normalized_tickers

    for key in ("completedTickers", "failedTickers"):
        raw_values = payload.get(key)
        normalized_values: list[str] = []
        if isinstance(raw_values, list):
          for item in raw_values:
              if isinstance(item, str):
                  ticker = item.strip().upper()
                  if ticker:
                      normalized_values.append(ticker)
              elif isinstance(item, dict):
                  ticker_value = item.get("ticker")
                  if isinstance(ticker_value, str):
                      ticker = ticker_value.strip().upper()
                      if ticker:
                          normalized_values.append(ticker)
        payload[key] = normalized_values

    current_ticker = payload.get("currentTicker")
    if isinstance(current_ticker, str):
        payload["currentTicker"] = current_ticker.strip().upper() or None

    return BootstrapJobState.model_validate(payload)


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
    payload = row["result"]
    if not isinstance(payload, dict):
        return None

    raw_tickers = payload.get("tickers")
    normalized_tickers: list[dict[str, Any]] = []
    if isinstance(raw_tickers, list):
        for item in raw_tickers:
            if isinstance(item, dict):
                ticker_value = item.get("ticker")
                if isinstance(ticker_value, str) and ticker_value.strip():
                    normalized_tickers.append({**item, "ticker": ticker_value.strip().upper()})
            elif isinstance(item, str):
                ticker = item.strip().upper()
                if ticker:
                    normalized_tickers.append({"ticker": ticker, "status": "pending"})
    payload["tickers"] = normalized_tickers

    for key in ("completedTickers", "failedTickers"):
        raw_values = payload.get(key)
        normalized_values: list[str] = []
        if isinstance(raw_values, list):
            for item in raw_values:
                if isinstance(item, str):
                    ticker = item.strip().upper()
                    if ticker:
                        normalized_values.append(ticker)
                elif isinstance(item, dict):
                    ticker_value = item.get("ticker")
                    if isinstance(ticker_value, str):
                        ticker = ticker_value.strip().upper()
                        if ticker:
                            normalized_values.append(ticker)
        payload[key] = normalized_values

    current_ticker = payload.get("currentTicker")
    if isinstance(current_ticker, str):
        payload["currentTicker"] = current_ticker.strip().upper() or None

    return BootstrapJobState.model_validate(payload)


# ── Analysis jobs ─────────────────────────────────────────────────────────────


def create_job_from_record(job: JobRecord) -> None:
    """Persist a pre-built JobRecord to the database (called from background task)."""
    extra = {
        "ticker": job.ticker,
        "tickers": job.tickers,
        "progress": job.progress.model_dump() if job.progress else None,
    }
    execute(
        """
        INSERT INTO jobs (id, user_id, action, status, source, model_tier, triggered_at, result)
        VALUES (%s, %s, %s, %s, 'dashboard_action', 'balanced', NOW(), %s::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status, result = EXCLUDED.result
        """,
        (job.id, job.user_id, job.action, job.status, json.dumps(extra)),
    )


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
    jobs = []
    for r in rows:
        try:
            jobs.append(_row_to_job(r))
        except Exception:
            pass
    return JobsResponse(jobs=jobs)


def _row_to_job(row: dict) -> JobRecord:
    extra = row.get("result") or {}
    if not isinstance(extra, dict):
        extra = {}
    progress_raw = extra.get("progress")
    progress = JobProgress.model_validate(progress_raw) if progress_raw else None
    tickers: list[str] = []
    raw_tickers = extra.get("tickers")
    if isinstance(raw_tickers, list):
        for item in raw_tickers:
            if isinstance(item, str):
                ticker = item.strip().upper()
                if ticker:
                    tickers.append(ticker)
            elif isinstance(item, dict):
                ticker_value = item.get("ticker")
                if isinstance(ticker_value, str):
                    ticker = ticker_value.strip().upper()
                    if ticker:
                        tickers.append(ticker)
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
        tickers=tickers,
    )


# ── Conversations ─────────────────────────────────────────────────────────────


def create_conversation(user_id: str, title: str | None) -> SavedConversation:
    conv_id = str(uuid.uuid4())
    execute(
        "INSERT INTO conversations (id, user_id, title) VALUES (%s, %s, %s)",
        (conv_id, user_id, title),
    )
    return SavedConversation(id=conv_id, userId=user_id, title=title, createdAt=utc_now())


def list_conversations(user_id: str, limit: int, offset: int) -> list[SavedConversation]:
    rows = fetch_all(
        "SELECT id, user_id, title, created_at FROM conversations WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (user_id, limit, offset),
    )
    return [_row_to_conversation(r) for r in rows]


def load_conversation(user_id: str, conv_id: str) -> ConversationHistory:
    row = fetch_one(
        "SELECT id, user_id, title, created_at FROM conversations WHERE id = %s AND user_id = %s",
        (conv_id, user_id),
    )
    if not row:
        raise FileNotFoundError(f"Conversation not found: {conv_id}")
    memory_rows = fetch_all(
        "SELECT id, conversation_id, sequence_number, role, content FROM chat_memory WHERE conversation_id = %s ORDER BY sequence_number",
        (conv_id,),
    )
    return ConversationHistory(
        conversation=_row_to_conversation(row),
        turns=[_row_to_memory(r) for r in memory_rows],
    )


def append_message(conv_id: str, role: str, content: str) -> ChatMemoryEntry:
    entry_id = str(uuid.uuid4())
    row = fetch_one(
        "INSERT INTO chat_memory (id, conversation_id, role, content) VALUES (%s, %s, %s, %s) RETURNING id, conversation_id, sequence_number, role, content",
        (entry_id, conv_id, role, content),
    )
    if not row:
        raise RuntimeError("Failed to insert chat memory entry")
    return _row_to_memory(row)


def rename_conversation(user_id: str, conv_id: str, title: str) -> SavedConversation:
    execute(
        "UPDATE conversations SET title = %s WHERE id = %s AND user_id = %s",
        (title, conv_id, user_id),
    )
    row = fetch_one(
        "SELECT id, user_id, title, created_at FROM conversations WHERE id = %s AND user_id = %s",
        (conv_id, user_id),
    )
    if not row:
        raise FileNotFoundError(f"Conversation not found: {conv_id}")
    return _row_to_conversation(row)


def archive_conversation(user_id: str, conv_id: str) -> SavedConversation:
    row = fetch_one(
        "SELECT id, user_id, title, created_at FROM conversations WHERE id = %s AND user_id = %s",
        (conv_id, user_id),
    )
    if not row:
        raise FileNotFoundError(f"Conversation not found: {conv_id}")
    execute("DELETE FROM conversations WHERE id = %s AND user_id = %s", (conv_id, user_id))
    return _row_to_conversation(row)


def _row_to_conversation(row: dict) -> SavedConversation:
    return SavedConversation(
        id=str(row["id"]),
        userId=row["user_id"],
        title=row.get("title"),
        createdAt=_ts(row.get("created_at")) or utc_now(),
    )


def _row_to_memory(row: dict) -> ChatMemoryEntry:
    return ChatMemoryEntry(
        id=str(row["id"]),
        conversationId=str(row["conversation_id"]),
        sequenceNumber=row["sequence_number"],
        role=row["role"],
        content=row["content"],
    )
