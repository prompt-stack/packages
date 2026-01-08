/**
 * Database schema definitions and migrations
 */

import { getDb } from './index.js';

export const SCHEMA_VERSION = 4;

const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- =============================================================================
-- SESSIONS/CONVERSATIONS (existing)
-- =============================================================================

-- Projects (provider-scoped groupings)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'ollama')),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  cross_project_id TEXT,
  session_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  created_at TEXT NOT NULL,

  UNIQUE(provider, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_provider ON projects(provider);

-- Sessions (conversation containers)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'ollama')),
  provider_session_id TEXT,
  project_id TEXT,

  -- Origin tracking
  origin TEXT NOT NULL CHECK (origin IN ('rudi', 'provider-import', 'mixed')),
  origin_imported_at TEXT,
  origin_native_file TEXT,

  -- Display
  title TEXT,
  snippet TEXT,

  -- State
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  model TEXT,

  -- Context
  cwd TEXT,
  git_branch TEXT,
  native_storage_path TEXT,

  -- Timestamps
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  deleted_at TEXT,

  -- Aggregates (denormalized for performance)
  turn_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_provider_session ON sessions(provider, provider_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

-- Turns (individual user->assistant exchanges)
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT,

  -- Sequence
  turn_number INTEGER NOT NULL,

  -- Content
  user_message TEXT,
  assistant_response TEXT,
  thinking TEXT,

  -- Config at time of turn
  model TEXT,
  permission_mode TEXT,

  -- Metrics
  cost REAL,
  duration_ms INTEGER,
  duration_api_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,

  -- Completion
  finish_reason TEXT,
  error TEXT,

  -- Rich metadata (JSON)
  tools_used TEXT,

  -- Timestamps
  ts TEXT NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts DESC);
CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model);
CREATE INDEX IF NOT EXISTS idx_turns_session_number ON turns(session_id, turn_number);

-- Full-text search on turns
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  user_message,
  assistant_response,
  content='turns',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts(rowid, user_message, assistant_response)
  VALUES (NEW.rowid, NEW.user_message, NEW.assistant_response);
END;

CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, user_message, assistant_response)
  VALUES ('delete', OLD.rowid, OLD.user_message, OLD.assistant_response);
END;

CREATE TRIGGER IF NOT EXISTS turns_au AFTER UPDATE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, user_message, assistant_response)
  VALUES ('delete', OLD.rowid, OLD.user_message, OLD.assistant_response);
  INSERT INTO turns_fts(rowid, user_message, assistant_response)
  VALUES (NEW.rowid, NEW.user_message, NEW.assistant_response);
END;

-- Tags (many-to-many with sessions)
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS session_tags (
  session_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (session_id, tag_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Model pricing (for cost calculation)
CREATE TABLE IF NOT EXISTS model_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'openai', 'ollama')),
  model_pattern TEXT NOT NULL,
  display_name TEXT,
  input_cost_per_mtok REAL NOT NULL,
  output_cost_per_mtok REAL NOT NULL,
  cache_read_cost_per_mtok REAL DEFAULT 0,
  cache_write_cost_per_mtok REAL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  notes TEXT,

  UNIQUE(provider, model_pattern, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);
CREATE INDEX IF NOT EXISTS idx_model_pricing_pattern ON model_pricing(model_pattern);

-- =============================================================================
-- PACKAGES (stacks, prompts, runtimes, binaries, agents)
-- =============================================================================

-- Installed packages
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,              -- e.g., 'stack:pdf-creator', 'binary:ffmpeg', 'agent:claude'
  kind TEXT NOT NULL CHECK (kind IN ('stack', 'prompt', 'runtime', 'binary', 'tool', 'agent')),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,

  -- Source
  source TEXT NOT NULL CHECK (source IN ('registry', 'local', 'bundled')),
  source_url TEXT,

  -- Installation
  install_path TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT,

  -- Metadata (JSON)
  manifest_json TEXT,

  -- State
  status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'broken'))
);

CREATE INDEX IF NOT EXISTS idx_packages_kind ON packages(kind);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

-- Package dependencies
CREATE TABLE IF NOT EXISTS package_deps (
  package_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,         -- e.g., 'runtime:python'
  version_constraint TEXT,          -- e.g., '>=3.10'
  PRIMARY KEY (package_id, depends_on),
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

-- Stack runs
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  package_version TEXT NOT NULL,

  -- Inputs/outputs (JSON)
  inputs_json TEXT,
  outputs_json TEXT,

  -- Secrets used (names only, not values)
  secrets_used TEXT,                -- JSON array of secret names

  -- Execution
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  exit_code INTEGER,
  error TEXT,

  -- Context
  cwd TEXT,

  -- Timestamps
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,

  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_package ON runs(package_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

-- Run artifacts (files produced by runs)
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,

  -- File info
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,

  -- Metadata
  created_at TEXT NOT NULL,

  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

-- Lockfiles (for reproducibility)
CREATE TABLE IF NOT EXISTS lockfiles (
  package_id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,       -- Full lockfile content
  created_at TEXT NOT NULL,
  updated_at TEXT,

  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

-- =============================================================================
-- SECRETS (metadata only - actual values stored elsewhere)
-- =============================================================================

CREATE TABLE IF NOT EXISTS secrets_meta (
  name TEXT PRIMARY KEY,            -- e.g., 'VERCEL_TOKEN'
  description TEXT,
  hint TEXT,                        -- e.g., 'Starts with vcel_'
  link TEXT,                        -- URL for setup help
  added_at TEXT NOT NULL,
  last_used_at TEXT
);
`;

/**
 * Initialize the database schema
 * Creates all tables if they don't exist, runs migrations if needed
 */
export function initSchema() {
  const db = getDb();

  // Check current version
  const hasVersionTable = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'
  `).get();

  if (!hasVersionTable) {
    // Fresh install - run full schema
    console.log('Initializing database schema...');
    db.exec(SCHEMA_SQL);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString());

    seedModelPricing(db);
    console.log(`Database initialized at schema version ${SCHEMA_VERSION}`);
    return { version: SCHEMA_VERSION, migrated: false };
  }

  // Check for migrations
  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get().v || 0;

  if (currentVersion < SCHEMA_VERSION) {
    runMigrations(db, currentVersion, SCHEMA_VERSION);
    return { version: SCHEMA_VERSION, migrated: true, from: currentVersion };
  }

  return { version: currentVersion, migrated: false };
}

/**
 * Run schema migrations from one version to another
 * @param {Database.Database} db
 * @param {number} from - Current version
 * @param {number} to - Target version
 */
function runMigrations(db, from, to) {
  console.log(`Migrating database from v${from} to v${to}...`);

  // Migration functions keyed by target version
  const migrations = {
    // Version 2: Add model_pricing table
    2: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_pricing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'openai', 'ollama')),
          model_pattern TEXT NOT NULL,
          display_name TEXT,
          input_cost_per_mtok REAL NOT NULL,
          output_cost_per_mtok REAL NOT NULL,
          cache_read_cost_per_mtok REAL DEFAULT 0,
          cache_write_cost_per_mtok REAL DEFAULT 0,
          effective_from TEXT NOT NULL,
          effective_until TEXT,
          notes TEXT,
          UNIQUE(provider, model_pattern, effective_from)
        );
        CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);
        CREATE INDEX IF NOT EXISTS idx_model_pricing_pattern ON model_pricing(model_pattern);
      `);
      seedModelPricing(db);
    },

    // Version 3: Add packages, runs, artifacts, lockfiles, secrets_meta tables
    3: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS packages (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('stack', 'prompt', 'runtime', 'binary', 'tool', 'agent')),
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          description TEXT,
          source TEXT NOT NULL CHECK (source IN ('registry', 'local', 'bundled')),
          source_url TEXT,
          install_path TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          updated_at TEXT,
          manifest_json TEXT,
          status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'broken'))
        );
        CREATE INDEX IF NOT EXISTS idx_packages_kind ON packages(kind);
        CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

        CREATE TABLE IF NOT EXISTS package_deps (
          package_id TEXT NOT NULL,
          depends_on TEXT NOT NULL,
          version_constraint TEXT,
          PRIMARY KEY (package_id, depends_on),
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          package_id TEXT NOT NULL,
          package_version TEXT NOT NULL,
          inputs_json TEXT,
          outputs_json TEXT,
          secrets_used TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
          exit_code INTEGER,
          error TEXT,
          cwd TEXT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms INTEGER,
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_package ON runs(package_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          path TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

        CREATE TABLE IF NOT EXISTS lockfiles (
          package_id TEXT PRIMARY KEY,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS secrets_meta (
          name TEXT PRIMARY KEY,
          description TEXT,
          hint TEXT,
          link TEXT,
          added_at TEXT NOT NULL,
          last_used_at TEXT
        );
      `);
    },

    // Version 4: Allow binary kind in packages (rename tool -> binary)
    4: (db) => {
      db.exec(`
        PRAGMA foreign_keys=OFF;

        CREATE TABLE IF NOT EXISTS packages_new (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('stack', 'prompt', 'runtime', 'binary', 'tool', 'agent')),
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          description TEXT,
          source TEXT NOT NULL CHECK (source IN ('registry', 'local', 'bundled')),
          source_url TEXT,
          install_path TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          updated_at TEXT,
          manifest_json TEXT,
          status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'broken'))
        );

        INSERT INTO packages_new (
          id,
          kind,
          name,
          version,
          description,
          source,
          source_url,
          install_path,
          installed_at,
          updated_at,
          manifest_json,
          status
        )
        SELECT
          id,
          CASE WHEN kind = 'tool' THEN 'binary' ELSE kind END,
          name,
          version,
          description,
          source,
          source_url,
          install_path,
          installed_at,
          updated_at,
          manifest_json,
          status
        FROM packages;

        DROP TABLE packages;
        ALTER TABLE packages_new RENAME TO packages;

        CREATE INDEX IF NOT EXISTS idx_packages_kind ON packages(kind);
        CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

        PRAGMA foreign_keys=ON;
      `);
    }
  };

  for (let v = from + 1; v <= to; v++) {
    if (migrations[v]) {
      console.log(`  Applying migration v${v}...`);
      const applyMigration = () => {
        migrations[v](db);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
          .run(v, new Date().toISOString());
      };

      if (v === 4) {
        applyMigration();
      } else {
        db.transaction(applyMigration)();
      }
    }
  }

  console.log('Migrations complete.');
}

/**
 * Get current schema version
 * @returns {number}
 */
export function getSchemaVersion() {
  const db = getDb();
  try {
    const result = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
    return result?.v || 0;
  } catch {
    return 0;
  }
}

/**
 * Get all table names in the database
 * @returns {string[]}
 */
export function getTableNames() {
  const db = getDb();
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return tables.map(t => t.name);
}

/**
 * Get row count for a table
 * @param {string} tableName
 * @returns {number}
 */
export function getTableCount(tableName) {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
  return result?.count || 0;
}

/**
 * Seed model pricing data
 * Prices in USD per million tokens (MTok)
 * @param {Database.Database} db
 */
export function seedModelPricing(db) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO model_pricing
    (provider, model_pattern, display_name, input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok, effective_from, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pricingData = [
    // Claude models (Anthropic)
    ['claude', 'claude-opus-4-5-%', 'Claude Opus 4.5', 15.0, 75.0, 1.5, 18.75, '2025-01-01', 'Most capable'],
    ['claude', 'claude-sonnet-4-5-%', 'Claude Sonnet 4.5', 3.0, 15.0, 0.3, 3.75, '2025-01-01', 'Best balance'],
    ['claude', 'claude-haiku-4-5-%', 'Claude Haiku 4.5', 0.8, 4.0, 0.08, 1.0, '2025-01-01', 'Fastest'],
    ['claude', 'claude-opus-4-1-%', 'Claude Opus 4.1', 15.0, 75.0, 1.5, 18.75, '2025-01-01', 'Previous gen'],
    ['claude', 'claude-3-5-haiku-%', 'Claude 3.5 Haiku', 0.8, 4.0, 0.08, 1.0, '2024-10-01', 'Legacy'],
    ['claude', 'claude-3-5-sonnet-%', 'Claude 3.5 Sonnet', 3.0, 15.0, 0.3, 3.75, '2024-06-01', 'Legacy'],

    // Codex/OpenAI models
    ['codex', 'gpt-5.1-codex-max', 'Codex Max', 10.0, 30.0, 0, 0, '2025-01-01', 'Most capable'],
    ['codex', 'gpt-5.1-codex-mini', 'Codex Mini', 1.5, 6.0, 0, 0, '2025-01-01', 'Fastest'],
    ['codex', 'gpt-5.1-codex', 'Codex Standard', 5.0, 15.0, 0, 0, '2025-01-01', 'Default'],
    ['codex', 'gpt-5-codex', 'Codex 5', 5.0, 15.0, 0, 0, '2025-01-01', 'Previous gen'],
    ['codex', 'gpt-4o', 'GPT-4o', 5.0, 15.0, 0, 0, '2024-05-01', 'Multimodal'],
    ['codex', 'gpt-4o-mini', 'GPT-4o Mini', 0.15, 0.6, 0, 0, '2024-07-01', 'Fast/cheap'],
    ['codex', 'o1', 'o1', 15.0, 60.0, 0, 0, '2024-12-01', 'Reasoning'],
    ['codex', 'o1-mini', 'o1 Mini', 3.0, 12.0, 0, 0, '2024-09-01', 'Reasoning light'],
    ['codex', 'o3-mini', 'o3 Mini', 1.1, 4.4, 0, 0, '2025-01-01', 'Latest reasoning'],

    // Gemini models
    ['gemini', 'gemini-2.5-pro%', 'Gemini 2.5 Pro', 1.25, 5.0, 0, 0, '2025-01-01', 'Most capable'],
    ['gemini', 'gemini-2.5-flash%', 'Gemini 2.5 Flash', 0.075, 0.3, 0, 0, '2025-01-01', 'Fast/cheap'],
    ['gemini', 'gemini-2.0-flash%', 'Gemini 2.0 Flash', 0.1, 0.4, 0, 0, '2024-12-01', 'Previous flash'],
    ['gemini', 'gemini-1.5-pro%', 'Gemini 1.5 Pro', 1.25, 5.0, 0, 0, '2024-05-01', 'Legacy pro'],
    ['gemini', 'gemini-1.5-flash%', 'Gemini 1.5 Flash', 0.075, 0.3, 0, 0, '2024-05-01', 'Legacy flash'],
    ['gemini', 'gemini%', 'Gemini (default)', 0.1, 0.4, 0, 0, '2024-01-01', 'Fallback'],

    // Ollama (local - free)
    ['ollama', '%', 'Local Model', 0, 0, 0, 0, '2024-01-01', 'Free local inference'],
  ];

  for (const row of pricingData) {
    insert.run(...row);
  }

  console.log(`  Seeded ${pricingData.length} model pricing entries`);
}

/**
 * Get pricing for a model
 * @param {string} provider
 * @param {string} model
 * @returns {Object|null}
 */
export function getModelPricing(provider, model) {
  const db = getDb();

  const pricing = db.prepare(`
    SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok
    FROM model_pricing
    WHERE provider = ?
      AND (model_pattern = ? OR ? LIKE model_pattern)
      AND (effective_until IS NULL OR effective_until > datetime('now'))
    ORDER BY
      CASE WHEN model_pattern = ? THEN 0 ELSE 1 END,
      effective_from DESC
    LIMIT 1
  `).get(provider, model, model, model);

  return pricing || null;
}

/**
 * Calculate cost from tokens using pricing table
 * @param {string} provider
 * @param {string} model
 * @param {Object} usage
 * @returns {number} Cost in USD
 */
export function calculateCostFromPricing(provider, model, usage) {
  if (!usage) return 0;

  const pricing = getModelPricing(provider, model);
  if (!pricing) {
    // Fallback to default pricing
    const inputCost = (usage.input_tokens || 0) * 3 / 1_000_000;
    const outputCost = (usage.output_tokens || 0) * 15 / 1_000_000;
    const cacheReadCost = (usage.cache_read_tokens || 0) * 0.3 / 1_000_000;
    return inputCost + outputCost + cacheReadCost;
  }

  const inputCost = (usage.input_tokens || 0) * pricing.input_cost_per_mtok / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * pricing.output_cost_per_mtok / 1_000_000;
  const cacheReadCost = (usage.cache_read_tokens || 0) * (pricing.cache_read_cost_per_mtok || 0) / 1_000_000;

  return inputCost + outputCost + cacheReadCost;
}
