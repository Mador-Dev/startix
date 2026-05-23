# AGENTS.md - System agent rules

## Scope

Startix product: `backend/`, `frontend/`, `agents/`, `db/`, `docs/`, `shared/`, `data/`.

You are the **system agent** (product / infra / admin), not a per-user strategy advisor.

## Persistence

- **Postgres is the only source of truth** for users, portfolio, strategies, jobs, report artifacts, persona text, notifications, control, and chat (backend).
- Do not add new reads/writes under `users/`; extend `db/application_postgres.sql` and the `*Store.ts` services first.
- `agents/` must use LangChain / DeepAgents patterns already in tree; prefer coordinator + subagent graphs over monolithic prompts.

## Write boundaries

Allowed: paths above, root `*.md`.

Avoid bulk edits to production user rows; fix product code instead.

## Feature safety

- Change the smallest surface that can correctly deliver the feature.
- Preserve existing API shapes, DB column semantics, queue payloads, and event names unless the task explicitly includes a coordinated migration.
- Prefer extending current flows over parallel shadow implementations.
- Keep backward compatibility for existing frontend, backend, and agent callers during rollout.
- If a change crosses services, verify the contract on both sides instead of assuming.
- Do not disable validation, auth, or guards to make a feature work; fix the integration properly.
- Avoid hidden fallback behavior; fail clearly and add logs when the system state is invalid.
- When touching scheduling, jobs, or agent runs, preserve idempotency and avoid duplicate work.
- For schema changes, update SQL, stores, types, and callers in the same task.
- Add or update targeted tests for the changed behavior, especially around regressions at boundaries.

## Startup

1. Read relevant backend / frontend / agents code.
2. Reconcile `APP_DATABASE_URL`, env, and `data/` system config.
3. Touch DB user rows only for targeted maintenance.
4. Trace the full request path before editing: client -> API -> store/DB -> agent/job side effects.

## Product terms

- **Report** - one analysis event on an asset.
- **Strategy** - long-lived thesis + live verdict for an asset (`strategies` table).
- **Verdict** - current signal per position: BUY / ADD / HOLD / REDUCE / SELL / CLOSE.

## Architecture rule

Client routes **agentic workflows** (bootstrap, jobs, chat) to the agents service (`:8090`). All other API calls go to the backend (`:8081`). Both services share the same JWT secret and Postgres database.

## Delivery rules

- Keep diffs coherent: wire data model, server logic, and UI together only where required by the feature.
- Do not move persistence into frontend or agents for convenience; keep Postgres access in backend stores.
- Prefer explicit typed fields over ad-hoc JSON blobs when the data is part of product state.
- Add observability when changing opaque flows: log key IDs, decisions, and failure points without leaking secrets.
- Before finishing, check for collateral damage in adjacent flows that share the same store, route, job, or component.

## Success

Change works, matches Postgres-first direction, low regression risk, clearer observability when behavior was opaque.
