from __future__ import annotations

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool


@tool
def get_analysis_context(config: RunnableConfig) -> dict:
    """Return the ticker-specific research packet for this run."""
    return config.get("configurable", {}).get("packet", {})
