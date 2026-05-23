# Startix

**Always in sync with your positions.**

Investors hold positions for weeks or months — but their investment thesis, risk signals, and strategy verdicts go stale the moment the market moves. Startix fixes that: it runs continuous agentic analysis across your portfolio so every position always has a live, up-to-date strategy state. You open the app knowing exactly what to hold, add, or exit — and why.

## Stack

| Layer | Path | Role |
|-------|------|------|
| Web | `frontend/` | Dashboard, onboarding, admin (React + Vite) |
| API | `backend/` | Auth, portfolio, reports, notifications (Express + Postgres, port 8081) |
| Agents | `agents/` | Agentic strategy engine — bootstrap, analysis, chat (FastAPI, port 8090) |

**Durable state lives in Postgres** (`APP_DATABASE_URL`, schema in `db/application_postgres.sql`).

## Client routing convention

| Flow | Client calls |
|------|-------------|
| Auth, portfolio CRUD, verdicts, reports, notifications, settings | Backend `:8081` |
| Bootstrap onboarding, analysis jobs, chat | Agents `:8090` |

## Agents (`agents/`)

Multi-agent strategy engine built on LangChain + DeepAgents:

- **Bootstrap** — `bootstrap_agent/` initialises per-ticker strategy drafts using specialist subagents (fundamentals, sentiment, risk, bull/bear).
- **Analysis** — `analysis_agent/` runs scheduled and on-demand deep dives; updates verdict, confidence, conditions, catalysts.
- **Chat** — `chat_agent/` is a tool-calling advisor with live access to portfolio data, strategies, and reports.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Product overview](docs/product/overview.md)

## Local run

```bash
# 1. Start Postgres and set APP_DATABASE_URL + JWT_SECRET in both .env files
cp backend/.env.example backend/.env
cp agents/.env.example  agents/.env
cp frontend/.env.example frontend/.env

# 2. Backend
cd backend && npm install && npm run dev

# 3. Frontend (dev server — proxies /api to backend)
cd frontend && npm install && npm run dev

# 4. Agents (run from project root)
pip install -r agents/requirements.txt
uvicorn agents.main:app --port 8090 --reload
```

> **Key:** `JWT_SECRET` and `APP_DATABASE_URL` must be identical in `backend/.env` and `agents/.env`.

Agent instructions for coding assistants: root `AGENTS.md`.
