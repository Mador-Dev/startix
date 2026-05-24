from __future__ import annotations

import asyncio
from functools import cache
from typing import Any

from langchain.agents import create_agent

from agents.app.config import Settings
from agents.chat_agent.prompts import CHAT_SYSTEM_PROMPT
from agents.chat_agent.tools import CHAT_TOOLS


@cache
def _build_agent(model: str) -> Any:
    """Compile the chat agent once per model and cache it for the process lifetime.

    User identity and job-service access are injected at invoke time via
    RunnableConfig configurable (keys: ``user_id``, ``jobs_service``).
    """
    return create_agent(
        model=model,
        tools=CHAT_TOOLS,
        system_prompt=CHAT_SYSTEM_PROMPT,
    )


def _invoke_chat_agent_sync(
    model: str,
    user_id: str,
    jobs_service: Any,
    messages: list[dict[str, str]],
) -> str:
    agent = _build_agent(model)
    result = agent.invoke(
        {"messages": messages},
        config={"configurable": {"user_id": user_id, "jobs_service": jobs_service}},
    )
    text = result["messages"][-1].content
    if isinstance(text, list):
        # Handle structured content blocks (e.g. Anthropic tool-use messages)
        text = " ".join(block.get("text", "") for block in text if isinstance(block, dict))
    text = (text or "").strip()
    if not text:
        raise ValueError("Chat agent returned an empty response")
    return text


async def invoke_chat_agent(
    settings: Settings,
    *,
    user_id: str,
    jobs_service: Any,
    messages: list[dict[str, str]],
) -> str:
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required")
    return await asyncio.to_thread(
        _invoke_chat_agent_sync,
        settings.deep_agent_model,
        user_id,
        jobs_service,
        messages,
    )
