from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

from agents.app.config import get_settings
from agents.app.points import POINT_COSTS, require_points
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
        def _prepare() -> tuple[BootstrapJobState, bool]:
            existing = store.find_active_bootstrap_job(payload.userId)
            if existing is not None:
                return existing, True
            ticker_count = len({
                position.ticker
                for positions in payload.accounts.values()
                for position in positions
            })
            require_points(
                payload.userId,
                POINT_COSTS["bootstrap_per_ticker"] * max(1, ticker_count),
                source="agents",
                action="bootstrap",
                note=f"Bootstrap started for {ticker_count} ticker(s)",
            )
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
            return job, False

        job, already_running = await asyncio.to_thread(_prepare)
        if not already_running:
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
        try:
            store.save_bootstrap_job(job)
            store.save_bootstrap_progress(payload.userId, job.totalTickers, [])
        except Exception:
            logger.exception("Failed to persist running status for bootstrap job %s", job.jobId)

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
                try:
                    store.save_bootstrap_job(job)
                except Exception:
                    logger.exception("Failed to save bootstrap job progress for ticker %s", ticker)
                try:
                    strategy = await asyncio.wait_for(
                        invoke_bootstrap_agent(
                            self.settings,
                            ticker=ticker,
                            position_context=position_lookup[ticker],
                            guidance=payload.guidance.get(ticker),
                        ),
                        timeout=self.settings.ticker_timeout_seconds,
                    )
                    state.currentStep = "synthesis"
                    try:
                        store.save_bootstrap_job(job)
                    except Exception:
                        logger.exception("Failed to save synthesis step for ticker %s", ticker)
                    return ticker, strategy, None
                except asyncio.TimeoutError:
                    logger.error(
                        "Bootstrap ticker %s timed out after %ds in job %s",
                        ticker, self.settings.ticker_timeout_seconds, job.jobId,
                    )
                    return ticker, None, f"Bootstrap timed out after {self.settings.ticker_timeout_seconds}s"
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.exception("Bootstrap agent failed for ticker %s in job %s", ticker, job.jobId)
                    return ticker, None, str(exc)[:2000]

        try:
            raw_results = await asyncio.gather(
                *(run_ticker(t.ticker) for t in job.tickers),
                return_exceptions=True,
            )
        except Exception as exc:
            logger.exception("asyncio.gather failed for bootstrap job %s", job.jobId)
            job.status = "failed"
            job.error = f"Job execution failed: {str(exc)[:2000]}"
            job.completedAt = utc_now()
            job.currentTicker = None
            job.currentStep = None
            self._refresh_progress(job)
            try:
                store.save_bootstrap_job(job)
            except Exception:
                logger.exception("Failed to persist failed status for bootstrap job %s", job.jobId)
            return

        # Normalise results — return_exceptions=True means some entries may be BaseException.
        results: list[tuple[str, TickerStrategyDraft | None, str | None]] = []
        for item, raw in zip(job.tickers, raw_results):
            if isinstance(raw, BaseException):
                logger.error("Ticker %s raised unexpectedly in bootstrap job %s: %s", item.ticker, job.jobId, raw)
                results.append((item.ticker, None, str(raw)[:2000]))
            else:
                results.append(raw)

        for ticker, strategy, error in results:
            state = ticker_states[ticker]
            if strategy is not None:
                state.status = "completed"
                state.currentStep = None
                state.strategy = strategy
                job.completedTickers.append(ticker)
                try:
                    run_id = store.create_analysis_run(job.jobId, payload.userId, ticker, "bootstrap")
                    store.upsert_strategy(
                        payload.userId,
                        ticker,
                        strategy,
                        guidance_applied=ticker in payload.guidance,
                        run_id=run_id,
                    )
                    store.write_analyst_reports(payload.userId, ticker, run_id, "bootstrap", strategy)
                    store.complete_analysis_run(run_id, "completed")
                except Exception:
                    logger.exception("Failed to persist strategy artifacts for ticker %s", ticker)
            else:
                state.status = "failed"
                state.currentStep = None
                state.failureReason = error
                job.failedTickers.append(ticker)
            self._refresh_progress(job)
            try:
                store.save_bootstrap_job(job)
                store.save_bootstrap_progress(payload.userId, job.totalTickers, job.completedTickers)
            except Exception:
                logger.exception("Failed to save bootstrap progress after ticker %s", ticker)

        if job.failedTickers and job.completedTickers:
            job.status = "partial_completed"
            failed_summary = "; ".join(
                f"{t}: {ticker_states[t].failureReason or 'unknown'}"
                for t in job.failedTickers
            )
            job.error = failed_summary[:2000]
        elif job.failedTickers:
            job.status = "failed"
            failed_summary = "; ".join(
                f"{t}: {ticker_states[t].failureReason or 'unknown'}"
                for t in job.failedTickers
            )
            job.error = failed_summary[:2000]
        else:
            job.status = "completed"

        job.currentTicker = None
        job.currentStep = None
        job.completedAt = utc_now()
        self._refresh_progress(job)
        try:
            store.save_bootstrap_job(job)
        except Exception:
            logger.exception("Failed to save final bootstrap job status for %s", job.jobId)
        try:
            store.finish_bootstrap(payload.userId, job.completedTickers, job.failedTickers)
        except Exception:
            logger.exception("Failed to call finish_bootstrap for job %s", job.jobId)

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
