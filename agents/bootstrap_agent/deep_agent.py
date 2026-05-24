from __future__ import annotations

import asyncio
from functools import cache
from typing import Any

from deepagents import create_deep_agent

from agents.app.config import Settings
from agents.app.schemas import PositionGuidanceInput, TickerStrategyDraft, utc_now
from agents.bootstrap_agent.prompts import (
    BEAR_SUBAGENT_PROMPT,
    BULL_SUBAGENT_PROMPT,
    COORDINATOR_PROMPT,
    CRITIC_SUBAGENT_PROMPT,
    FUNDAMENTALS_SUBAGENT_PROMPT,
    RISK_SUBAGENT_PROMPT,
    SENTIMENT_SUBAGENT_PROMPT,
)
from agents.bootstrap_agent.state import BootstrapResearchInput
from agents.bootstrap_agent.tools import get_guidance, get_research_packet


BASE_LIMITATIONS = [
    "Bootstrap v1 uses shared workspace state and lightweight built-in context.",
    "For stronger research, connect deterministic market/news/fundamental data sources here.",
]

_BOOTSTRAP_TOOLS = [get_research_packet, get_guidance]

_BASE_SUBAGENT_SPECS = [
    ("analyst_fundamentals", "Analyze business quality, growth durability, and thesis-critical fundamentals.", FUNDAMENTALS_SUBAGENT_PROMPT),
    ("analyst_sentiment", "Analyze narrative shifts, recent perception changes, and concrete catalysts.", SENTIMENT_SUBAGENT_PROMPT),
    ("analyst_risk", "Analyze downside drivers, key risks, and invalidation conditions.", RISK_SUBAGENT_PROMPT),
    ("critic", "Find flaws, unsupported claims, and missing evidence in the draft strategy.", CRITIC_SUBAGENT_PROMPT),
]

_BULL_BEAR_SPECS = [
    ("bull_case", "Argue the strongest case for owning or adding the ticker.", BULL_SUBAGENT_PROMPT),
    ("bear_case", "Argue the strongest case against owning or adding the ticker.", BEAR_SUBAGENT_PROMPT),
]


def _subagent_dict(name: str, description: str, system_prompt: str) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "tools": _BOOTSTRAP_TOOLS,
    }


@cache
def _build_agent(model: str, include_bull_bear: bool) -> Any:
    """Compile a reusable bootstrap deep agent.

    Built once per (model, include_bull_bear) and cached for the process lifetime.
    The research packet and guidance are injected at invoke time via RunnableConfig.
    """
    specs = _BASE_SUBAGENT_SPECS + (_BULL_BEAR_SPECS if include_bull_bear else [])
    subagents = [_subagent_dict(name, desc, prompt) for name, desc, prompt in specs]
    return create_deep_agent(
        model=model,
        system_prompt=COORDINATOR_PROMPT,
        tools=_BOOTSTRAP_TOOLS,
        subagents=subagents,
        response_format=TickerStrategyDraft,
    )


def build_bootstrap_research_input(
    ticker: str,
    position_context: dict[str, Any],
    guidance: PositionGuidanceInput | None,
) -> BootstrapResearchInput:
    return BootstrapResearchInput(
        ticker=ticker,
        position=position_context,
        guidance=guidance.model_dump() if guidance else None,
        generatedAt=utc_now(),
        limitations=BASE_LIMITATIONS,
    )


def _strategy_from_result(result: Any, *, ticker: str) -> TickerStrategyDraft:
    if not isinstance(result, dict):
        raise ValueError(f"Deep agent returned no structured strategy for {ticker}")
    structured = result.get("structured_response")
    if isinstance(structured, TickerStrategyDraft):
        return structured
    if isinstance(structured, dict):
        normalized = dict(structured)
        reasoning = normalized.get("reasoning")
        if not isinstance(reasoning, str) or not reasoning.strip():
            parts: list[str] = []
            thesis = normalized.get("thesis")
            if isinstance(thesis, str) and thesis.strip():
                parts.append(thesis.strip())
            bull_case = normalized.get("bull_case")
            if isinstance(bull_case, str) and bull_case.strip():
                parts.append(f"Bull case: {bull_case.strip()}")
            bear_case = normalized.get("bear_case")
            if isinstance(bear_case, str) and bear_case.strip():
                parts.append(f"Bear case: {bear_case.strip()}")
            evidence_summary = normalized.get("evidence_summary")
            if isinstance(evidence_summary, dict):
                supporting = evidence_summary.get("supporting")
                if isinstance(supporting, list):
                    snippets = [item.strip() for item in supporting if isinstance(item, str) and item.strip()]
                    if snippets:
                        parts.append("Supporting evidence: " + "; ".join(snippets[:3]))
            normalized["reasoning"] = " ".join(parts).strip() or f"Initial bootstrap strategy for {ticker}."
        return TickerStrategyDraft.model_validate(normalized)
    raise ValueError(f"Deep agent returned no structured strategy for {ticker}")


def _invoke_agent_sync(
    model: str,
    include_bull_bear: bool,
    ticker: str,
    research_packet: BootstrapResearchInput,
) -> TickerStrategyDraft:
    agent = _build_agent(model, include_bull_bear)
    prompt = (
        f"Build the initial portfolio strategy for ticker {ticker}.\n\n"
        "Call get_research_packet to read the full research context. "
        "Run the relevant specialist subagents, challenge weak assumptions, "
        "and synthesize a final ticker strategy."
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": prompt}]},
        config={
            "configurable": {
                "research_packet": dict(research_packet),
                "guidance": research_packet.get("guidance") or {},
            }
        },
    )
    return _strategy_from_result(result, ticker=ticker)


# Kept for backward-compat with langgraph.json entrypoint.
def build_bootstrap_deep_agent(settings: Settings, *, research_packet: BootstrapResearchInput) -> Any:
    return _build_agent(settings.deep_agent_model, settings.bootstrap_include_bull_bear)


async def invoke_bootstrap_agent(
    settings: Settings,
    *,
    ticker: str,
    position_context: dict[str, Any],
    guidance: PositionGuidanceInput | None,
) -> TickerStrategyDraft:
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required")
    research_packet = build_bootstrap_research_input(ticker, position_context, guidance)
    return await asyncio.to_thread(
        _invoke_agent_sync,
        settings.deep_agent_model,
        settings.bootstrap_include_bull_bear,
        ticker,
        research_packet,
    )
