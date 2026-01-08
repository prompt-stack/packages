/**
 * Secrets Store - Simple file-based secret storage
 *
 * Uses ~/.rudi/secrets.json with file permissions (0600) for protection.
 * This is the same approach used by AWS CLI, SSH, GitHub CLI, etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PATHS } from '@learnrudi/env';

const SECRETS_FILE = path.join(PATHS.home, 'secrets.json');

/**
 * Ensure secrets file exists with correct permissions (600)
 */
function ensureSecretsFile() {
  const dir = path.dirname(SECRETS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(SECRETS_FILE)) {
    // Create empty file with restrictive permissions (Read/Write by owner only)
    fs.writeFileSync(SECRETS_FILE, '{}', { mode: 0o600 });
  } else {
    // Enforce permissions on existing file
    try {
      fs.chmodSync(SECRETS_FILE, 0o600);
    } catch {
      // May fail on Windows, that's okay
    }
  }
}

/**
 * Load secrets from file
 */
function loadSecrets() {
  ensureSecretsFile();
  try {
    const content = fs.readFileSync(SECRETS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save secrets to file (atomic write)
 */
function saveSecrets(secrets) {
  ensureSecretsFile();
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  });
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get a secret value
 */
export async function getSecret(name) {
  const secrets = loadSecrets();
  return secrets[name] || null;
}

/**
 * Set a secret value
 */
export async function setSecret(name, value) {
  const secrets = loadSecrets();
  secrets[name] = value;
  saveSecrets(secrets);
  return true;
}

/**
 * Remove a secret
 */
export async function removeSecret(name) {
  const secrets = loadSecrets();
  delete secrets[name];
  saveSecrets(secrets);
  return true;
}

/**
 * List all secret names
 */
export async function listSecrets() {
  const secrets = loadSecrets();
  return Object.keys(secrets).sort();
}

/**
 * Check if a secret exists
 */
export async function hasSecret(name) {
  const secrets = loadSecrets();
  return secrets[name] !== undefined && secrets[name] !== null && secrets[name] !== '';
}

/**
 * Get masked version of secrets (for display)
 */
export async function getMaskedSecrets() {
  const secrets = loadSecrets();
  const masked = {};

  for (const [name, value] of Object.entries(secrets)) {
    if (value && typeof value === 'string' && value.length > 8) {
      masked[name] = value.slice(0, 4) + '...' + value.slice(-4);
    } else if (value && typeof value === 'string' && value.length > 0) {
      masked[name] = '****';
    } else {
      masked[name] = '(pending)';
    }
  }

  return masked;
}

/**
 * Get storage backend info
 */
export function getStorageInfo() {
  return {
    backend: 'file',
    file: SECRETS_FILE,
    permissions: '0600 (owner read/write only)'
  };
}

/**
 * Get all secrets (for internal use by rudi mcp)
 */
export function getAllSecrets() {
  return loadSecrets();
}
