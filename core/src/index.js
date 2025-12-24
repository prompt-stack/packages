/**
 * @prompt-stack/core
 *
 * Core logic for Prompt Stack - resolve dependencies, install packages, manage lockfiles.
 * Does NOT handle execution or secrets (that's runner's job).
 */

// Re-export from env for convenience
export {
  PATHS,
  PROMPT_STACK_HOME,
  getPackagePath,
  getLockfilePath,
  isPackageInstalled,
  getInstalledPackages,
  ensureDirectories,
  parsePackageId,
  createPackageId
} from '@prompt-stack/env';

// Re-export from registry-client for convenience
export {
  fetchIndex,
  searchPackages,
  getPackage,
  listPackages,
  clearCache
} from '@prompt-stack/registry-client';

// Core exports
export * from './resolver.js';
export * from './installer.js';
export * from './lockfile.js';
