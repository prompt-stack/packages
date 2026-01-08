/**
 * Observability logs - Query and storage for agent visibility events
 */

import { getDb } from './index.js';

/**
 * Store a log event
 * @param {Object} event - Visibility event from AgentVisibility service
 */
function storeLogEvent(event) {
  const db = getDb();

  const insert = db.prepare(`
    INSERT INTO logs (timestamp, source, level, type, provider, cid, session_id, terminal_id, feature, step, duration_ms, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    event.timestamp,
    event.source || 'unknown',
    event.data?.level || 'info',
    event.type,
    event.data?.provider || null,
    event.cid || null,
    event.data?.sessionId || null,
    event.data?.terminalId || null,
    event.data?.feature || null,
    event.data?.step || null,
    event.data?.durationMs || event.data?.duration_ms || null,
    JSON.stringify(event.data || {})
  );
}

/**
 * Query logs with filters
 * @param {Object} options - Filter options
 * @returns {Array} Log events
 */
function queryLogs(options = {}) {
  const db = getDb();

  const {
    limit = 50,
    offset = 0,
    since,
    until,
    source,
    level,
    type,
    provider,
    sessionId,
    terminalId,
    search,
    slowOnly = false,
    slowThreshold = 1000
  } = options;

  let query = 'SELECT * FROM logs WHERE 1=1';
  const params = [];

  // Time filters
  if (since) {
    query += ' AND timestamp >= ?';
    params.push(since);
  }
  if (until) {
    query += ' AND timestamp <= ?';
    params.push(until);
  }

  // Attribute filters
  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }
  if (level) {
    query += ' AND level = ?';
    params.push(level);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (provider) {
    query += ' AND provider = ?';
    params.push(provider);
  }
  if (sessionId) {
    query += ' AND session_id = ?';
    params.push(sessionId);
  }
  if (terminalId !== undefined) {
    query += ' AND terminal_id = ?';
    params.push(terminalId);
  }

  // Text search in JSON data
  if (search) {
    query += ' AND data_json LIKE ?';
    params.push(`%${search}%`);
  }

  // Performance filter
  if (slowOnly) {
    query += ' AND duration_ms >= ?';
    params.push(slowThreshold);
  }

  // Order and limit
  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

/**
 * Get log statistics
 * @param {Object} options - Filter options (same as queryLogs)
 * @returns {Object} Statistics summary
 */
function getLogStats(options = {}) {
  const db = getDb();

  const { since, until, search } = options;

  let whereClause = '1=1';
  const params = [];

  if (since) {
    whereClause += ' AND timestamp >= ?';
    params.push(since);
  }
  if (until) {
    whereClause += ' AND timestamp <= ?';
    params.push(until);
  }
  if (search) {
    whereClause += ' AND data_json LIKE ?';
    params.push(`%${search}%`);
  }

  // Total counts
  const total = db.prepare(`SELECT COUNT(*) as count FROM logs WHERE ${whereClause}`).get(...params);

  // By source
  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM logs
    WHERE ${whereClause}
    GROUP BY source
    ORDER BY count DESC
  `).all(...params);

  // By level
  const byLevel = db.prepare(`
    SELECT level, COUNT(*) as count
    FROM logs
    WHERE ${whereClause}
    GROUP BY level
    ORDER BY
      CASE level
        WHEN 'error' THEN 1
        WHEN 'warn' THEN 2
        WHEN 'info' THEN 3
        WHEN 'debug' THEN 4
      END
  `).all(...params);

  // By provider
  const byProvider = db.prepare(`
    SELECT provider, COUNT(*) as count
    FROM logs
    WHERE ${whereClause} AND provider IS NOT NULL
    GROUP BY provider
    ORDER BY count DESC
  `).all(...params);

  // Slowest operations
  const slowest = db.prepare(`
    SELECT type, source,
      AVG(duration_ms) as avg_duration,
      MAX(duration_ms) as max_duration,
      MIN(duration_ms) as min_duration,
      COUNT(*) as count
    FROM logs
    WHERE ${whereClause} AND duration_ms IS NOT NULL
    GROUP BY type, source
    HAVING count >= 3
    ORDER BY avg_duration DESC
    LIMIT 10
  `).all(...params);

  return {
    total: total.count,
    bySource: bySource.reduce((acc, r) => ({ ...acc, [r.source]: r.count }), {}),
    byLevel: byLevel.reduce((acc, r) => ({ ...acc, [r.level]: r.count }), {}),
    byProvider: byProvider.reduce((acc, r) => ({ ...acc, [r.provider]: r.count }), {}),
    slowest: slowest.map(r => ({
      operation: `${r.source}:${r.type}`,
      avgMs: Math.round(r.avg_duration),
      maxMs: r.max_duration,
      minMs: r.min_duration,
      count: r.count
    }))
  };
}

/**
 * Get logs from the last N milliseconds
 * @param {number} ms - Milliseconds to look back
 * @returns {Array} Log events
 */
function getRecentLogs(ms = 60000) {
  const since = Date.now() - ms;
  return queryLogs({ since, limit: 100 });
}

/**
 * Get logs before a crash (last 30 seconds)
 * @returns {Array} Log events
 */
function getBeforeCrashLogs() {
  return getRecentLogs(30000);
}

/**
 * Clean up old logs (retention policy)
 * @param {number} retentionDays - Days to keep logs (default: 7)
 * @returns {number} Number of deleted logs
 */
function cleanupOldLogs(retentionDays = 7) {
  const db = getDb();
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  const result = db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoffTime);
  return result.changes;
}

/**
 * Get log count
 * @returns {number} Total logs in database
 */
function getLogCount() {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM logs').get();
  return result.count;
}

export {
  storeLogEvent,
  queryLogs,
  getLogStats,
  getRecentLogs,
  getBeforeCrashLogs,
  cleanupOldLogs,
  getLogCount
};
