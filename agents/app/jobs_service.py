from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

import openai

from agents.analysis_agent import invoke_analysis_agent
from agents.app.config import get_settings
from agents.app.points import POINT_COSTS, PointsBudgetExceededError, require_points
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

logger = logging.getLogger(__name__)

MULTI_TICKER_ACTIONS = {"full_report", "daily_brief"}
SINGLE_TICKER_ACTIONS = {"deep_dive", "quick_check"}

# Per-action per-ticker timeout overrides (seconds).
# Deep dive and full report involve multi-step agent chains that can legitimately
# take several minutes per ticker; the global ticker_timeout_seconds default (180s)
# is too tight for them.
_ACTION_TICKER_TIMEOUTS: dict[str, int] = {
    "deep_dive":   480,   # 8 min — thorough multi-step analysis
    "full_report": 480,   # 8 min — same depth, many tickers
    "new_ideas":   300,   # 5 min — exploratory but lighter than deep dive
}

_MAX_RETRIES = 4
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt (2, 4, 8, 16)


async def _invoke_with_retry(settings: Any, **kwargs: Any) -> TickerStrategyDraft:
    """Invoke the analysis agent with exponential-backoff retry on rate-limit errors."""
    delay = _RETRY_BASE_DELAY
    for attempt in range(_MAX_RETRIES):
        try:
            return await invoke_analysis_agent(settings, **kwargs)
        except openai.RateLimitError:
            if attempt == _MAX_RETRIES - 1:
                raise
            logger.warning(
                "Rate limit for %s (attempt %d/%d). Retrying in %.0fs.",
                kwargs.get("ticker", "?"), attempt + 1, _MAX_RETRIES, delay,
            )
            await asyncio.sleep(delay)
            delay *= 2
    raise RuntimeError("Unreachable")  # pragma: no cover


class JobsService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._tasks: dict[str, asyncio.Task] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── Public API ────────────────────────────────────────────────────────────

    def list_jobs(self, user_id: str) -> JobsResponse:
        return store.list_jobs(user_id)

    def get_job(self, user_id: str, job_id: str) -> JobRecord:
        return store.read_job(user_id, job_id)

    async def trigger(self, user_id: str, payload: TriggerJobRequest) -> JobRecord:
        """Create a job record in memory and return it immediately.

        All validation (ticker lookup, points check) and the actual agent work
        happen inside a background task — the HTTP response is instant.
        """
        self._loop = asyncio.get_running_loop()
        job = self._make_pending_job(user_id, payload)
        self._tasks[job.id] = asyncio.create_task(self._prepare_and_run(job, payload))
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
        payload = TriggerJobRequest(action=job.action, ticker=job.ticker)
        self._tasks[job.id] = asyncio.create_task(self._prepare_and_run(job, payload))
        return job

    def trigger_from_chat(self, user_id: str, action: str, ticker: str | None) -> dict:
        if self._loop is None:
            raise RuntimeError("Jobs service loop is not initialized")
        request = TriggerJobRequest(action=action, ticker=ticker)
        future = asyncio.run_coroutine_threadsafe(self.trigger(user_id, request), self._loop)
        job = future.result(timeout=2)
        return {"jobId": job.id, "status": job.status, "action": job.action, "ticker": job.ticker}

    # ── Background task ───────────────────────────────────────────────────────

    async def _prepare_and_run(self, job: JobRecord, payload: TriggerJobRequest) -> None:
        """Validate, persist, and run the job — entirely in the background."""
        user_id = job.user_id

        # --- Validation + initial DB write (offloaded to thread pool) ---
        def _prepare() -> list[str]:
            tickers = self._resolve_tickers(user_id, payload.action, payload.ticker)
            charge = self._charge_for_action(payload.action, len(tickers))
            require_points(
                user_id, charge,
                source="agents", action=payload.action,
                note=f"Triggered {payload.action} for {len(tickers)} ticker(s)",
            )
            return tickers

        try:
            tickers = await asyncio.to_thread(_prepare)
        except (PointsBudgetExceededError, ValueError, FileNotFoundError) as exc:
            job.status = "failed"
            job.error = str(exc)[:2000]
            job.completed_at = utc_now()
            self._update_progress(job, [], {}, None, None)
            try:
                await asyncio.to_thread(store.create_job_from_record, job)
            except Exception:
                logger.exception("Failed to persist failed job %s after validation error", job.id)
            return
        except Exception as exc:
            logger.exception("Unexpected error during job preparation for %s", job.id)
            job.status = "failed"
            job.error = str(exc)[:2000]
            job.completed_at = utc_now()
            self._update_progress(job, [], {}, None, None)
            try:
                await asyncio.to_thread(store.create_job_from_record, job)
            except Exception:
                logger.exception("Failed to persist failed job %s after unexpected preparation error", job.id)
            return

        # Hydrate the job with resolved tickers and write it to DB.
        job.tickers = tickers
        self._update_progress(job, [], {}, payload.ticker, "queued")
        try:
            await asyncio.to_thread(store.create_job_from_record, job)
        except Exception:
            logger.exception("Failed to persist job %s to DB before running; aborting", job.id)
            job.status = "failed"
            job.error = "Internal error: failed to save job record before execution."
            return

        await self._run_job(job)

    async def _run_job(self, job: JobRecord) -> None:
        user_id = job.user_id

        # Load all context in one thread round-trip.
        def _load_context() -> tuple[dict, dict, list]:
            return (
                store.load_position_lookup(user_id),
                store.load_guidance(user_id),
                store.list_report_summaries(user_id, limit=5),
            )

        try:
            lookup, guidance, reports = await asyncio.to_thread(_load_context)
        except Exception as exc:
            logger.exception("Failed to load context for job %s", job.id)
            job.status = "failed"
            job.error = f"Failed to load portfolio context: {str(exc)[:2000]}"
            job.completed_at = utc_now()
            self._update_progress(job, [], {}, None, None)
            try:
                await asyncio.to_thread(store.write_job, job)
            except Exception:
                logger.exception("Failed to persist failed status for job %s", job.id)
            return

        job.status = "running"
        job.started_at = utc_now()
        try:
            await asyncio.to_thread(store.write_job, job)
        except Exception:
            logger.exception("Failed to write running status for job %s", job.id)

        completed: list[str] = []
        failures: dict[str, str] = {}
        strategies: list[TickerStrategyDraft] = []

        semaphore = asyncio.Semaphore(self.settings.bootstrap_max_concurrency)

        async def _run_ticker(ticker: str) -> tuple[str, TickerStrategyDraft | None, str | None]:
            async with semaphore:
                if ticker not in lookup:
                    return ticker, None, "Ticker not found in portfolio."
                try:
                    # Load current strategy off the event loop (blocking psycopg call).
                    current_strategy = await asyncio.to_thread(store.load_strategy, user_id, ticker)
                    ticker_timeout = _ACTION_TICKER_TIMEOUTS.get(
                        job.action, self.settings.ticker_timeout_seconds
                    )
                    strategy = await asyncio.wait_for(
                        _invoke_with_retry(
                            self.settings,
                            action=job.action,
                            ticker=ticker,
                            position_context=lookup[ticker],
                            guidance=self._guidance_model(guidance.get(ticker)),
                            current_strategy=current_strategy,
                            recent_reports=[r for r in reports if r.get("ticker") == ticker],
                        ),
                        timeout=ticker_timeout,
                    )
                    return ticker, strategy, None
                except asyncio.TimeoutError:
                    ticker_timeout = _ACTION_TICKER_TIMEOUTS.get(
                        job.action, self.settings.ticker_timeout_seconds
                    )
                    logger.error(
                        "Ticker %s timed out after %ds in job %s",
                        ticker, ticker_timeout, job.id,
                    )
                    return ticker, None, f"Analysis timed out after {ticker_timeout}s"
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.exception("Ticker %s failed in job %s", ticker, job.id)
                    return ticker, None, str(exc)[:2000]

        self._update_progress(job, completed, failures, None, "analysis")
        try:
            await asyncio.to_thread(store.write_job, job)
        except Exception:
            logger.exception("Failed to write analysis-start status for job %s", job.id)

        try:
            raw_results = await asyncio.gather(
                *(_run_ticker(t) for t in job.tickers),
                return_exceptions=True,
            )
        except Exception as exc:
            logger.exception("asyncio.gather failed for job %s", job.id)
            job.status = "failed"
            job.error = f"Job execution failed: {str(exc)[:2000]}"
            job.completed_at = utc_now()
            self._update_progress(job, [], {}, None, None)
            try:
                await asyncio.to_thread(store.write_job, job)
            except Exception:
                logger.exception("Failed to persist failed status for job %s", job.id)
            return

        # Normalise results — return_exceptions=True means some entries may be BaseException.
        results: list[tuple[str, TickerStrategyDraft | None, str | None]] = []
        for ticker, raw in zip(job.tickers, raw_results):
            if isinstance(raw, BaseException):
                logger.exception("Ticker %s raised unexpectedly in job %s: %s", ticker, job.id, raw)
                results.append((ticker, None, str(raw)[:2000]))
            else:
                results.append(raw)

        def _save_results() -> None:
            for ticker, strategy, error in results:
                if strategy is not None:
                    run_id = store.create_analysis_run(job.id, user_id, ticker, job.action)
                    store.upsert_strategy(user_id, ticker, strategy, guidance_applied=False, run_id=run_id)
                    store.write_analyst_reports(user_id, ticker, run_id, job.action, strategy)
                    store.complete_analysis_run(run_id, "completed")
                    strategies.append(strategy)
                    completed.append(ticker)
                else:
                    failures[ticker] = error or "Unknown error"

        try:
            await asyncio.to_thread(_save_results)
        except Exception as exc:
            logger.exception("Failed to save results for job %s", job.id)
            job.status = "failed"
            job.error = f"Failed to save results: {str(exc)[:2000]}"
            job.completed_at = utc_now()
            self._update_progress(job, completed, failures, None, None)
            try:
                await asyncio.to_thread(store.write_job, job)
            except Exception:
                logger.exception("Failed to persist failed status for job %s after save error", job.id)
            return

        job.completed_at = utc_now()
        job.status = (
            "partial_completed" if failures and completed
            else "failed" if failures
            else "completed"
        )
        error_parts = "; ".join(f"{t}: {r}" for t, r in failures.items())
        job.error = error_parts[:2000] if error_parts else None
        self._update_progress(job, completed, failures, None, None)
        try:
            await asyncio.to_thread(store.write_job, job)
        except Exception:
            logger.exception("Failed to write final status for job %s", job.id)
        try:
            await asyncio.to_thread(store.insert_feed_item, job, strategies, completed)
        except Exception:
            logger.exception("Failed to write feed item for job %s (non-fatal)", job.id)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _make_pending_job(user_id: str, payload: TriggerJobRequest) -> JobRecord:
        job_id = f"job_py_{uuid.uuid4().hex[:12]}"
        return JobRecord(
            id=job_id,
            action=payload.action,
            ticker=payload.ticker,
            status="pending",
            triggered_at=utc_now(),
            user_id=user_id,
            tickers=[],
            progress=JobProgress(
                pct=0, currentTicker=payload.ticker, currentStep="queued",
                completedTickers=[], remainingTickers=[],
                totalTickers=0, completedSteps=0, totalSteps=0,
            ),
        )

    @staticmethod
    def _charge_for_action(action: str, ticker_count: int) -> float:
        if action in {"full_report", "daily_brief"}:
            return POINT_COSTS.get(action, 0.0) * max(1, ticker_count)
        return POINT_COSTS.get(action, 0.0)

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
    def _guidance_model(payload: dict | None) -> PositionGuidanceInput | None:
        if not payload:
            return None
        return PositionGuidanceInput.model_validate(payload)

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
