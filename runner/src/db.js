/**
 * Database re-exports for Prompt Stack runner
 * CLI/Studio should import db functions from runner, not directly from @prompt-stack/db
 */

export {
  // Connection
  getDb,
  closeDb,
  getDbPath,
  getDbSize,
  isDatabaseInitialized,

  // Schema
  initSchema,
  getSchemaVersion,

  // Search
  search,

  // Stats
  getStats
} from '@prompt-stack/db';
