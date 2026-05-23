from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT_DIR / "agents" / ".env"
load_dotenv(ENV_PATH)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    agents_host: str = Field(default="0.0.0.0", alias="AGENTS_HOST")
    agents_port: int = Field(default=8090, alias="AGENTS_PORT")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    deep_agent_model: str = Field(default="openai:gpt-4o-mini", alias="DEEP_AGENT_MODEL")
    database_url: str = Field(
        default="",
        validation_alias=AliasChoices("APP_DATABASE_URL", "DATABASE_URL"),
    )
    jwt_secret: str = Field(default="changeme", alias="JWT_SECRET")
    bootstrap_max_concurrency: int = Field(default=3, alias="BOOTSTRAP_MAX_CONCURRENCY")
    bootstrap_include_bull_bear: bool = Field(default=True, alias="BOOTSTRAP_INCLUDE_BULL_BEAR")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
