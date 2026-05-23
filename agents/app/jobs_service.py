from __future__ import annotations

import asyncio
from typing import Any

from agents.analysis_agent import invoke_analysis_agent
from agents.app.config import get_settings
from agents.app import store
from agents.app.schemas import (
    JobProgress,
    JobRecord,
    JobsResponse,
    PositionGuidanceInput,
    TickerStrategyDraft,
    TriggerJobRequest,
    utc_now,
)


MULTI_TICKER_ACTIONS = {"full_report", "daily_brief"}
SINGLE_TICKER_ACTIONS = {"deep_dive", "quick_check"}


class JobsService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._tasks: dict[str, asyncio.Task] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def list_jobs(self, user_id: str) -> JobsResponse:
        return store.list_jobs(user_id)

    def get_job(self, user_id: str, job_id: str) -> JobRecord:
        return store.read_job(user_id, job_id)

    async def trigger(self, user_id: str, payload: TriggerJobRequest) -> JobRecord:
        self._loop = asyncio.get_running_loop()
        tickers = self._resolve_tickers(user_id, payload.action, payload.ticker)
        job = store.create_job(user_id, payload.action, payload.ticker, tickers)
        self._tasks[job.id] = asyncio.create_task(self._run_job(job))
        return job

    async def cancel(self, user_id: str, job_id: str) -> JobRecord:
        job = store.read_job(user_id, job_id)
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        job.status = "cancelled"
        job.completed_at = utc_now()
        job.error = job.error or "Cancelled from dashboard."
        if job.progress:
            job.progress.currentStep = None
        store.write_job(job)
        return job

    async def resume(self, user_id: str, job_id: str) -> JobRecord:
        self._loop = asyncio.get_running_loop()
        job = store.read_job(user_id, job_id)
        if job.status not in {"paused", "failed", "cancelled"}:
            return job
        job.status = "pending"
        job.error = None
        job.started_at = None
        job.completed_at = None
        if job.progress:
            job.progress.currentStep = "queued"
            job.progress.currentTicker = job.ticker or (job.tickers[0] if job.tickers else None)
        store.write_job(job)
        self._tasks[job.id] = asyncio.create_task(self._run_job(job))
        return job

    def trigger_from_chat(self, user_id: str, action: str, ticker: str | None) -> dict:
        if self._loop is None:
            raise RuntimeError("Jobs service loop is not initialized")
        request = TriggerJobRequest(action=action, ticker=ticker)
        future = asyncio.run_coroutine_threadsafe(self.trigger(user_id, request), self._loop)
        job = future.result(timeout=2)
        return {"jobId": job.id, "status": job.status, "action": job.action, "ticker": job.ticker}

    async def _run_job(self, job: JobRecord) -> None:
        user_id = job.user_id
        if not user_id:
            raise ValueError("Job missing user_id")

        lookup = store.load_position_lookup(user_id)
        guidance = store.load_guidance(user_id)
        reports = store.list_report_summaries(user_id, limit=5)

        job.status = "running"
        job.started_at = utc_now()
        store.write_job(job)

        completed: list[str] = []
        failures: dict[str, str] = {}
        strategies: list[TickerStrategyDraft] = []

        for ticker in job.tickers:
            if ticker not in lookup:
                failures[ticker] = "Ticker not found in portfolio."
                self._update_progress(job, completed, failures, ticker, "missing_context")
                store.write_job(job)
                continue

            self._update_progress(job, completed, failures, ticker, "analysis")
            store.write_job(job)

            try:
                strategy = await invoke_analysis_agent(
                    self.settings,
                    action=job.action,
                    ticker=ticker,
                    position_context=lookup[ticker],
                    guidance=self._guidance_model(guidance.get(ticker)),
                    current_strategy=store.load_strategy(user_id, ticker),
                    recent_reports=[r for r in reports if r.get("ticker") == ticker],
                )
                store.upsert_strategy(user_id, ticker, strategy)
                strategies.append(strategy)
                completed.append(ticker)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                failures[ticker] = str(exc)

            self._update_progress(job, completed, failures, ticker, "done")
            store.write_job(job)

        job.completed_at = utc_now()
        if failures and completed:
            job.status = "partial_completed"
        elif failures:
            job.status = "failed"
        else:
            job.status = "completed"
        job.error = "; ".join(f"{t}: {r}" for t, r in failures.items()) or None
        job.result = {
            "tickers": [item.model_dump() for item in strategies],
            "completedTickers": completed,
            "failedTickers": list(failures.keys()),
        }
        self._update_progress(job, completed, failures, None, None)
        store.write_job(job)

    @staticmethod
    def _guidance_model(payload: dict | None) -> PositionGuidanceInput | None:
        if not payload:
            return None
        return PositionGuidanceInput.model_validate(payload)

    def _resolve_tickers(self, user_id: str, action: str, ticker: str | None) -> list[str]:
        lookup = store.load_position_lookup(user_id)
        if action in MULTI_TICKER_ACTIONS:
            return sorted(lookup.keys())
        if action in SINGLE_TICKER_ACTIONS:
            if not ticker:
                raise ValueError(f"{action} requires a ticker")
            normalized = ticker.strip().upper()
            if normalized not in lookup:
                raise FileNotFoundError(f"Ticker not found in portfolio: {normalized}")
            return [normalized]
        raise ValueError(f"Unsupported action: {action}")

    @staticmethod
    def _update_progress(
        job: JobRecord,
        completed: list[str],
        failures: dict[str, str],
        current_ticker: str | None,
        current_step: str | None,
    ) -> None:
        total = len(job.tickers)
        done = len(completed) + len(failures)
        remaining = [t for t in job.tickers if t not in completed and t not in failures]
        job.progress = JobProgress(
            pct=0 if total == 0 else min(100, round(done / total * 100)),
            currentTicker=current_ticker,
            currentStep=current_step,
            completedTickers=completed.copy(),
            remainingTickers=remaining,
            totalTickers=total,
            completedSteps=done,
            totalSteps=total,
        )
