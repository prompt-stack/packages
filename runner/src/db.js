/**
 * Database re-exports for RUDI runner
 * CLI/Studio should import db functions from runner, not directly from @learnrudi/db
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
} from '@learnrudi/db';
