from __future__ import annotations

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool


@tool
def get_research_packet(config: RunnableConfig) -> dict:
    """Return the normalized research packet for the current ticker."""
    return config.get("configurable", {}).get("research_packet", {})


@tool
def get_guidance(config: RunnableConfig) -> dict:
    """Return the user-supplied guidance for this ticker."""
    return config.get("configurable", {}).get("guidance", {}) or {}
