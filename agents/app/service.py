from __future__ import annotations

import asyncio
from typing import Any

from agents.app.config import get_settings
from agents.app import store
from agents.app.schemas import (
    BootstrapJobResult,
    BootstrapJobState,
    BootstrapStartRequest,
    TickerStrategyDraft,
    utc_now,
)
from agents.bootstrap_agent import invoke_bootstrap_agent


class BootstrapService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._tasks: dict[str, asyncio.Task] = {}

    async def start_bootstrap(self, payload: BootstrapStartRequest) -> BootstrapJobState:
        existing = store.find_active_bootstrap_job(payload.userId)
        if existing is not None:
            return existing
        guidance_data = {ticker: g.model_dump() for ticker, g in payload.guidance.items()}
        store.upsert_user(payload.userId, payload.displayName or payload.userId, payload.schedule.model_dump(), guidance_data)
        store.upsert_portfolio(
            payload.userId,
            {
                "meta": {
                    "currency": payload.currency,
                    "transactionFeeILS": payload.transactionFeeILS,
                    "note": payload.note,
                },
                "accounts": {
                    account: [pos.model_dump() for pos in positions]
                    for account, positions in payload.accounts.items()
                },
            },
        )
        job = store.create_bootstrap_job(payload.userId, payload)
        store.save_bootstrap_progress(payload.userId, job.totalTickers, [])
        self._tasks[job.jobId] = asyncio.create_task(self._run_job(payload, job))
        return job

    def get_job(self, user_id: str, job_id: str) -> BootstrapJobState:
        return store.load_bootstrap_job(user_id, job_id)

    def get_result(self, user_id: str, job_id: str) -> BootstrapJobResult:
        job = store.load_bootstrap_job(user_id, job_id)
        strategies = [item.strategy for item in job.tickers if item.strategy is not None]
        return BootstrapJobResult(
            jobId=job.jobId, userId=job.userId, status=job.status,
            strategies=strategies, completedAt=job.completedAt,
        )

    async def _run_job(self, payload: BootstrapStartRequest, job: BootstrapJobState) -> None:
        job.status = "running"
        job.startedAt = utc_now()
        store.save_bootstrap_job(job)
        store.save_bootstrap_progress(payload.userId, job.totalTickers, [])

        ticker_states = {item.ticker: item for item in job.tickers}
        position_lookup = self._position_lookup(payload.accounts)
        semaphore = asyncio.Semaphore(max(1, self.settings.bootstrap_max_concurrency))

        async def run_ticker(ticker: str) -> tuple[str, TickerStrategyDraft | None, str | None]:
            async with semaphore:
                state = ticker_states[ticker]
                state.status = "running"
                state.currentStep = "planner"
                job.currentTicker = ticker
                job.currentStep = "planner"
                self._refresh_progress(job)
                store.save_bootstrap_job(job)
                try:
                    strategy = await invoke_bootstrap_agent(
                        self.settings,
                        ticker=ticker,
                        position_context=position_lookup[ticker],
                        guidance=payload.guidance.get(ticker),
                    )
                    state.currentStep = "synthesis"
                    store.save_bootstrap_job(job)
                    return ticker, strategy, None
                except Exception as exc:
                    return ticker, None, str(exc)

        results = await asyncio.gather(*(run_ticker(t.ticker) for t in job.tickers))

        for ticker, strategy, error in results:
            state = ticker_states[ticker]
            if strategy is not None:
                state.status = "completed"
                state.currentStep = None
                state.strategy = strategy
                job.completedTickers.append(ticker)
                store.upsert_strategy(
                    payload.userId,
                    ticker,
                    strategy,
                    guidance_applied=ticker in payload.guidance,
                )
                for name in ("fundamentals", "sentiment", "risk", "debate", "bull_case", "bear_case"):
                    artifact = strategy.analyst_reports.get(name)
                    if artifact:
                        store.upsert_report_artifact(payload.userId, ticker, name, artifact)
            else:
                state.status = "failed"
                state.currentStep = None
                state.failureReason = error
                job.failedTickers.append(ticker)
            self._refresh_progress(job)
            store.save_bootstrap_job(job)
            store.save_bootstrap_progress(payload.userId, job.totalTickers, job.completedTickers)

        if job.failedTickers and job.completedTickers:
            job.status = "partial_completed"
        elif job.failedTickers:
            job.status = "failed"
            job.error = "All tickers failed." if len(job.failedTickers) == job.totalTickers else None
        else:
            job.status = "completed"

        job.currentTicker = None
        job.currentStep = None
        job.completedAt = utc_now()
        self._refresh_progress(job)
        store.save_bootstrap_job(job)
        store.finish_bootstrap(payload.userId, job.completedTickers, job.failedTickers)

    @staticmethod
    def _position_lookup(accounts: dict) -> dict:
        lookup: dict = {}
        for account_name, positions in accounts.items():
            for position in positions:
                if position.ticker not in lookup:
                    payload = position.model_dump() if hasattr(position, "model_dump") else dict(position)
                    payload["account"] = account_name
                    lookup[position.ticker] = payload
        return lookup

    @staticmethod
    def _refresh_progress(job: BootstrapJobState) -> None:
        total_done = len(job.completedTickers) + len(job.failedTickers)
        job.progressPct = 0 if job.totalTickers == 0 else min(100, round(total_done / job.totalTickers * 100))
