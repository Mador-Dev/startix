"""Minimal Postgres helpers — one connection per call, no ORM."""

from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row

from agents.app.config import get_settings


def _url() -> str:
    url = get_settings().database_url
    if not url:
        raise RuntimeError("APP_DATABASE_URL is required")
    return url


def execute(sql: str, params: tuple = ()) -> None:
    with psycopg.connect(_url()) as conn:
        conn.execute(sql, params)
        conn.commit()


def fetch_one(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    with psycopg.connect(_url()) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def fetch_all(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with psycopg.connect(_url()) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            return cur.fetchall()
