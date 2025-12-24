/**
 * @prompt-stack/env
 *
 * Environment configuration, paths, and platform detection.
 * This package has NO dependencies - it's the foundation.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

// =============================================================================
// PATHS
// =============================================================================

/**
 * Root directory for all Prompt Stack data
 */
export const PROMPT_STACK_HOME = path.join(os.homedir(), '.prompt-stack');

/**
 * All standard paths
 */
export const PATHS = {
  // Root
  home: PROMPT_STACK_HOME,

  // Installed packages - shared with Studio for unified discovery
  packages: path.join(PROMPT_STACK_HOME, 'packages'),
  stacks: path.join(PROMPT_STACK_HOME, 'stacks'),     // Shared with Studio
  prompts: path.join(PROMPT_STACK_HOME, 'prompts'),   // Shared with Studio

  // Runtimes (interpreters: node, python, deno, bun)
  runtimes: path.join(PROMPT_STACK_HOME, 'runtimes'),

  // Tools (utility binaries: ffmpeg, imagemagick, ripgrep, etc.)
  tools: path.join(PROMPT_STACK_HOME, 'tools'),

  // Agents (AI CLI tools: claude, codex, gemini, copilot, ollama)
  agents: path.join(PROMPT_STACK_HOME, 'agents'),

  // Runtime binaries (content-addressed)
  store: path.join(PROMPT_STACK_HOME, 'store'),

  // Shims (symlinks to store/)
  bins: path.join(PROMPT_STACK_HOME, 'bins'),

  // Lockfiles
  locks: path.join(PROMPT_STACK_HOME, 'locks'),

  // Secrets (OS Keychain preferred, encrypted file fallback)
  vault: path.join(PROMPT_STACK_HOME, 'vault'),

  // Database
  db: path.join(PROMPT_STACK_HOME, 'db'),
  dbFile: path.join(PROMPT_STACK_HOME, 'db', 'pstack.db'),

  // Cache
  cache: path.join(PROMPT_STACK_HOME, 'cache'),
  registryCache: path.join(PROMPT_STACK_HOME, 'cache', 'registry.json'),

  // Config
  config: path.join(PROMPT_STACK_HOME, 'config.json'),

  // Logs
  logs: path.join(PROMPT_STACK_HOME, 'logs')
};

// =============================================================================
// INSTALL ROOT
// =============================================================================

/**
 * Get the install root directory
 * @returns {string}
 */
export function getInstallRoot() {
  return PROMPT_STACK_HOME;
}

/**
 * Get the bins directory (where shims live)
 * @returns {string}
 */
export function getBinsDir() {
  return PATHS.bins;
}

/**
 * Get the store directory (where binaries live)
 * @returns {string}
 */
export function getStoreDir() {
  return PATHS.store;
}

// =============================================================================
// PLATFORM DETECTION
// =============================================================================

/**
 * Get current platform-architecture string
 * @returns {string} e.g., 'darwin-arm64', 'linux-x64'
 */
export function getPlatformArch() {
  const platform = os.platform();
  const arch = os.arch();

  // Normalize architecture names
  const normalizedArch = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch;

  return `${platform}-${normalizedArch}`;
}

/**
 * Get platform name
 * @returns {'darwin' | 'linux' | 'win32' | string}
 */
export function getPlatform() {
  return os.platform();
}

/**
 * Get architecture
 * @returns {'arm64' | 'x64' | string}
 */
export function getArch() {
  return os.arch();
}

/**
 * Check if running on macOS
 * @returns {boolean}
 */
export function isMacOS() {
  return os.platform() === 'darwin';
}

/**
 * Check if running on Linux
 * @returns {boolean}
 */
export function isLinux() {
  return os.platform() === 'linux';
}

/**
 * Check if running on Windows
 * @returns {boolean}
 */
export function isWindows() {
  return os.platform() === 'win32';
}

// =============================================================================
// DIRECTORY MANAGEMENT
// =============================================================================

/**
 * Ensure all required directories exist
 */
export function ensureDirectories() {
  const dirs = [
    PATHS.packages,
    PATHS.stacks,
    PATHS.prompts,
    PATHS.runtimes,
    PATHS.tools,
    PATHS.agents,
    PATHS.store,
    PATHS.bins,
    PATHS.locks,
    PATHS.vault,
    PATHS.db,
    PATHS.cache,
    PATHS.logs
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Check if directories are initialized
 * @returns {boolean}
 */
export function areDirectoriesInitialized() {
  return fs.existsSync(PATHS.packages) && fs.existsSync(PATHS.db);
}

// =============================================================================
// PACKAGE PATHS
// =============================================================================

/**
 * All valid package kinds
 */
export const PACKAGE_KINDS = ['stack', 'prompt', 'runtime', 'tool', 'agent'];

/**
 * Parse a package ID into kind and name
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator', 'tool:ffmpeg', 'agent:claude')
 * @returns {[string, string]} [kind, name]
 */
export function parsePackageId(id) {
  const match = id.match(/^(stack|prompt|runtime|tool|agent):(.+)$/);
  if (!match) {
    throw new Error(`Invalid package ID: ${id} (expected format: kind:name, where kind is one of: ${PACKAGE_KINDS.join(', ')})`);
  }
  return [match[1], match[2]];
}

/**
 * Create a package ID from kind and name
 * @param {string} kind - Package kind
 * @param {string} name - Package name
 * @returns {string} Full package ID
 */
export function createPackageId(kind, name) {
  return `${kind}:${name}`;
}

/**
 * Get path for an installed package
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator', 'tool:ffmpeg', 'agent:claude')
 * @returns {string} Install path
 */
export function getPackagePath(id) {
  const [kind, name] = parsePackageId(id);

  switch (kind) {
    case 'stack':
      return path.join(PATHS.stacks, name);
    case 'prompt':
      return path.join(PATHS.prompts, name);
    case 'runtime':
      return path.join(PATHS.runtimes, name);
    case 'tool':
      return path.join(PATHS.tools, name);
    case 'agent':
      return path.join(PATHS.agents, name);
    default:
      throw new Error(`Unknown package kind: ${kind}`);
  }
}

/**
 * Get path for a lockfile
 * @param {string} id - Package ID
 * @returns {string} Lockfile path
 */
export function getLockfilePath(id) {
  const [kind, name] = parsePackageId(id);
  return path.join(PATHS.locks, kind + 's', `${name}.lock.yaml`);
}

/**
 * Get path for a runtime binary in store
 * @param {string} runtime - Runtime name (e.g., 'python')
 * @param {string} version - Version string
 * @returns {string} Binary path in store
 */
export function getRuntimeStorePath(runtime, version) {
  const platformArch = getPlatformArch();
  return path.join(PATHS.store, `${runtime}-${version}-${platformArch}`);
}

/**
 * Get path for a runtime shim
 * @param {string} command - Command name (e.g., 'python3')
 * @returns {string} Shim path
 */
export function getShimPath(command) {
  return path.join(PATHS.bins, command);
}

/**
 * Check if a package is installed
 * @param {string} id - Package ID
 * @returns {boolean}
 */
export function isPackageInstalled(id) {
  const packagePath = getPackagePath(id);
  return fs.existsSync(packagePath);
}

/**
 * Get list of installed packages by kind
 * @param {'stack' | 'prompt' | 'runtime' | 'tool' | 'agent'} kind
 * @returns {string[]} Package names
 */
export function getInstalledPackages(kind) {
  const dir = {
    stack: PATHS.stacks,
    prompt: PATHS.prompts,
    runtime: PATHS.runtimes,
    tool: PATHS.tools,
    agent: PATHS.agents
  }[kind];

  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir).filter(name => {
    const stat = fs.statSync(path.join(dir, name));
    return stat.isDirectory() && !name.startsWith('.');
  });
}
