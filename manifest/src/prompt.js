/**
 * Prompt manifest parsing and validation
 */

import { parse as parseYaml } from 'yaml';
import fs from 'fs';
import path from 'path';

/**
 * @typedef {Object} PromptManifest
 * @property {string} id - Unique identifier (e.g., 'prompt:brainstorm')
 * @property {string} kind - Always 'prompt'
 * @property {string} name - Display name
 * @property {string} version - Semver version
 * @property {string} [description] - Short description
 * @property {string} [author] - Author name
 * @property {string} [category] - Category (coding, writing, analysis, creative)
 * @property {string[]} [tags] - Tags for search
 * @property {PromptVariable[]} [variables] - Template variables
 * @property {string} template - The prompt template (Markdown with {{variables}})
 */

/**
 * @typedef {Object} PromptVariable
 * @property {string} name - Variable name
 * @property {string} type - Type: 'string' | 'text' | 'select' | 'file'
 * @property {string} [description] - Description
 * @property {*} [default] - Default value
 * @property {boolean} [required] - Whether required
 * @property {string[]} [options] - Options for select type
 */

/**
 * Parse a prompt manifest directory
 * Expects: prompt.yaml + prompt.md
 * @param {string} dir - Directory containing prompt files
 * @returns {PromptManifest}
 */
export function parsePromptManifest(dir) {
  const yamlPath = path.join(dir, 'prompt.yaml');
  const mdPath = path.join(dir, 'prompt.md');

  if (!fs.existsSync(yamlPath)) {
    throw new Error(`Missing prompt.yaml in ${dir}`);
  }

  const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
  const manifest = parsePromptYaml(yamlContent, yamlPath);

  // Load template from prompt.md if it exists
  if (fs.existsSync(mdPath)) {
    manifest.template = fs.readFileSync(mdPath, 'utf-8');
  } else if (!manifest.template) {
    throw new Error(`Missing prompt.md in ${dir}`);
  }

  return manifest;
}

/**
 * Parse prompt.yaml content
 * @param {string} content - YAML content
 * @param {string} [source] - Source path for error messages
 * @returns {PromptManifest}
 */
export function parsePromptYaml(content, source = 'prompt.yaml') {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid prompt manifest in ${source}: expected object`);
  }

  const manifest = normalizePromptManifest(raw);
  validatePromptManifest(manifest, source);

  return manifest;
}

/**
 * Normalize a raw prompt manifest
 */
function normalizePromptManifest(raw) {
  const manifest = {
    id: raw.id,
    kind: 'prompt',
    name: raw.name,
    version: raw.version || '1.0.0',
    description: raw.description,
    author: raw.author,
    category: raw.category,
    tags: raw.tags || [],
    template: raw.template
  };

  // Ensure id has prompt: prefix
  if (manifest.id && !manifest.id.startsWith('prompt:')) {
    manifest.id = `prompt:${manifest.id}`;
  }

  // Normalize variables
  if (raw.variables) {
    manifest.variables = normalizeVariables(raw.variables);
  }

  return manifest;
}

/**
 * Normalize variables section
 */
function normalizeVariables(raw) {
  if (!Array.isArray(raw)) {
    return Object.entries(raw).map(([name, def]) => ({
      name,
      ...(typeof def === 'string' ? { type: def } : def)
    }));
  }

  return raw.map(v => ({
    name: v.name,
    type: v.type || 'string',
    description: v.description,
    default: v.default,
    required: v.required !== false,
    options: v.options
  }));
}

/**
 * Validate a prompt manifest
 */
function validatePromptManifest(manifest, source) {
  const errors = [];

  if (!manifest.id) {
    errors.push('Missing required field: id');
  }

  if (!manifest.name) {
    errors.push('Missing required field: name');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid prompt manifest in ${source}:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Render a prompt template with variables
 * @param {string} template - Template with {{variables}}
 * @param {Object} values - Variable values
 * @returns {string} Rendered template
 */
export function renderPromptTemplate(template, values = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (name in values) {
      return String(values[name]);
    }
    return match; // Keep unresolved variables
  });
}

/**
 * Extract variable names from a template
 * @param {string} template - Template with {{variables}}
 * @returns {string[]} Variable names
 */
export function extractTemplateVariables(template) {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const names = new Set();
  for (const match of matches) {
    names.add(match[1]);
  }
  return Array.from(names);
}

/**
 * Find prompt manifest in a directory
 * @param {string} dir - Directory to search
 * @returns {string|null} Path to prompt.yaml or null
 */
export function findPromptManifest(dir) {
  const candidates = ['prompt.yaml', 'prompt.yml'];

  for (const filename of candidates) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}
