/**
 * Search module for RUDI
 * Provides full-text search using SQLite FTS5
 */

import { getDb } from './index.js';

/**
 * Search across all turns using FTS5
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} Search results
 */
export function search(query, options = {}) {
  const { limit = 20, provider, sessionId, offset = 0 } = options;
  const db = getDb();

  const ftsQuery = prepareFtsQuery(query);

  let sql = `
    SELECT
      t.id,
      t.session_id,
      t.turn_number,
      t.user_message,
      t.assistant_response,
      t.model,
      t.ts,
      s.title as session_title,
      s.provider,
      s.cwd,
      highlight(turns_fts, 0, '>>>', '<<<') as user_highlighted,
      highlight(turns_fts, 1, '>>>', '<<<') as assistant_highlighted,
      bm25(turns_fts) as rank
    FROM turns_fts
    JOIN turns t ON turns_fts.rowid = t.rowid
    JOIN sessions s ON t.session_id = s.id
    WHERE turns_fts MATCH ?
  `;

  const params = [ftsQuery];

  if (provider) {
    sql += ' AND s.provider = ?';
    params.push(provider);
  }

  if (sessionId) {
    sql += ' AND t.session_id = ?';
    params.push(sessionId);
  }

  sql += ` ORDER BY rank LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    return searchFallback(query, options);
  }
}

/**
 * Prepare a query string for FTS5
 */
export function prepareFtsQuery(query) {
  let cleaned = query
    .replace(/['"]/g, '')
    .replace(/[()]/g, '')
    .replace(/[-]/g, ' ')
    .replace(/[*]/g, '')
    .trim();

  const words = cleaned.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) {
    return '""';
  }

  if (words.length === 1) {
    return `"${words[0]}"*`;
  }

  return words.map(w => `"${w}"*`).join(' ');
}

/**
 * Fallback search using LIKE when FTS fails
 */
function searchFallback(query, options = {}) {
  const { limit = 20, provider, sessionId, offset = 0 } = options;
  const db = getDb();

  let sql = `
    SELECT
      t.id,
      t.session_id,
      t.turn_number,
      t.user_message,
      t.assistant_response,
      t.model,
      t.ts,
      s.title as session_title,
      s.provider,
      s.cwd
    FROM turns t
    JOIN sessions s ON t.session_id = s.id
    WHERE (t.user_message LIKE ? OR t.assistant_response LIKE ?)
  `;

  const likeQuery = `%${query}%`;
  const params = [likeQuery, likeQuery];

  if (provider) {
    sql += ' AND s.provider = ?';
    params.push(provider);
  }

  if (sessionId) {
    sql += ' AND t.session_id = ?';
    params.push(sessionId);
  }

  sql += ` ORDER BY t.ts DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

/**
 * Search sessions by title
 */
export function searchSessions(query, options = {}) {
  const { limit = 20, provider, status = 'active' } = options;
  const db = getDb();

  let sql = `
    SELECT * FROM sessions
    WHERE title LIKE ?
  `;

  const params = [`%${query}%`];

  if (provider) {
    sql += ' AND provider = ?';
    params.push(provider);
  }

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ` ORDER BY last_active_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * Search within a specific session
 */
export function searchInSession(sessionId, query) {
  const db = getDb();
  const ftsQuery = prepareFtsQuery(query);

  try {
    return db.prepare(`
      SELECT
        t.*,
        highlight(turns_fts, 0, '>>>', '<<<') as user_highlighted,
        highlight(turns_fts, 1, '>>>', '<<<') as assistant_highlighted
      FROM turns_fts
      JOIN turns t ON turns_fts.rowid = t.rowid
      WHERE turns_fts MATCH ? AND t.session_id = ?
      ORDER BY t.turn_number
    `).all(ftsQuery, sessionId);
  } catch {
    return db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ? AND (user_message LIKE ? OR assistant_response LIKE ?)
      ORDER BY turn_number
    `).all(sessionId, `%${query}%`, `%${query}%`);
  }
}

/**
 * Get search suggestions based on recent queries
 */
export function getSuggestions(prefix, limit = 5) {
  const db = getDb();

  const results = db.prepare(`
    SELECT DISTINCT
      substr(user_message, 1, 100) as snippet
    FROM turns
    WHERE user_message LIKE ?
    ORDER BY ts DESC
    LIMIT ?
  `).all(`${prefix}%`, limit * 3);

  const suggestions = new Set();
  for (const r of results) {
    const words = (r.snippet || '').split(/\s+/);
    for (const word of words) {
      if (word.toLowerCase().startsWith(prefix.toLowerCase()) && word.length > prefix.length) {
        suggestions.add(word);
        if (suggestions.size >= limit) break;
      }
    }
    if (suggestions.size >= limit) break;
  }

  return Array.from(suggestions);
}

/**
 * Get recent searches
 */
export function getRecentSearchContext(limit = 10) {
  const db = getDb();

  return db.prepare(`
    SELECT DISTINCT
      title,
      provider,
      last_active_at
    FROM sessions
    WHERE title IS NOT NULL AND title != ''
    ORDER BY last_active_at DESC
    LIMIT ?
  `).all(limit);
}

// =============================================================================
// PACKAGE SEARCH
// =============================================================================

/**
 * Search installed packages
 */
export function searchPackages(query, options = {}) {
  const { kind, status = 'installed', limit = 50 } = options;
  const db = getDb();

  let sql = `
    SELECT * FROM packages
    WHERE (name LIKE ? OR description LIKE ? OR id LIKE ?)
  `;

  const likeQuery = `%${query}%`;
  const params = [likeQuery, likeQuery, likeQuery];

  if (kind) {
    sql += ' AND kind = ?';
    params.push(kind);
  }

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ` ORDER BY installed_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * Search runs
 */
export function searchRuns(query, options = {}) {
  const { packageId, status, limit = 50 } = options;
  const db = getDb();

  let sql = `
    SELECT r.*, p.name as package_name
    FROM runs r
    LEFT JOIN packages p ON r.package_id = p.id
    WHERE 1=1
  `;

  const params = [];

  if (query) {
    sql += ' AND (r.inputs_json LIKE ? OR r.outputs_json LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }

  if (packageId) {
    sql += ' AND r.package_id = ?';
    params.push(packageId);
  }

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }

  sql += ` ORDER BY r.started_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}
