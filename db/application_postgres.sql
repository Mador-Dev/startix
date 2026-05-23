-- Startix schema (idempotent).
-- Append new statements here; backend runs this file once on startup (see docs/ARCHITECTURE.md).
-- Use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so re-runs are safe.

CREATE TABLE IF NOT EXISTS llm_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  purpose VARCHAR(128) NOT NULL,
  ticker VARCHAR(32),
  job_id VARCHAR(128),
  step_id UUID,
  source_class VARCHAR(64) NOT NULL,
  analyst VARCHAR(64) NOT NULL,
  model VARCHAR(255) NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  error_message TEXT,
  attribution_source VARCHAR(128) NOT NULL,
  rejection_reason VARCHAR(128),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_requests_occurred_at
  ON llm_requests (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_occurred_at
  ON llm_requests (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_source_occurred_at
  ON llm_requests (user_id, source_class, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_purpose_ticker_analyst_occurred_at
  ON llm_requests (user_id, purpose, ticker, analyst, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_job_occurred_at
  ON llm_requests (user_id, job_id, occurred_at DESC);

ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS step_id UUID;

CREATE INDEX IF NOT EXISTS idx_llm_requests_step_id
  ON llm_requests (step_id)
  WHERE step_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_points_budgets (
  user_id VARCHAR(128) PRIMARY KEY,
  daily_budget_points NUMERIC(18, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_points_budgets_updated_at
  ON user_points_budgets (updated_at DESC);

CREATE TABLE IF NOT EXISTS tracked_assets (
  user_id VARCHAR(128) NOT NULL,
  ticker VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'muted', 'archived')),
  created_from_job_id VARCHAR(128),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_tracked_assets_user_status
  ON tracked_assets (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  source VARCHAR(64) NOT NULL,
  model_tier VARCHAR(32) NOT NULL,
  notify_per_ticker BOOLEAN NOT NULL DEFAULT FALSE,
  budget_admitted_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pause_reason TEXT,
  failure_reason TEXT,
  result JSONB
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status
  ON jobs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_status_triggered
  ON jobs (status, triggered_at);

CREATE TABLE IF NOT EXISTS ticker_work_items (
  id UUID PRIMARY KEY,
  job_id VARCHAR(128) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  ticker VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  position INTEGER NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  skip_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickers_job
  ON ticker_work_items (job_id);

CREATE INDEX IF NOT EXISTS idx_tickers_user_status
  ON ticker_work_items (user_id, status);

CREATE TABLE IF NOT EXISTS step_work_items (
  id UUID PRIMARY KEY,
  ticker_work_item_id UUID NOT NULL REFERENCES ticker_work_items(id) ON DELETE CASCADE,
  job_id VARCHAR(128) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  model_tier_used VARCHAR(32),
  cost_accrued_cents INTEGER NOT NULL DEFAULT 0,
  input_artifact_paths TEXT[] NOT NULL DEFAULT '{}',
  output_artifact_path TEXT,
  last_error TEXT,
  owner_lock_id UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steps_status_created
  ON step_work_items (status, created_at);

CREATE INDEX IF NOT EXISTS idx_steps_job_status
  ON step_work_items (job_id, status);

CREATE INDEX IF NOT EXISTS idx_steps_ticker_status
  ON step_work_items (ticker_work_item_id, status);

CREATE INDEX IF NOT EXISTS idx_steps_lock
  ON step_work_items (owner_lock_id)
  WHERE owner_lock_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS step_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  step_id UUID NOT NULL REFERENCES step_work_items(id) ON DELETE CASCADE,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  attempt_n INTEGER,
  model_used VARCHAR(255),
  tier_used VARCHAR(32),
  error_class VARCHAR(64),
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_events_step
  ON step_lifecycle_events (step_id, occurred_at);

CREATE TABLE IF NOT EXISTS model_tier_assignments (
  tier VARCHAR(32) NOT NULL CHECK (tier IN ('free', 'cheap', 'balanced', 'expensive')),
  step_kind VARCHAR(64) NOT NULL,
  model VARCHAR(255) NOT NULL,
  fallback VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(128) NOT NULL DEFAULT 'admin',
  PRIMARY KEY (tier, step_kind)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_llm_requests_step_id'
  ) THEN
    ALTER TABLE llm_requests
      ADD CONSTRAINT fk_llm_requests_step_id
      FOREIGN KEY (step_id)
      REFERENCES step_work_items(id)
      ON DELETE SET NULL;
  END IF;
END
$$;


-- ============================================================================
-- Phase 1 DDL — Postgres operational state foundation
-- Historical source: platform-stabilization-and-assistant design §4.1–4.17
-- Requirements: A2.1, A3.1, P3.1
-- All statements idempotent so the DDL re-runs cleanly on every backend start.
-- ============================================================================

-- §4.1 users — replaces auth.json + profile.json + state.json (state field) +
--             config.json (modelProfile) for the user record itself.
CREATE TABLE IF NOT EXISTS users (
  user_id            VARCHAR(64) PRIMARY KEY,
  display_name       VARCHAR(128) NOT NULL,
  password_hash      VARCHAR(128) NOT NULL,
  token_version      INTEGER NOT NULL DEFAULT 0,
  schedule           JSONB NOT NULL
                       DEFAULT '{"dailyBriefTime":"08:00","weeklyResearchDay":"sunday","weeklyResearchTime":"19:00","timezone":"Asia/Jerusalem"}'::jsonb,
  rate_limits        JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_tier         VARCHAR(32) NOT NULL DEFAULT 'balanced'
                       CHECK (model_tier IN ('free','cheap','balanced','expensive')),
  model_profile      VARCHAR(64) NOT NULL DEFAULT 'testing',
  lot_method         VARCHAR(16) NOT NULL DEFAULT 'fifo'
                       CHECK (lot_method IN ('fifo','lifo','specific_lot')),
  max_single_position_pct  NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  stop_loss_threshold_pct  NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  state              VARCHAR(32) NOT NULL DEFAULT 'INCOMPLETE'
                       CHECK (state IN ('INCOMPLETE','BOOTSTRAPPING','ACTIVE','BLOCKED')),
  restriction        VARCHAR(32),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_state ON users (state);

-- §4.2 strategies — replaces data/tickers/[T]/strategy.json as source of truth.
-- The JSON file is regenerated as a derived export only (A2.3).
CREATE TABLE IF NOT EXISTS strategies (
  user_id              VARCHAR(64) NOT NULL,
  ticker               VARCHAR(32) NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  asset_scope          VARCHAR(16) NOT NULL DEFAULT 'portfolio'
                         CHECK (asset_scope IN ('portfolio','tracking')),
  tracking_status      VARCHAR(16),
  verdict              VARCHAR(16) NOT NULL
                         CHECK (verdict IN ('BUY','ADD','HOLD','REDUCE','SELL','CLOSE')),
  confidence           VARCHAR(8) NOT NULL CHECK (confidence IN ('high','medium','low')),
  reasoning            TEXT NOT NULL,
  timeframe            VARCHAR(16) NOT NULL,
  position_size_ils    NUMERIC(18,2) NOT NULL DEFAULT 0,
  position_weight_pct  NUMERIC(7,4) NOT NULL DEFAULT 0,
  entry_conditions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  exit_conditions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  catalysts            JSONB NOT NULL DEFAULT '[]'::jsonb,
  bull_case            TEXT,
  bear_case            TEXT,
  last_deep_dive_at         TIMESTAMPTZ,
  deep_dive_triggered_by    VARCHAR(64),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  stance               VARCHAR(16),
  potential_score      NUMERIC(6,2),
  urgency_score        NUMERIC(6,2),
  urgency_label        VARCHAR(16),
  portfolio_fit_score  NUMERIC(6,2),
  suggested_allocation_pct  NUMERIC(7,4),
  suggested_allocation_ils  NUMERIC(18,2),
  action_catalysts     JSONB NOT NULL DEFAULT '[]'::jsonb,
  avoid_conditions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_review_at       TIMESTAMPTZ,
  asset_class          VARCHAR(16) NOT NULL DEFAULT 'equity'
                         CHECK (asset_class IN ('equity','etf','bond','fund','crypto','index','other')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_strategies_user_scope
  ON strategies (user_id, asset_scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_user_verdict
  ON strategies (user_id, verdict);
CREATE INDEX IF NOT EXISTS idx_strategies_next_review
  ON strategies (user_id, next_review_at)
  WHERE next_review_at IS NOT NULL;


-- §4.3 report_batches + report_index — replaces data/reports/index/*.json.
CREATE TABLE IF NOT EXISTS report_batches (
  batch_id        VARCHAR(128) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  job_id          VARCHAR(128) NOT NULL,
  mode            VARCHAR(32) NOT NULL,
  triggered_at    TIMESTAMPTZ NOT NULL,
  date            DATE NOT NULL,
  ticker_count    INTEGER NOT NULL DEFAULT 0,
  summary         JSONB,
  highlights      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_report_batches_job FOREIGN KEY (job_id)
    REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_batches_user_triggered
  ON report_batches (user_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_batches_user_mode_date
  ON report_batches (user_id, mode, date DESC);

CREATE TABLE IF NOT EXISTS report_index (
  batch_id      VARCHAR(128) NOT NULL,
  ticker        VARCHAR(32) NOT NULL,
  daily_section VARCHAR(16),
  entry         JSONB NOT NULL,
  PRIMARY KEY (batch_id, ticker),
  CONSTRAINT fk_report_index_batch FOREIGN KEY (batch_id)
    REFERENCES report_batches(batch_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_index_ticker ON report_index (ticker);

-- §4.4 notifications_outbox — replaces feed/notifications.json.
CREATE TABLE IF NOT EXISTS notifications_outbox (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  category      VARCHAR(32) NOT NULL CHECK (category IN ('daily_brief','report','market_news')),
  channel       VARCHAR(16) NOT NULL CHECK (channel IN ('telegram','web','whatsapp')),
  title         VARCHAR(256) NOT NULL,
  body          TEXT NOT NULL,
  ticker        VARCHAR(32),
  batch_id      VARCHAR(128),
  delivered     BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications_outbox (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications_outbox (user_id, channel)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_batch_category
  ON notifications_outbox (user_id, batch_id, category)
  WHERE batch_id IS NOT NULL;

-- §4.5 escalation_history — replaces data/escalation_history.json.
-- signal_set_fingerprint is a stable hash used to dedupe re-escalation on the
-- same signal-set; snooze suppression keys off the same fingerprint.
CREATE TABLE IF NOT EXISTS escalation_history (
  user_id                 VARCHAR(64) NOT NULL,
  ticker                  VARCHAR(32) NOT NULL,
  signal_set_fingerprint  VARCHAR(64) NOT NULL,
  job_id                  VARCHAR(128) NOT NULL,
  signals                 JSONB NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker, signal_set_fingerprint),
  CONSTRAINT fk_escalation_history_job FOREIGN KEY (job_id)
    REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_escalation_history_user_created
  ON escalation_history (user_id, created_at DESC);


-- §4.8 verdict_actions — followed/dismissed/partial_acted records (L1).
CREATE TABLE IF NOT EXISTS verdict_actions (
  id               UUID PRIMARY KEY,
  user_id          VARCHAR(64) NOT NULL,
  ticker           VARCHAR(32) NOT NULL,
  strategy_version INTEGER NOT NULL,
  decision         VARCHAR(16) NOT NULL
                     CHECK (decision IN ('followed','dismissed','partial_acted')),
  note             TEXT,
  acted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verdict_actions_user_ticker
  ON verdict_actions (user_id, ticker, acted_at DESC);

-- §4.9 ticker_snoozes — suppresses re-escalation on a matching signal set (L2).
CREATE TABLE IF NOT EXISTS ticker_snoozes (
  id                       UUID PRIMARY KEY,
  user_id                  VARCHAR(64) NOT NULL,
  ticker                   VARCHAR(32) NOT NULL,
  snooze_until             TIMESTAMPTZ NOT NULL,
  signal_set_fingerprint   VARCHAR(64) NOT NULL,
  reason                   TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticker_snoozes_active
  ON ticker_snoozes (user_id, ticker, snooze_until DESC);

-- §4.10 portfolio_risk_snapshots — append-only concentration / largest-position trace (L3).
CREATE TABLE IF NOT EXISTS portfolio_risk_snapshots (
  id                                UUID PRIMARY KEY,
  user_id                           VARCHAR(64) NOT NULL,
  snapshot_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_value_ils                   NUMERIC(18,2) NOT NULL,
  concentration_by_single_name_pct  JSONB NOT NULL,
  concentration_by_sector_pct       JSONB NOT NULL,
  concentration_by_currency_pct     JSONB NOT NULL,
  concentration_by_asset_class_pct  JSONB NOT NULL,
  largest_single_position_ticker    VARCHAR(32),
  largest_single_position_pct       NUMERIC(7,4)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_risk_user_snapshot
  ON portfolio_risk_snapshots (user_id, snapshot_at DESC);

-- §4.13 admin_audit_log — one row per /api/admin/* request (O9).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_admin_id  VARCHAR(64) NOT NULL,
  action_type     VARCHAR(64) NOT NULL,
  target_user_id  VARCHAR(64),
  args_json       JSONB,
  result_status   VARCHAR(16) NOT NULL CHECK (result_status IN ('success','error','rejected')),
  request_id      VARCHAR(64) NOT NULL,
  ip_address      VARCHAR(64),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor_at
  ON admin_audit_log (actor_admin_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_at
  ON admin_audit_log (target_user_id, occurred_at DESC)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action_at
  ON admin_audit_log (action_type, occurred_at DESC);

-- §4.15 feature_flags — gates every new code path; values held as JSONB (P3.1, P3.2).
-- Spec uses `PRIMARY KEY (flag_name, COALESCE(scope_user_id, ''))`; Postgres does
-- not allow expressions in primary keys, so we use a surrogate id plus two partial
-- unique indexes (global vs scoped) to express the same uniqueness invariant.
CREATE TABLE IF NOT EXISTS feature_flags (
  id              BIGSERIAL PRIMARY KEY,
  flag_name       VARCHAR(64) NOT NULL,
  scope_user_id   VARCHAR(64),
  enabled         BOOLEAN NOT NULL,
  value_json      JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      VARCHAR(64) NOT NULL DEFAULT 'system'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flags_global_unique
  ON feature_flags (flag_name)
  WHERE scope_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flags_scoped_unique
  ON feature_flags (flag_name, scope_user_id)
  WHERE scope_user_id IS NOT NULL;

-- §4.16 channel_bindings — Telegram chat / WhatsApp phone → user_id (D1.1, D2.3).
CREATE TABLE IF NOT EXISTS channel_bindings (
  channel              VARCHAR(16) NOT NULL CHECK (channel IN ('telegram','whatsapp')),
  channel_identifier   VARCHAR(128) NOT NULL,
  user_id              VARCHAR(64) NOT NULL,
  conversation_id      VARCHAR(64),
  bound_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unbound_at           TIMESTAMPTZ,
  PRIMARY KEY (channel, channel_identifier),
  CONSTRAINT fk_channel_bindings_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_user_active
  ON channel_bindings (user_id, channel)
  WHERE unbound_at IS NULL;

-- §4.17 encrypted_secrets — libsodium-encrypted third-party tokens (O5).
-- Phase 1 stores identity-encrypted (key_id=0); Phase 8 introduces the real
-- libsodium key and the rotation script re-encrypts under key_id=1.
CREATE TABLE IF NOT EXISTS encrypted_secrets (
  id              UUID PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  secret_kind     VARCHAR(32) NOT NULL
                    CHECK (secret_kind IN ('telegram_bot_token','whatsapp_access_token','whatsapp_app_secret')),
  ciphertext      BYTEA NOT NULL,
  nonce           BYTEA NOT NULL,
  key_id          INTEGER NOT NULL,
  ciphertext_hash CHAR(8) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at      TIMESTAMPTZ,
  CONSTRAINT fk_encrypted_secrets_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_encrypted_secrets_user_kind
  ON encrypted_secrets (user_id, secret_kind);

-- §5 existing-table change required by Phase 1: tracked_assets.asset_class.
ALTER TABLE tracked_assets
  ADD COLUMN IF NOT EXISTS asset_class VARCHAR(16) NOT NULL DEFAULT 'equity';

-- Add the asset_class CHECK constraint idempotently (CREATE TABLE IF NOT EXISTS
-- on the original tracked_assets did not include it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tracked_assets_asset_class_check'
  ) THEN
    ALTER TABLE tracked_assets
      ADD CONSTRAINT tracked_assets_asset_class_check
      CHECK (asset_class IN ('equity','etf','bond','fund','crypto','index','other'));
  END IF;
END
$$;

-- ============================================================================
-- Phase 2 DDL — Step queue absorbs daily_brief, quick_check, full_report, deep_dive
-- Spec: design.md §5; tasks.md 2.1
-- ============================================================================

-- §5: jobs.conversation_id — correlates chat-agent-triggered jobs with their
-- conversation (used by Phase 5 chat agent; landing now to keep DDL linear).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_jobs_conversation_id
  ON jobs (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- Extend JobAction to include daily_brief and quick_check.
-- The CHECK constraint on jobs.action is not enforced in the current DDL
-- (no CHECK was added in the original schema), so no ALTER needed for the
-- action column itself. The TypeScript types are updated in types.ts.

-- ============================================================================
-- Phase 4 DDL — Provider-native structured outputs + self-correcting retry
-- Spec: design.md §5; tasks.md 4.1
-- Requirements: H1.4, H2.2, I1.6, I2.2
-- ============================================================================

-- step_work_items: record which structured-output strategy produced the artifact.
ALTER TABLE step_work_items
  ADD COLUMN IF NOT EXISTS schema_mode VARCHAR(32) DEFAULT NULL
    CHECK (schema_mode IS NULL OR schema_mode IN ('provider_native','normalize_fallback','both')),
  ADD COLUMN IF NOT EXISTS structured_output_provider VARCHAR(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prose_fallback_used BOOLEAN NOT NULL DEFAULT FALSE;

-- step_lifecycle_events: record schema_mode on each transition for observability.
ALTER TABLE step_lifecycle_events
  ADD COLUMN IF NOT EXISTS schema_mode VARCHAR(32) DEFAULT NULL;

-- model_tier_assignments: provider routing + extended-thinking budget.
ALTER TABLE model_tier_assignments
  ADD COLUMN IF NOT EXISTS thinking_budget INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32) NOT NULL DEFAULT 'openrouter';

-- llm_requests: correlate with chat-agent conversations and tool calls (Phase 5).
ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS tool_call_id UUID,
  ADD COLUMN IF NOT EXISTS schema_mode VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_llm_requests_conv_at
  ON llm_requests (conversation_id, occurred_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_requests_tool_call
  ON llm_requests (tool_call_id)
  WHERE tool_call_id IS NOT NULL;

-- user_points_budgets: per-user conversation token cap override (Phase 5).
ALTER TABLE user_points_budgets
  ADD COLUMN IF NOT EXISTS conversation_token_cap_override INTEGER;

-- ============================================================================
-- Phase 5 DDL — Chat agent (dashboard transport only)
-- Spec: design.md §4.11, §4.12; tasks.md 5.1
-- Requirements: C2.1, C2.2, C2.3, F2.3
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id                   VARCHAR(64) PRIMARY KEY,
  user_id              VARCHAR(64) NOT NULL,
  channel              VARCHAR(16) NOT NULL CHECK (channel IN ('dashboard','telegram','whatsapp')),
  title                VARCHAR(160),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at          TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  turn_count           INTEGER NOT NULL DEFAULT 0,
  total_tokens_in      INTEGER NOT NULL DEFAULT 0,
  total_tokens_out     INTEGER NOT NULL DEFAULT 0,
  total_cost_usd       NUMERIC(14,6) NOT NULL DEFAULT 0,
  termination_reason   VARCHAR(32),
  tool_call_count      INTEGER NOT NULL DEFAULT 0,
  model                VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_started
  ON conversations (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_termination
  ON conversations (termination_reason, started_at DESC)
  WHERE termination_reason IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS title VARCHAR(160),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_saved_list
  ON conversations (user_id, channel, updated_at DESC, started_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_archive_lookup
  ON conversations (user_id, channel, archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_expires_at
  ON conversations (expires_at)
  WHERE expires_at IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_turns (
  conversation_id  VARCHAR(64) NOT NULL,
  turn_index       INTEGER NOT NULL,
  role             VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','tool_result','system')),
  content          JSONB NOT NULL,
  model            VARCHAR(255),
  tokens_in        INTEGER NOT NULL DEFAULT 0,
  tokens_out       INTEGER NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(14,6) NOT NULL DEFAULT 0,
  latency_ms       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, turn_index),
  CONSTRAINT fk_conversation_turns_conv FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id                UUID PRIMARY KEY,
  conversation_id   VARCHAR(64) NOT NULL,
  turn_index        INTEGER NOT NULL,
  tool_name         VARCHAR(64) NOT NULL,
  category          VARCHAR(16) NOT NULL CHECK (category IN ('read','action')),
  args_json         JSONB NOT NULL,
  result_status     VARCHAR(16) NOT NULL CHECK (result_status IN ('success','error','rejected')),
  result_latency_ms INTEGER NOT NULL DEFAULT 0,
  cost_points       NUMERIC(18,6) NOT NULL DEFAULT 0,
  audit_note        TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_tool_calls_conv FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_conv
  ON tool_calls (conversation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name
  ON tool_calls (tool_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS output_filter_events (
  id                    BIGSERIAL PRIMARY KEY,
  conversation_id       VARCHAR(64) NOT NULL,
  turn_index            INTEGER NOT NULL,
  pattern               VARCHAR(128) NOT NULL,
  site_of_match         VARCHAR(16) NOT NULL CHECK (site_of_match IN ('tool_result','final_reply')),
  original_length_chars INTEGER NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_output_filter_events_conv FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_output_filter_events_at
  ON output_filter_events (occurred_at DESC);

-- ============================================================================
-- Phase 7 DDL — Transactions ledger, corporate actions, asset-class dispatch
-- Spec: design.md §4.6, §4.7, §5; tasks.md 7.1
-- Requirements: J1.1, K1.1, M2.1
-- ============================================================================

-- §4.6 position_transactions — append-only ledger with tombstone semantics.
-- Every read for cost-basis computation MUST filter superseded_at IS NULL.
CREATE TABLE IF NOT EXISTS position_transactions (
  id               UUID PRIMARY KEY,
  user_id          VARCHAR(64) NOT NULL,
  ticker           VARCHAR(32) NOT NULL,
  exchange         VARCHAR(16) NOT NULL,
  account          VARCHAR(64) NOT NULL,
  transaction_type VARCHAR(16) NOT NULL
                     CHECK (transaction_type IN ('buy','sell','split','dividend','transfer_in','transfer_out')),
  quantity         NUMERIC(20,8) NOT NULL,
  unit_price       NUMERIC(20,8) NOT NULL,
  unit_currency    VARCHAR(8) NOT NULL,
  fees_ils         NUMERIC(18,4) NOT NULL DEFAULT 0,
  fx_rate          NUMERIC(18,8),
  transaction_at   TIMESTAMPTZ NOT NULL,
  note             TEXT,
  lot_id           UUID,
  superseded_by    UUID,
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_position_transactions_user_ticker_at
  ON position_transactions (user_id, ticker, transaction_at)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_position_transactions_user_at
  ON position_transactions (user_id, transaction_at DESC);

-- §4.7 corporate_actions — splits and dividends applied to historical transactions.
CREATE TABLE IF NOT EXISTS corporate_actions (
  id               UUID PRIMARY KEY,
  user_id          VARCHAR(64),
  ticker           VARCHAR(32) NOT NULL,
  exchange         VARCHAR(16) NOT NULL,
  action_type      VARCHAR(16) NOT NULL CHECK (action_type IN ('split','dividend')),
  ratio_or_amount  NUMERIC(20,8) NOT NULL,
  currency         VARCHAR(8) NOT NULL,
  effective_date   DATE NOT NULL,
  source           VARCHAR(64) NOT NULL,
  reverted_at      TIMESTAMPTZ,
  reverted_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_corp_actions_ticker_eff
  ON corporate_actions (ticker, exchange, effective_date);
CREATE INDEX IF NOT EXISTS idx_corp_actions_user_ticker
  ON corporate_actions (user_id, ticker)
  WHERE user_id IS NOT NULL;

-- §5 existing-table changes for Phase 7.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS asset_class VARCHAR(16) DEFAULT NULL
    CHECK (asset_class IS NULL OR asset_class IN ('equity','etf','bond','fund','crypto','index','other'));

ALTER TABLE ticker_work_items
  ADD COLUMN IF NOT EXISTS asset_class VARCHAR(16) DEFAULT NULL
    CHECK (asset_class IS NULL OR asset_class IN ('equity','etf','bond','fund','crypto','index','other'));

-- ============================================================================
-- Analyst pipeline configuration — user-controlled step kind toggles
-- Allows users to disable specific analyst steps to save budget points.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_analyst_config (
  user_id    VARCHAR(64) NOT NULL,
  step_kind  VARCHAR(64) NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, step_kind)
);
CREATE INDEX IF NOT EXISTS idx_user_analyst_config_user
  ON user_analyst_config (user_id);

-- ============================================================================
-- One-time budget credits — admin can grant temporary point boosts
-- that apply only to the current 24h window without changing dailyBudgetPoints.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_points_credits (
  id          UUID PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL,
  points      NUMERIC(18,6) NOT NULL,
  note        TEXT,
  granted_by  VARCHAR(64) NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_points_credits_user_expires
  ON user_points_credits (user_id, expires_at DESC);

-- ============================================================================
-- Pilot feature review state — mutable admin annotations for tracked catalog ids
-- ============================================================================

CREATE TABLE IF NOT EXISTS pilot_feature_reviews (
  feature_id TEXT PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'unreviewed'
    CHECK (status IN ('unreviewed', 'needs_fix', 'beta', 'hidden', 'ready')),
  admin_comment TEXT,
  incorrect_description BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(128) NOT NULL
);

ALTER TABLE pilot_feature_reviews
  ADD COLUMN IF NOT EXISTS admin_comment TEXT;

ALTER TABLE pilot_feature_reviews
  ADD COLUMN IF NOT EXISTS incorrect_description BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE pilot_feature_reviews
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE pilot_feature_reviews
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(128) NOT NULL DEFAULT 'system';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pilot_feature_reviews_status_check'
  ) THEN
    ALTER TABLE pilot_feature_reviews
      ADD CONSTRAINT pilot_feature_reviews_status_check
      CHECK (status IN ('unreviewed', 'needs_fix', 'beta', 'hidden', 'ready'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pilot_feature_reviews_admin_comment_length_check'
  ) THEN
    ALTER TABLE pilot_feature_reviews
      ADD CONSTRAINT pilot_feature_reviews_admin_comment_length_check
      CHECK (admin_comment IS NULL OR LENGTH(admin_comment) <= 2000);
  END IF;
END
$$;

-- ============================================================================
-- S07 DDL — Read-only user impersonation sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id              VARCHAR(64) PRIMARY KEY,
  impersonator_id VARCHAR(64) NOT NULL,
  target_user_id  VARCHAR(64) NOT NULL,
  reason          VARCHAR(512),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  VARCHAR(64),
  last_used_at    TIMESTAMPTZ,
  user_agent      VARCHAR(256),
  ip_hash         VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_imp_sessions_active
  ON impersonation_sessions (impersonator_id, revoked_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_imp_sessions_expiry
  ON impersonation_sessions (expires_at)
  WHERE revoked_at IS NULL;

-- ============================================================================
-- EC2 / portable deployment — retire per-user JSON product state (M001)
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lifecycle JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan VARCHAR(16) NOT NULL DEFAULT 'pro'
    CHECK (plan IN ('free', 'pro', 'enterprise'));

-- Portfolio holdings (replaces users/<id>/data/portfolio.json).
CREATE TABLE IF NOT EXISTS user_portfolios (
  user_id     VARCHAR(64) PRIMARY KEY,
  body        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_portfolios_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);

-- Per-user control banners/restrictions (replaces users/<id>/control.json).
CREATE TABLE IF NOT EXISTS user_control (
  user_id     VARCHAR(64) PRIMARY KEY,
  body        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_control_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);

-- System-wide lock/broadcast (replaces data/system-control.json).
CREATE TABLE IF NOT EXISTS system_control (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  body        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_control (id, body)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Support inbox (replaces data/support-messages.json).
CREATE TABLE IF NOT EXISTS support_messages (
  id          VARCHAR(64) PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL,
  subject     VARCHAR(256) NOT NULL,
  message     TEXT NOT NULL,
  source      VARCHAR(32) NOT NULL,
  page        VARCHAR(128),
  status      VARCHAR(16) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_status_created
  ON support_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_user
  ON support_messages (user_id, created_at DESC);

-- Investor profile prompt (replaces users/<id>/USER.md).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS persona_md TEXT;

-- Analyst report JSON and orchestration blobs (replaces users/<id>/data/reports/*).
CREATE TABLE IF NOT EXISTS report_artifacts (
  user_id      VARCHAR(64) NOT NULL,
  ticker       VARCHAR(32) NOT NULL,
  artifact_key VARCHAR(64) NOT NULL,
  payload      JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker, artifact_key),
  CONSTRAINT fk_report_artifacts_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_artifacts_user_updated
  ON report_artifacts (user_id, updated_at DESC);

-- Job/orchestration state (replaces full_report_state.json, deep_dive_state.json, etc.).
CREATE TABLE IF NOT EXISTS orchestration_state (
  user_id    VARCHAR(64) NOT NULL,
  state_key  VARCHAR(128) NOT NULL,
  payload    JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, state_key),
  CONSTRAINT fk_orchestration_state_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================================================
-- Phase 8 DDL — DB-first feed, notifications, report index
-- Replaces users/{id}/feed/events.json and users/{id}/feed/notifications.json
-- (file-only paths removed; notification_preferences migrated off profile.json)
-- ============================================================================

-- §8.1 feed_events — replaces users/{id}/feed/events.json (market_news items).
CREATE TABLE IF NOT EXISTS feed_events (
  id         VARCHAR(64) PRIMARY KEY,
  user_id    VARCHAR(64) NOT NULL,
  kind       VARCHAR(32) NOT NULL DEFAULT 'market_news',
  ticker     VARCHAR(32) NOT NULL,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  source     VARCHAR(128) NOT NULL,
  url        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_feed_events_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feed_events_user_created
  ON feed_events (user_id, created_at DESC);

-- §8.2 notification_preferences on users — replaces profile.json `notifications` field.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
