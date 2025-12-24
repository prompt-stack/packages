/**
 * Stats module for Prompt Stack
 * Provides aggregation queries for usage analytics
 */

import { getDb } from './index.js';

/**
 * Get comprehensive usage statistics
 */
export function getStats() {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(turn_count) as total_turns,
      SUM(total_cost) as total_cost,
      SUM(total_input_tokens) as total_input_tokens,
      SUM(total_output_tokens) as total_output_tokens,
      SUM(total_duration_ms) as total_duration_ms
    FROM sessions
    WHERE status != 'deleted'
  `).get();

  const byProvider = db.prepare(`
    SELECT
      provider,
      COUNT(*) as sessions,
      SUM(turn_count) as turns,
      SUM(total_cost) as cost,
      SUM(total_input_tokens) as input_tokens,
      SUM(total_output_tokens) as output_tokens
    FROM sessions
    WHERE status != 'deleted'
    GROUP BY provider
    ORDER BY cost DESC
  `).all();

  const byModel = db.prepare(`
    SELECT
      model,
      COUNT(*) as turns,
      SUM(cost) as cost,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM turns
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY cost DESC
    LIMIT 10
  `).all();

  const recentActivity = db.prepare(`
    SELECT
      DATE(last_active_at) as date,
      COUNT(*) as sessions,
      SUM(total_cost) as cost,
      SUM(turn_count) as turns
    FROM sessions
    WHERE last_active_at > datetime('now', '-30 days')
      AND status != 'deleted'
    GROUP BY DATE(last_active_at)
    ORDER BY date DESC
  `).all();

  const topSessions = db.prepare(`
    SELECT
      id,
      title,
      provider,
      turn_count,
      total_cost,
      last_active_at
    FROM sessions
    WHERE status != 'deleted'
    ORDER BY turn_count DESC
    LIMIT 10
  `).all();

  const toolsUsage = getToolsUsage(db);

  return {
    totalSessions: totals.total_sessions || 0,
    totalTurns: totals.total_turns || 0,
    totalCost: totals.total_cost || 0,
    totalInputTokens: totals.total_input_tokens || 0,
    totalOutputTokens: totals.total_output_tokens || 0,
    totalDurationMs: totals.total_duration_ms || 0,
    byProvider: byProvider.reduce((acc, row) => {
      acc[row.provider] = {
        sessions: row.sessions,
        turns: row.turns || 0,
        cost: row.cost || 0,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0
      };
      return acc;
    }, {}),
    byModel,
    recentActivity,
    topSessions,
    toolsUsage
  };
}

/**
 * Get tools usage statistics
 */
export function getToolsUsage(db) {
  if (!db) db = getDb();

  const turns = db.prepare(`
    SELECT tools_used FROM turns WHERE tools_used IS NOT NULL
  `).all();

  const toolCounts = {};

  for (const turn of turns) {
    try {
      const tools = JSON.parse(turn.tools_used);
      for (const tool of tools) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));
}

/**
 * Get stats for a specific time period
 */
export function getStatsByPeriod(period = 'month') {
  const db = getDb();

  const periodMap = {
    day: '-1 day',
    week: '-7 days',
    month: '-30 days',
    year: '-365 days'
  };

  const offset = periodMap[period] || '-30 days';

  const stats = db.prepare(`
    SELECT
      COUNT(*) as sessions,
      SUM(turn_count) as turns,
      SUM(total_cost) as cost,
      SUM(total_input_tokens) as input_tokens,
      SUM(total_output_tokens) as output_tokens
    FROM sessions
    WHERE last_active_at > datetime('now', ?)
      AND status != 'deleted'
  `).get(offset);

  return {
    period,
    sessions: stats.sessions || 0,
    turns: stats.turns || 0,
    cost: stats.cost || 0,
    inputTokens: stats.input_tokens || 0,
    outputTokens: stats.output_tokens || 0
  };
}

/**
 * Get stats for a specific provider
 */
export function getStatsByProvider(provider) {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as sessions,
      SUM(turn_count) as turns,
      SUM(total_cost) as cost,
      SUM(total_input_tokens) as input_tokens,
      SUM(total_output_tokens) as output_tokens
    FROM sessions
    WHERE provider = ? AND status != 'deleted'
  `).get(provider);

  const byModel = db.prepare(`
    SELECT
      t.model,
      COUNT(*) as turns,
      SUM(t.cost) as cost
    FROM turns t
    JOIN sessions s ON t.session_id = s.id
    WHERE s.provider = ?
    GROUP BY t.model
    ORDER BY cost DESC
    LIMIT 10
  `).all(provider);

  const recentSessions = db.prepare(`
    SELECT id, title, turn_count, total_cost, last_active_at
    FROM sessions
    WHERE provider = ? AND status != 'deleted'
    ORDER BY last_active_at DESC
    LIMIT 10
  `).all(provider);

  return {
    provider,
    sessions: totals.sessions || 0,
    turns: totals.turns || 0,
    cost: totals.cost || 0,
    inputTokens: totals.input_tokens || 0,
    outputTokens: totals.output_tokens || 0,
    byModel,
    recentSessions
  };
}

/**
 * Get daily activity for the last N days
 */
export function getDailyActivity(days = 30) {
  const db = getDb();

  return db.prepare(`
    SELECT
      DATE(last_active_at) as date,
      provider,
      COUNT(*) as sessions,
      SUM(turn_count) as turns,
      SUM(total_cost) as cost
    FROM sessions
    WHERE last_active_at > datetime('now', ?)
      AND status != 'deleted'
    GROUP BY DATE(last_active_at), provider
    ORDER BY date DESC, provider
  `).all(`-${days} days`);
}

/**
 * Get cost breakdown
 */
export function getCostBreakdown() {
  const db = getDb();

  const byProvider = db.prepare(`
    SELECT
      provider,
      SUM(total_cost) as cost,
      COUNT(*) as sessions
    FROM sessions
    WHERE status != 'deleted'
    GROUP BY provider
    ORDER BY cost DESC
  `).all();

  const byMonth = db.prepare(`
    SELECT
      strftime('%Y-%m', last_active_at) as month,
      SUM(total_cost) as cost,
      SUM(turn_count) as turns
    FROM sessions
    WHERE status != 'deleted'
    GROUP BY strftime('%Y-%m', last_active_at)
    ORDER BY month DESC
    LIMIT 12
  `).all();

  const totalCost = db.prepare(`
    SELECT SUM(total_cost) as total FROM sessions WHERE status != 'deleted'
  `).get();

  return {
    total: totalCost.total || 0,
    byProvider: byProvider.reduce((acc, row) => {
      acc[row.provider] = { cost: row.cost || 0, sessions: row.sessions };
      return acc;
    }, {}),
    byMonth
  };
}

/**
 * Get session duration stats
 */
export function getDurationStats() {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      AVG(total_duration_ms) as avg_duration,
      MAX(total_duration_ms) as max_duration,
      MIN(CASE WHEN total_duration_ms > 0 THEN total_duration_ms END) as min_duration,
      SUM(total_duration_ms) as total_duration
    FROM sessions
    WHERE status != 'deleted' AND total_duration_ms > 0
  `).get();

  return {
    avgDurationMs: stats.avg_duration || 0,
    maxDurationMs: stats.max_duration || 0,
    minDurationMs: stats.min_duration || 0,
    totalDurationMs: stats.total_duration || 0,
    totalDurationHours: (stats.total_duration || 0) / 1000 / 60 / 60
  };
}

// =============================================================================
// PACKAGE STATS
// =============================================================================

/**
 * Get package statistics
 */
export function getPackageStats() {
  const db = getDb();

  const byKind = db.prepare(`
    SELECT kind, COUNT(*) as count
    FROM packages
    WHERE status = 'installed'
    GROUP BY kind
  `).all();

  const recentInstalls = db.prepare(`
    SELECT id, name, kind, version, installed_at
    FROM packages
    WHERE status = 'installed'
    ORDER BY installed_at DESC
    LIMIT 10
  `).all();

  const runStats = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(duration_ms) as avg_duration
    FROM runs
  `).get();

  const topPackages = db.prepare(`
    SELECT
      p.id,
      p.name,
      COUNT(r.id) as run_count
    FROM packages p
    LEFT JOIN runs r ON r.package_id = p.id
    WHERE p.status = 'installed'
    GROUP BY p.id
    ORDER BY run_count DESC
    LIMIT 10
  `).all();

  return {
    byKind: byKind.reduce((acc, row) => {
      acc[row.kind] = row.count;
      return acc;
    }, { stack: 0, prompt: 0, runtime: 0 }),
    recentInstalls,
    runs: {
      total: runStats.total_runs || 0,
      successful: runStats.successful || 0,
      failed: runStats.failed || 0,
      avgDurationMs: runStats.avg_duration || 0
    },
    topPackages
  };
}

/**
 * Get run history for a package
 */
export function getPackageRunHistory(packageId, limit = 20) {
  const db = getDb();

  return db.prepare(`
    SELECT *
    FROM runs
    WHERE package_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(packageId, limit);
}
