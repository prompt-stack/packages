/**
 * Runtime descriptor parsing
 * Runtimes are execution environments (node, python, etc.)
 */

import { parse as parseYaml } from 'yaml';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * @typedef {Object} RuntimeDescriptor
 * @property {string} id - Unique identifier (e.g., 'runtime:python')
 * @property {string} kind - Always 'runtime'
 * @property {string} name - Display name
 * @property {string} version - Version constraint (e.g., '>=3.10')
 * @property {string} [description] - Description
 * @property {RuntimeBinary[]} binaries - Platform-specific binaries
 * @property {string[]} [aliases] - Command aliases (e.g., ['python3', 'python'])
 */

/**
 * @typedef {Object} RuntimeBinary
 * @property {string} platform - Platform: 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64'
 * @property {string} url - Download URL
 * @property {string} sha256 - SHA256 checksum
 * @property {number} [size] - File size in bytes
 */

/**
 * Parse a runtime descriptor
 * @param {string} filePath - Path to runtime.yaml
 * @returns {RuntimeDescriptor}
 */
export function parseRuntimeDescriptor(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseRuntimeYaml(content, filePath);
}

/**
 * Parse runtime.yaml content
 */
export function parseRuntimeYaml(content, source = 'runtime.yaml') {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid runtime descriptor in ${source}: expected object`);
  }

  const descriptor = normalizeRuntimeDescriptor(raw);
  validateRuntimeDescriptor(descriptor, source);

  return descriptor;
}

/**
 * Normalize a raw runtime descriptor
 */
function normalizeRuntimeDescriptor(raw) {
  const descriptor = {
    id: raw.id,
    kind: 'runtime',
    name: raw.name,
    version: raw.version,
    description: raw.description,
    aliases: raw.aliases || []
  };

  // Ensure id has runtime: prefix
  if (descriptor.id && !descriptor.id.startsWith('runtime:')) {
    descriptor.id = `runtime:${descriptor.id}`;
  }

  // Normalize binaries
  if (raw.binaries) {
    descriptor.binaries = Object.entries(raw.binaries).map(([platform, info]) => ({
      platform,
      url: info.url,
      sha256: info.sha256,
      size: info.size
    }));
  } else {
    descriptor.binaries = [];
  }

  return descriptor;
}

/**
 * Validate a runtime descriptor
 */
function validateRuntimeDescriptor(descriptor, source) {
  const errors = [];

  if (!descriptor.id) {
    errors.push('Missing required field: id');
  }

  if (!descriptor.name) {
    errors.push('Missing required field: name');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid runtime descriptor in ${source}:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Get current platform identifier
 * @returns {string} Platform string (e.g., 'darwin-arm64')
 */
export function getCurrentPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  // Normalize architecture
  const normalizedArch = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch;

  return `${platform}-${normalizedArch}`;
}

/**
 * Get binary URL for current platform
 * @param {RuntimeDescriptor} descriptor
 * @returns {RuntimeBinary|null}
 */
export function getBinaryForCurrentPlatform(descriptor) {
  const platform = getCurrentPlatform();
  return descriptor.binaries.find(b => b.platform === platform) || null;
}

/**
 * Check if a runtime is available on the system
 * @param {string} command - Command to check (e.g., 'python3')
 * @returns {Promise<boolean>}
 */
export async function isRuntimeAvailable(command) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get runtime version from system
 * @param {string} command - Command to run
 * @param {string} [versionFlag] - Flag to get version (default: '--version')
 * @returns {Promise<string|null>}
 */
export async function getRuntimeVersion(command, versionFlag = '--version') {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync(`${command} ${versionFlag}`);
    // Extract version number from output
    const match = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Find runtime descriptor in a directory
 */
export function findRuntimeDescriptor(dir) {
  const candidates = ['runtime.yaml', 'runtime.yml'];

  for (const filename of candidates) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

/**
 * Built-in runtime definitions (for bundled runtimes)
 */
export const BUILTIN_RUNTIMES = {
  node: {
    id: 'runtime:node',
    kind: 'runtime',
    name: 'Node.js',
    version: '>=18',
    description: 'JavaScript runtime',
    aliases: ['node', 'npm', 'npx']
  },
  python: {
    id: 'runtime:python',
    kind: 'runtime',
    name: 'Python',
    version: '>=3.10',
    description: 'Python interpreter',
    aliases: ['python3', 'python', 'pip3', 'pip']
  },
  git: {
    id: 'runtime:git',
    kind: 'runtime',
    name: 'Git',
    version: '>=2.0',
    description: 'Version control',
    aliases: ['git']
  }
};
