from __future__ import annotations

import asyncio
from functools import cache
from typing import Any

from deepagents import create_deep_agent

from agents.analysis_agent.prompts import (
    ACTION_INSTRUCTIONS,
    BEAR_PROMPT,
    BULL_PROMPT,
    COORDINATOR_PROMPT,
    CRITIC_PROMPT,
    FUNDAMENTALS_PROMPT,
    PLANNER_PROMPT,
    RISK_PROMPT,
    SENTIMENT_PROMPT,
)
from agents.analysis_agent.state import AnalysisResearchInput
from agents.analysis_agent.tools import get_analysis_context
from agents.app.config import Settings
from agents.app.schemas import PositionGuidanceInput, TickerStrategyDraft, utc_now


# Actions that need the full 7-subagent crew.
_FULL_ACTIONS = {"deep_dive", "full_report"}

# Subagent specs: (name, description, prompt) – tools are injected at build time.
_ALL_SUBAGENT_SPECS = [
    ("planner", "Plan the minimum useful research path.", PLANNER_PROMPT),
    ("analyst_fundamentals", "Analyze fundamentals.", FUNDAMENTALS_PROMPT),
    ("analyst_sentiment", "Analyze sentiment and catalysts.", SENTIMENT_PROMPT),
    ("analyst_risk", "Analyze risks and invalidation conditions.", RISK_PROMPT),
    ("critic", "Critique the draft strategy.", CRITIC_PROMPT),
    ("bull_case", "Argue the bull case.", BULL_PROMPT),
    ("bear_case", "Argue the bear case.", BEAR_PROMPT),
]

_LIGHT_SUBAGENT_SPECS = [
    ("analyst_fundamentals", "Analyze fundamentals.", FUNDAMENTALS_PROMPT),
    ("analyst_sentiment", "Analyze sentiment and catalysts.", SENTIMENT_PROMPT),
    ("analyst_risk", "Analyze risks and invalidation conditions.", RISK_PROMPT),
]


def _subagent_dict(name: str, description: str, system_prompt: str) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "tools": [get_analysis_context],
    }


@cache
def _build_agent(model: str, tier: str) -> Any:
    """Compile a reusable deep agent for the given model and action tier.

    Built once per (model, tier) combination and cached for the process lifetime.
    The research packet is injected at invoke time via RunnableConfig configurable.
    """
    specs = _ALL_SUBAGENT_SPECS if tier == "full" else _LIGHT_SUBAGENT_SPECS
    subagents = [_subagent_dict(name, desc, prompt) for name, desc, prompt in specs]
    return create_deep_agent(
        model=model,
        system_prompt=COORDINATOR_PROMPT,
        tools=[get_analysis_context],
        subagents=subagents,
        response_format=TickerStrategyDraft,
    )


def _tier(action: str) -> str:
    return "full" if action in _FULL_ACTIONS else "light"


def build_research_input(
    action: str,
    ticker: str,
    position_context: dict[str, Any],
    guidance: PositionGuidanceInput | dict[str, Any] | None,
    current_strategy: dict[str, Any] | None,
    recent_reports: list[dict[str, Any]],
) -> AnalysisResearchInput:
    guidance_payload = guidance.model_dump() if hasattr(guidance, "model_dump") else guidance
    return {
        "action": action,
        "ticker": ticker,
        "position": position_context,
        "guidance": guidance_payload,
        "current_strategy": current_strategy,
        "recent_reports": recent_reports,
        "generated_at": utc_now(),
    }


def _strategy_from_result(result: Any, *, ticker: str) -> TickerStrategyDraft:
    if not isinstance(result, dict):
        raise ValueError(f"No structured strategy returned for {ticker}")
    structured = result.get("structured_response")
    if isinstance(structured, TickerStrategyDraft):
        return structured
    if isinstance(structured, dict):
        return TickerStrategyDraft.model_validate(structured)
    raise ValueError(f"No structured strategy returned for {ticker}")


def _invoke_agent_sync(
    model: str, action: str, packet: AnalysisResearchInput
) -> TickerStrategyDraft:
    agent = _build_agent(model, _tier(action))
    instruction = ACTION_INSTRUCTIONS.get(action, "Refresh the ticker strategy.")
    prompt = (
        f"{instruction}\n\n"
        f"Ticker: {packet['ticker']}\n"
        "Use get_analysis_context to read the full research packet. "
        "Use subagents when they add signal, challenge weak assumptions, "
        "and return a structured strategy."
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": prompt}]},
        config={"configurable": {"packet": packet}},
    )
    return _strategy_from_result(result, ticker=packet["ticker"])


async def invoke_analysis_agent(
    settings: Settings,
    *,
    action: str,
    ticker: str,
    position_context: dict[str, Any],
    guidance: PositionGuidanceInput | dict[str, Any] | None,
    current_strategy: dict[str, Any] | None,
    recent_reports: list[dict[str, Any]],
) -> TickerStrategyDraft:
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required")
    packet = build_research_input(
        action, ticker, position_context, guidance, current_strategy, recent_reports
    )
    return await asyncio.to_thread(_invoke_agent_sync, settings.deep_agent_model, action, packet)
