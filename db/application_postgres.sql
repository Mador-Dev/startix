-- Startix application schema — idempotent, safe to re-run on every startup.

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id                  VARCHAR(64) PRIMARY KEY,
  display_name             VARCHAR(128) NOT NULL,
  password_hash            VARCHAR(128) NOT NULL,
  token_version            INTEGER NOT NULL DEFAULT 0,
  schedule                 JSONB NOT NULL DEFAULT '{"dailyBriefTime":"08:00","weeklyResearchDay":"sunday","weeklyResearchTime":"19:00","timezone":"Asia/Jerusalem"}'::jsonb,
  rate_limits              JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_tier               VARCHAR(32) NOT NULL DEFAULT 'balanced'
                             CHECK (model_tier IN ('free','cheap','balanced','expensive')),
  model_profile            VARCHAR(64) NOT NULL DEFAULT 'testing',
  lot_method               VARCHAR(16) NOT NULL DEFAULT 'fifo'
                             CHECK (lot_method IN ('fifo','lifo','specific_lot')),
  max_single_position_pct  NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  stop_loss_threshold_pct  NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  state                    VARCHAR(32) NOT NULL DEFAULT 'INCOMPLETE'
                             CHECK (state IN ('INCOMPLETE','BOOTSTRAPPING','ACTIVE','BLOCKED')),
  restriction              VARCHAR(32),
  plan                     VARCHAR(16) NOT NULL DEFAULT 'pro'
                             CHECK (plan IN ('free','pro','enterprise')),
  lifecycle                JSONB NOT NULL DEFAULT '{}'::jsonb,
  persona_md               TEXT,
  notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  telegram_chat_id         VARCHAR(64),
  telegram_bot_token       TEXT,
  daily_points_budget      NUMERIC(12,3),
  points                   NUMERIC(12,3) NOT NULL DEFAULT 500,
  points_replenished_at    TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_points_budget NUMERIC(12,3);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS points NUMERIC(12,3) NOT NULL DEFAULT 500;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS points_replenished_at TIMESTAMPTZ;
-- Back-fill points for existing rows that have never been replenished.
UPDATE users
  SET points = COALESCE(daily_points_budget, 500)
  WHERE points_replenished_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_state ON users (state);

-- ── Portfolio ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_portfolios (
  user_id    VARCHAR(64) PRIMARY KEY,
  body       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_portfolios_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);

-- ── Strategies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  user_id                  VARCHAR(64) NOT NULL,
  ticker                   VARCHAR(32) NOT NULL,
  version                  INTEGER NOT NULL DEFAULT 1,
  asset_scope              VARCHAR(16) NOT NULL DEFAULT 'portfolio'
                             CHECK (asset_scope IN ('portfolio','tracking')),
  asset_class              VARCHAR(16) NOT NULL DEFAULT 'equity'
                             CHECK (asset_class IN ('equity','etf','bond','fund','crypto','index','other')),
  tracking_status          VARCHAR(16),
  verdict                  VARCHAR(16) NOT NULL
                             CHECK (verdict IN ('BUY','ADD','HOLD','REDUCE','SELL','CLOSE')),
  confidence               VARCHAR(8) NOT NULL CHECK (confidence IN ('high','medium','low')),
  reasoning                TEXT NOT NULL,
  timeframe                VARCHAR(16) NOT NULL,
  position_size_ils        NUMERIC(18,2) NOT NULL DEFAULT 0,
  position_weight_pct      NUMERIC(7,4) NOT NULL DEFAULT 0,
  entry_conditions         JSONB NOT NULL DEFAULT '[]'::jsonb,
  exit_conditions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  catalysts                JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_catalysts         JSONB NOT NULL DEFAULT '[]'::jsonb,
  avoid_conditions         JSONB NOT NULL DEFAULT '[]'::jsonb,
  bull_case                TEXT,
  bear_case                TEXT,
  stance                   VARCHAR(16),
  potential_score          NUMERIC(6,2),
  urgency_score            NUMERIC(6,2),
  urgency_label            VARCHAR(16),
  portfolio_fit_score      NUMERIC(6,2),
  suggested_allocation_pct NUMERIC(7,4),
  suggested_allocation_ils NUMERIC(18,2),
  last_deep_dive_at        TIMESTAMPTZ,
  deep_dive_triggered_by   VARCHAR(64),
  next_review_at           TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_strategies_user_scope
  ON strategies (user_id, asset_scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_user_verdict
  ON strategies (user_id, verdict);
CREATE INDEX IF NOT EXISTS idx_strategies_next_review
  ON strategies (user_id, next_review_at)
  WHERE next_review_at IS NOT NULL;
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS derived_from_run_id UUID;

-- ── Report artifacts ──────────────────────────────────────────────────────────
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

-- ── Jobs ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                VARCHAR(128) PRIMARY KEY,
  user_id           VARCHAR(64) NOT NULL,
  action            VARCHAR(64) NOT NULL,
  status            VARCHAR(32) NOT NULL,
  source            VARCHAR(64) NOT NULL,
  model_tier        VARCHAR(32) NOT NULL,
  notify_per_ticker BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  failure_reason    TEXT,
  result            JSONB
);
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS notify_per_ticker BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS budget_admitted_at TIMESTAMPTZ;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pause_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs (user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_triggered ON jobs (status, triggered_at);

-- ── Tracked assets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_assets (
  user_id             VARCHAR(64) NOT NULL,
  ticker              VARCHAR(32) NOT NULL,
  asset_class         VARCHAR(16) NOT NULL DEFAULT 'equity'
                        CHECK (asset_class IN ('equity','etf','bond','fund','crypto','index','other')),
  status              VARCHAR(32) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','muted','archived')),
  created_from_job_id VARCHAR(128),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ,
  PRIMARY KEY (user_id, ticker)
);
ALTER TABLE tracked_assets
  ADD COLUMN IF NOT EXISTS created_from_job_id VARCHAR(128);
ALTER TABLE tracked_assets
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tracked_assets_user_status
  ON tracked_assets (user_id, status, updated_at DESC);

-- Points ledger
CREATE TABLE IF NOT EXISTS user_points_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR(64) NOT NULL,
  points_delta NUMERIC(12,3) NOT NULL,
  entry_type  VARCHAR(16) NOT NULL
                CHECK (entry_type IN ('usage','credit','adjustment')),
  source      VARCHAR(64) NOT NULL,
  action      VARCHAR(64),
  ref_id      VARCHAR(128),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_points_ledger_user_expires
  ON user_points_ledger (user_id, expires_at DESC, created_at DESC);

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications_outbox (
  id           VARCHAR(64) PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL,
  category     VARCHAR(32) NOT NULL,
  channel      VARCHAR(16) NOT NULL,
  title        VARCHAR(256) NOT NULL,
  body         TEXT NOT NULL,
  ticker       VARCHAR(32),
  batch_id     VARCHAR(128),
  delivered    BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications_outbox (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications_outbox (user_id, channel)
  WHERE read_at IS NULL;

-- ── Support messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id         VARCHAR(64) PRIMARY KEY,
  user_id    VARCHAR(64) NOT NULL,
  subject    VARCHAR(256) NOT NULL,
  message    TEXT NOT NULL,
  source     VARCHAR(32) NOT NULL,
  page       VARCHAR(128),
  status     VARCHAR(16) NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','in_progress','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_status_created
  ON support_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_user
  ON support_messages (user_id, created_at DESC);

-- ── Verdict actions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verdict_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- ── Ticker snoozes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticker_snoozes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                VARCHAR(64) NOT NULL,
  ticker                 VARCHAR(32) NOT NULL,
  snooze_until           TIMESTAMPTZ NOT NULL,
  signal_set_fingerprint VARCHAR(64) NOT NULL,
  reason                 TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticker_snoozes_active
  ON ticker_snoozes (user_id, ticker, snooze_until DESC);

-- ── Analyst config ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_analyst_config (
  user_id    VARCHAR(64) NOT NULL,
  step_kind  VARCHAR(64) NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, step_kind)
);

-- ── Controls ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_control (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  body       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO system_control (id, body)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_control (
  user_id    VARCHAR(64) PRIMARY KEY,
  body       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_control_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);

-- ── Admin defaults ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_defaults (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'system'
);

-- ── Analysis runs ────────────────────────────────────────────────────────────
-- One row per (job × ticker). Groups all analyst reports for a single analysis.
CREATE TABLE IF NOT EXISTS analysis_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          VARCHAR(128) NOT NULL,
  user_id         VARCHAR(64) NOT NULL,
  ticker          VARCHAR(32) NOT NULL,
  run_type        VARCHAR(32) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  cost_points     NUMERIC(12,3),
  progress        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_analysis_runs_job FOREIGN KEY (job_id)
    REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_job ON analysis_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_ticker
  ON analysis_runs (user_id, ticker, created_at DESC);

-- ── Analyst reports ───────────────────────────────────────────────────────────
-- One row per analyst per analysis_run. Replaces report_artifacts for new writes.
CREATE TABLE IF NOT EXISTS analyst_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id UUID NOT NULL,
  user_id         VARCHAR(64) NOT NULL,
  ticker          VARCHAR(32) NOT NULL,
  analyst_type    VARCHAR(32) NOT NULL,
  round           INTEGER,
  payload         JSONB NOT NULL,
  sources         TEXT[] NOT NULL DEFAULT '{}',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_analyst_reports_run FOREIGN KEY (analysis_run_id)
    REFERENCES analysis_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_analyst_reports_run ON analyst_reports (analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_analyst_reports_user_ticker
  ON analyst_reports (user_id, ticker, generated_at DESC);

-- ── Feed items ────────────────────────────────────────────────────────────────
-- One row per completed job (report/brief/deep_dive). Replaces jobs.result.batch parsing.
CREATE TABLE IF NOT EXISTS feed_items (
  id          VARCHAR(64) PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL,
  job_id      VARCHAR(128),
  kind        VARCHAR(32) NOT NULL
                CHECK (kind IN ('daily_brief','report','deep_dive','quick_check','market_news')),
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  tone        VARCHAR(16) NOT NULL DEFAULT 'amber',
  tickers     TEXT[] NOT NULL DEFAULT '{}',
  highlights  JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_feed_items_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feed_items_user_created
  ON feed_items (user_id, created_at DESC);

-- ── Feed events ───────────────────────────────────────────────────────────────
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

-- ── Conversations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    VARCHAR(64) NOT NULL,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations (user_id, created_at DESC);

-- ── Chat memory ───────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS conversation_sequence;

CREATE TABLE IF NOT EXISTS chat_memory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sequence_number BIGINT NOT NULL DEFAULT nextval('conversation_sequence'),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_memory_conv
  ON chat_memory (conversation_id, sequence_number);
