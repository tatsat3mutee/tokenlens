-- TokenLens — unified SQLite schema (source-agnostic).
-- One row per session, one row per LLM call, across both Claude Code and Copilot.

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,     -- prefixed: 'cc:<uuid>' | 'cp:<sid>'
  source TEXT NOT NULL,            -- 'claudeCode' | 'copilot'
  title TEXT,
  workspace TEXT,                  -- cwd / workspace path
  start_time INTEGER,              -- unix seconds
  end_time INTEGER,
  models_json TEXT,                -- JSON array of model ids
  total_calls INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,        -- fresh (uncached) input
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,         -- billed (copilot) or API-equivalent estimate (claudeCode)
  ai_credits REAL DEFAULT 0,       -- Copilot premium-request credits (aiu/1e9); 0 for Claude Code
  is_estimate INTEGER DEFAULT 0,   -- 1 when cost_usd is an estimate (claudeCode)
  cost_confidence TEXT DEFAULT 'none', -- 'billed' | 'estimate' | 'partial' | 'none'
  cache_breaks INTEGER DEFAULT 0,  -- count of cache resets within the session
  cache_break_causes_json TEXT,    -- {model_switch, system_prompt_change, tools_changed, eviction}
  cache_break_tokens INTEGER DEFAULT 0, -- fresh input tokens re-sent on cache-break calls
  cache_break_token_causes_json TEXT, -- same cause keys, token impact instead of counts
  has_unknown_model INTEGER DEFAULT 0,
  source_path TEXT,                -- absolute path to the source log file
  synced_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);

CREATE TABLE IF NOT EXISTS llm_calls (
  call_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ts INTEGER,                      -- unix seconds
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  ai_credits REAL DEFAULT 0,
  is_estimate INTEGER DEFAULT 0,
  is_subagent INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_calls_session ON llm_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_calls_ts ON llm_calls(ts);
CREATE INDEX IF NOT EXISTS idx_calls_model ON llm_calls(model);

-- Incremental-sync bookkeeping: skip files whose mtime+size+parser_version are unchanged.
CREATE TABLE IF NOT EXISTS sync_log (
  file_path TEXT PRIMARY KEY,
  session_id TEXT,
  source TEXT,
  mtime INTEGER,
  size INTEGER,
  parser_version INTEGER DEFAULT 1,
  synced_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Budget alerts already fired, so we notify at most once per period.
CREATE TABLE IF NOT EXISTS budget_alerts (
  period_key TEXT PRIMARY KEY,     -- e.g. 'day:2026-06-12:usd' | 'week:2026-W24:usd'
  notified_at INTEGER DEFAULT (strftime('%s','now'))
);
