from __future__ import annotations

import uuid
from dataclasses import dataclass

from agents.app.db import execute, fetch_one


POINT_COSTS: dict[str, float] = {
    "chat_message": 25.0,
    "quick_check": 35.0,
    "deep_dive": 80.0,
    "daily_brief": 60.0,
    "full_report": 90.0,
    "bootstrap_per_ticker": 90.0,
}


class PointsBudgetExceededError(RuntimeError):
    pass


@dataclass(slots=True)
class BalanceSnapshot:
    daily_budget_points: float
    points_used: float
    points_remaining: float


def _round_points(value: float) -> float:
    return round(float(value), 3)


def _coerce_float(value: object, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    return parsed


def get_balance_snapshot(user_id: str) -> BalanceSnapshot:
    """Read the live balance directly from users.points — no ledger aggregation."""
    row = fetch_one(
        "SELECT points, COALESCE(daily_points_budget, 500) AS budget FROM users WHERE user_id = %s",
        (user_id,),
    ) or {}
    budget = _round_points(_coerce_float(row.get("budget"), 500.0))
    remaining = _round_points(max(0.0, _coerce_float(row.get("points"), budget)))
    used = _round_points(max(0.0, budget - remaining))
    return BalanceSnapshot(
        daily_budget_points=budget,
        points_used=used,
        points_remaining=remaining,
    )


def require_points(
    user_id: str,
    points: float,
    *,
    source: str,
    action: str,
    ref_id: str | None = None,
    note: str | None = None,
) -> None:
    required = _round_points(points)
    if required <= 0:
        return

    # Atomic check-and-deduct: only succeeds if the user has enough points.
    row = fetch_one(
        """
        UPDATE users
           SET points     = points - %s,
               updated_at = NOW()
         WHERE user_id = %s
           AND points >= %s
        RETURNING points
        """,
        (required, user_id, required),
    )
    if row is None:
        snapshot = get_balance_snapshot(user_id)
        raise PointsBudgetExceededError(
            f"Not enough points for {action}: "
            f"need {required:.3f}, have {snapshot.points_remaining:.3f}"
        )

    # Write to the ledger for audit trail only (not used for balance checks).
    execute(
        """
        INSERT INTO user_points_ledger (
          id, user_id, points_delta, entry_type, source, action, ref_id, note, expires_at
        ) VALUES (
          %s, %s, %s, 'usage', %s, %s, %s, %s, NOW() + INTERVAL '24 hours'
        )
        """,
        (
            str(uuid.uuid4()),
            user_id,
            -required,
            source,
            action,
            ref_id,
            (note[:1000] if note else None),
        ),
    )
