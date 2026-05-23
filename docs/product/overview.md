# Product overview — Startix

Startix keeps every portfolio position synced with a live strategy state. It monitors holdings, maintains per-ticker **strategies**, runs scheduled **reports** (daily brief, full report, deep dive), and delivers **notifications** on web and messaging channels.

## Core flows

1. **Onboard** — register user, load portfolio, add position guidance → bootstrap analysis → `ACTIVE`
2. **Analysis jobs** — client triggers `full_report` / `deep_dive` / `daily_brief` on agents service; results land in shared Postgres and workspace files
3. **Feed** — `report_batches` / `report_index` drive the dashboard strategy feed
4. **Chat** — Startix AI advisor answers questions about live positions, verdicts, and catalysts; can trigger jobs inline

## Agents

Heavy LLM work runs in `agents/` using DeepAgents multi-agent graphs:
- `bootstrap_agent/` — initial strategy drafts per ticker
- `analysis_agent/` — scheduled and on-demand strategy updates
- `chat_agent/` — conversational advisor with portfolio tools

Results land in Postgres via `agents/app/pg_store.py` or the backend step queue.

## Terms

- **Report** — single analysis output (fundamentals, sentiment, quick check, …)
- **Strategy** — tracked thesis and live verdict for a ticker
- **Verdict** — actionable signal: BUY / ADD / HOLD / REDUCE / SELL / CLOSE
