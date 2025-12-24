/**
 * Stack manifest parsing and validation
 */

import { parse as parseYaml } from 'yaml';
import fs from 'fs';
import path from 'path';

/**
 * @typedef {Object} StackManifest
 * @property {string} id - Unique identifier (e.g., 'stack:pdf-creator')
 * @property {string} kind - Always 'stack'
 * @property {string} name - Display name
 * @property {string} version - Semver version
 * @property {string} [description] - Short description
 * @property {string} [author] - Author name or email
 * @property {string} [license] - License identifier
 * @property {StackRequires} [requires] - Dependencies
 * @property {StackInput[]} [inputs] - Input parameters
 * @property {StackOutput[]} [outputs] - Output definitions
 * @property {string} [entry] - Entry point script
 */

/**
 * @typedef {Object} StackRequires
 * @property {string[]} [runtimes] - Required runtime IDs
 * @property {string[]} [npm] - NPM packages to install
 * @property {string[]} [pip] - Python packages to install
 * @property {StackSecretDef[]} [secrets] - Required secrets
 */

/**
 * @typedef {Object} StackSecretDef
 * @property {string} name - Secret name (e.g., 'VERCEL_TOKEN')
 * @property {boolean} [required] - Whether secret is required (default: true)
 * @property {string} [description] - Human-readable description
 * @property {string} [link] - URL for setup help
 * @property {string} [hint] - Hint for identifying the key
 */

/**
 * @typedef {Object} StackInput
 * @property {string} name - Input parameter name
 * @property {string} type - Type: 'string' | 'number' | 'boolean' | 'path' | 'file' | 'select'
 * @property {string} [description] - Description
 * @property {*} [default] - Default value
 * @property {boolean} [required] - Whether required (default: false)
 * @property {string[]} [options] - Options for select type
 */

/**
 * @typedef {Object} StackOutput
 * @property {string} name - Output name
 * @property {string} type - Type: 'string' | 'file' | 'url' | 'json'
 * @property {string} [description] - Description
 */

/**
 * Parse a stack.yaml file
 * @param {string} filePath - Path to stack.yaml
 * @returns {StackManifest}
 */
export function parseStackManifest(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseStackYaml(content, filePath);
}

/**
 * Parse stack.yaml content
 * @param {string} content - YAML content
 * @param {string} [source] - Source path for error messages
 * @returns {StackManifest}
 */
export function parseStackYaml(content, source = 'stack.yaml') {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid stack manifest in ${source}: expected object`);
  }

  // Normalize the manifest
  const manifest = normalizeStackManifest(raw);

  // Validate required fields
  validateStackManifest(manifest, source);

  return manifest;
}

/**
 * Normalize a raw stack manifest
 * @param {Object} raw - Raw parsed YAML
 * @returns {StackManifest}
 */
function normalizeStackManifest(raw) {
  const manifest = {
    id: raw.id,
    kind: 'stack',
    name: raw.name,
    version: raw.version || '1.0.0',
    description: raw.description,
    author: raw.author,
    license: raw.license,
    entry: raw.entry || raw.main || 'index.js'
  };

  // Ensure id has stack: prefix
  if (manifest.id && !manifest.id.startsWith('stack:')) {
    manifest.id = `stack:${manifest.id}`;
  }

  // Normalize requires
  if (raw.requires) {
    manifest.requires = normalizeRequires(raw.requires);
  }

  // Normalize inputs
  if (raw.inputs) {
    manifest.inputs = normalizeInputs(raw.inputs);
  }

  // Normalize outputs
  if (raw.outputs) {
    manifest.outputs = normalizeOutputs(raw.outputs);
  }

  return manifest;
}

/**
 * Normalize requires section
 */
function normalizeRequires(raw) {
  const requires = {};

  // Runtimes
  if (raw.runtimes) {
    requires.runtimes = Array.isArray(raw.runtimes) ? raw.runtimes : [raw.runtimes];
    // Ensure runtime: prefix
    requires.runtimes = requires.runtimes.map(r =>
      r.startsWith('runtime:') ? r : `runtime:${r}`
    );
  }

  // NPM packages
  if (raw.npm) {
    requires.npm = Array.isArray(raw.npm) ? raw.npm : [raw.npm];
  }

  // Pip packages
  if (raw.pip) {
    requires.pip = Array.isArray(raw.pip) ? raw.pip : [raw.pip];
  }

  // Secrets
  if (raw.secrets) {
    requires.secrets = raw.secrets.map(s => {
      if (typeof s === 'string') {
        return { name: s, required: true };
      }
      return {
        name: s.name,
        required: s.required !== false,
        description: s.description,
        link: s.link,
        hint: s.hint
      };
    });
  }

  return requires;
}

/**
 * Normalize inputs section
 */
function normalizeInputs(raw) {
  if (!Array.isArray(raw)) {
    // Convert object to array
    return Object.entries(raw).map(([name, def]) => ({
      name,
      ...(typeof def === 'string' ? { type: def } : def)
    }));
  }

  return raw.map(input => ({
    name: input.name,
    type: input.type || 'string',
    description: input.description,
    default: input.default,
    required: input.required || false,
    options: input.options
  }));
}

/**
 * Normalize outputs section
 */
function normalizeOutputs(raw) {
  if (!Array.isArray(raw)) {
    return Object.entries(raw).map(([name, def]) => ({
      name,
      ...(typeof def === 'string' ? { type: def } : def)
    }));
  }

  return raw.map(output => ({
    name: output.name,
    type: output.type || 'string',
    description: output.description
  }));
}

/**
 * Validate a stack manifest
 */
function validateStackManifest(manifest, source) {
  const errors = [];

  if (!manifest.id) {
    errors.push('Missing required field: id');
  }

  if (!manifest.name) {
    errors.push('Missing required field: name');
  }

  if (!manifest.version) {
    errors.push('Missing required field: version');
  }

  // Validate version format
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`Invalid version format: ${manifest.version} (expected semver)`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid stack manifest in ${source}:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Find stack.yaml in a directory
 * @param {string} dir - Directory to search
 * @returns {string|null} Path to stack.yaml or null
 */
export function findStackManifest(dir) {
  const candidates = ['stack.yaml', 'stack.yml', 'manifest.yaml', 'manifest.yml'];

  for (const filename of candidates) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

/**
 * Get the short ID from a full ID
 * @param {string} id - Full ID (e.g., 'stack:pdf-creator', 'tool:ffmpeg', 'agent:claude')
 * @returns {string} Short ID (e.g., 'pdf-creator')
 */
export function getShortId(id) {
  const match = id.match(/^(?:stack|prompt|runtime|tool|agent):(.+)$/);
  return match ? match[1] : id;
}

/**
 * Get the kind from a full ID
 * @param {string} id - Full ID
 * @returns {'stack'|'prompt'|'runtime'|'tool'|'agent'|null}
 */
export function getKindFromId(id) {
  const match = id.match(/^(stack|prompt|runtime|tool|agent):/);
  return match ? match[1] : null;
}
