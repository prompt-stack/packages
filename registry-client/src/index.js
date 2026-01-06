/**
 * @prompt-stack/registry-client
 *
 * Registry client for fetching index, downloading packages, caching, and verification.
 * Handles all HTTP and caching concerns.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PATHS, getPlatformArch } from '@prompt-stack/env';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Default registry URL
 */
export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/prompt-stack/registry/main/index.json';

/**
 * Default downloads base URL (from registry repo releases)
 */
export const RUNTIMES_DOWNLOAD_BASE = 'https://github.com/prompt-stack/registry/releases/download';

/**
 * Cache TTL in milliseconds (24 hours)
 */
export const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Local registry paths (for development)
 * Set USE_LOCAL_REGISTRY=true environment variable to enable local development mode
 */
const LOCAL_REGISTRY_PATHS = process.env.USE_LOCAL_REGISTRY === 'true' ? [
  path.join(process.cwd(), 'registry', 'index.json'),
  path.join(process.cwd(), '..', 'registry', 'index.json'),
  '/Users/hoff/dev/prompt-stack/registry/index.json'
] : [];

// =============================================================================
// INDEX FETCHING
// =============================================================================

/**
 * Fetch the registry index
 * @param {Object} options
 * @param {string} [options.url] - Registry URL
 * @param {boolean} [options.force] - Force refresh, ignore cache
 * @returns {Promise<Object>} Registry index
 */
export async function fetchIndex(options = {}) {
  const { url = DEFAULT_REGISTRY_URL, force = false } = options;

  // In development, prefer local registry if it's newer than cache
  const localResult = getLocalIndex();
  if (localResult) {
    const { index: localIndex, mtime: localMtime } = localResult;
    const cacheMtime = getCacheMtime();

    // Use local if: forcing, no cache, or local is newer
    if (force || !cacheMtime || localMtime > cacheMtime) {
      cacheIndex(localIndex);
      return localIndex;
    }
  }

  // Check cache (unless forcing)
  if (!force) {
    const cached = getCachedIndex();
    if (cached) {
      return cached;
    }
  }

  // Local index already handled above, try remote
  if (localResult) {
    return localResult.index;
  }

  // Fetch from remote
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'pstack-cli/2.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const index = await response.json();

    // Cache the result
    cacheIndex(index);

    return index;
  } catch (error) {
    // If remote fails, try local as last resort
    const fallback = getLocalIndex();
    if (fallback) {
      return fallback.index;
    }
    throw new Error(`Failed to fetch registry: ${error.message}`);
  }
}

/**
 * Get cached index if valid
 * @returns {Object|null}
 */
function getCachedIndex() {
  const cachePath = PATHS.registryCache;

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;

    if (age > CACHE_TTL) {
      return null; // Cache expired
    }

    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Cache the registry index
 * @param {Object} index
 */
function cacheIndex(index) {
  const cachePath = PATHS.registryCache;
  const cacheDir = path.dirname(cachePath);

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  fs.writeFileSync(cachePath, JSON.stringify(index, null, 2));
}

/**
 * Get cache modification time
 * @returns {number|null}
 */
function getCacheMtime() {
  const cachePath = PATHS.registryCache;
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    return fs.statSync(cachePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Get local index if available (for development)
 * @returns {{ index: Object, mtime: number }|null}
 */
function getLocalIndex() {
  for (const localPath of LOCAL_REGISTRY_PATHS) {
    if (fs.existsSync(localPath)) {
      try {
        const index = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
        const mtime = fs.statSync(localPath).mtimeMs;
        return { index, mtime };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Clear the registry cache
 */
export function clearCache() {
  if (fs.existsSync(PATHS.registryCache)) {
    fs.unlinkSync(PATHS.registryCache);
  }
}

/**
 * Check if cache is fresh
 * @returns {{ fresh: boolean, age: number|null }}
 */
export function checkCache() {
  const cachePath = PATHS.registryCache;

  if (!fs.existsSync(cachePath)) {
    return { fresh: false, age: null };
  }

  try {
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;
    return { fresh: age <= CACHE_TTL, age };
  } catch {
    return { fresh: false, age: null };
  }
}

// =============================================================================
// PACKAGE SEARCH
// =============================================================================

/**
 * All valid package kinds
 */
export const PACKAGE_KINDS = ['stack', 'prompt', 'runtime', 'tool', 'agent'];

/**
 * Search packages in the registry
 * @param {string} query - Search query
 * @param {Object} options
 * @param {string} [options.kind] - Filter by kind
 * @returns {Promise<Array>}
 */
export async function searchPackages(query, options = {}) {
  const { kind } = options;
  const index = await fetchIndex();

  const results = [];
  const queryLower = query.toLowerCase();

  const kinds = kind ? [kind] : PACKAGE_KINDS;

  for (const k of kinds) {
    const section = index.packages?.[k + 's'];
    if (!section) continue;

    const packages = [...(section.official || []), ...(section.community || [])];

    for (const pkg of packages) {
      if (matchesQuery(pkg, queryLower)) {
        results.push({ ...pkg, kind: k });
      }
    }
  }

  return results;
}

/**
 * Check if a package matches a search query
 */
function matchesQuery(pkg, query) {
  const searchable = [
    pkg.id || '',
    pkg.name || '',
    pkg.description || '',
    ...(pkg.tags || [])
  ].join(' ').toLowerCase();

  return searchable.includes(query);
}

/**
 * Get a specific package from the registry
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator', 'tool:ffmpeg', 'agent:claude')
 * @returns {Promise<Object|null>}
 */
export async function getPackage(id) {
  const index = await fetchIndex();
  const [kind, name] = id.includes(':') ? id.split(':') : [null, id];

  const kinds = kind ? [kind] : PACKAGE_KINDS;

  for (const k of kinds) {
    const section = index.packages?.[k + 's'];
    if (!section) continue;

    const packages = [...(section.official || []), ...(section.community || [])];

    for (const pkg of packages) {
      const kindPrefixPattern = new RegExp(`^(${PACKAGE_KINDS.join('|')}):`);
      const pkgShortId = pkg.id?.replace(kindPrefixPattern, '') || '';
      if (pkgShortId === name || pkg.id === id) {
        return { ...pkg, kind: k };
      }
    }
  }

  return null;
}

/**
 * List all packages of a specific kind
 * @param {'stack' | 'prompt' | 'runtime' | 'tool' | 'agent'} kind
 * @returns {Promise<Array>}
 */
export async function listPackages(kind) {
  const index = await fetchIndex();
  const section = index.packages?.[kind + 's'];
  if (!section) return [];
  return [...(section.official || []), ...(section.community || [])];
}

/**
 * List all available package kinds
 * @returns {string[]}
 */
export function getPackageKinds() {
  return PACKAGE_KINDS;
}

// =============================================================================
// PACKAGE DOWNLOAD
// =============================================================================

/**
 * Download a package from the registry
 * @param {Object} pkg - Package metadata from registry
 * @param {string} destPath - Destination path
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, path: string }>}
 */
export async function downloadPackage(pkg, destPath, options = {}) {
  const { onProgress } = options;

  // For now, we handle catalog packages (local in registry)
  // In production, this would download tarballs

  const registryPath = pkg.path; // e.g., 'catalog/stacks/official/pdf-creator' or 'catalog/prompts/code-review.md'

  // Try to find local registry
  for (const basePath of LOCAL_REGISTRY_PATHS) {
    const registryDir = path.dirname(basePath);
    const pkgSourcePath = path.join(registryDir, registryPath);

    if (fs.existsSync(pkgSourcePath)) {
      const stat = fs.statSync(pkgSourcePath);

      if (stat.isFile()) {
        // Handle single file packages (prompts are .md files)
        // destPath for prompts is the full file path including filename
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(pkgSourcePath, destPath);
      } else {
        // Handle directory packages (stacks, tools, etc.)
        await copyDirectory(pkgSourcePath, destPath);
      }
      return { success: true, path: destPath };
    }
  }

  // If not found locally, would fetch from GitHub
  throw new Error(`Package source not found: ${registryPath}`);
}

/**
 * Runtime release version - all runtimes are in a single release
 */
export const RUNTIMES_RELEASE_VERSION = 'v1.0.0';

/**
 * Download a runtime binary from GitHub releases
 * @param {string} runtime - Runtime name (e.g., 'python', 'node')
 * @param {string} version - Version (e.g., '3.12', '20.10.0')
 * @param {string} destPath - Destination path
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, path: string }>}
 */
export async function downloadRuntime(runtime, version, destPath, options = {}) {
  const { onProgress } = options;
  const platformArch = getPlatformArch();

  // Version format: use short version (3.12 not 3.12.0, but keep full for node)
  const shortVersion = version.replace(/\.x$/, '').replace(/\.0$/, '');
  const filename = `${runtime}-${shortVersion}-${platformArch}.tar.gz`;
  const url = `${RUNTIMES_DOWNLOAD_BASE}/${RUNTIMES_RELEASE_VERSION}/${filename}`;

  onProgress?.({ phase: 'downloading', runtime, version, url });

  // Create temp directory for download
  const tempDir = path.join(PATHS.cache, 'downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempFile = path.join(tempDir, filename);

  try {
    // Download the tarball
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'pstack-cli/2.0',
        'Accept': 'application/octet-stream'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${runtime}: HTTP ${response.status}`);
    }

    // Write to temp file
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(buffer));

    onProgress?.({ phase: 'extracting', runtime, version });

    // Create destination directory
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    fs.mkdirSync(destPath, { recursive: true });

    // Extract tarball using tar command
    const { execSync } = await import('child_process');
    execSync(`tar -xzf "${tempFile}" -C "${destPath}" --strip-components=1`, {
      stdio: 'pipe'
    });

    // Clean up temp file
    fs.unlinkSync(tempFile);

    // Write runtime metadata
    fs.writeFileSync(
      path.join(destPath, 'runtime.json'),
      JSON.stringify({
        runtime,
        version,
        platformArch,
        downloadedAt: new Date().toISOString(),
        source: url
      }, null, 2)
    );

    onProgress?.({ phase: 'complete', runtime, version, path: destPath });

    return { success: true, path: destPath };

  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw new Error(`Failed to install ${runtime} ${version}: ${error.message}`);
  }
}

// =============================================================================
// TOOL DOWNLOAD (using upstream URLs from manifests)
// =============================================================================

/**
 * Download a tool binary using upstream URLs from the tool manifest
 * @param {string} toolName - Tool name (e.g., 'ffmpeg', 'pandoc')
 * @param {string} destPath - Destination path
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, path: string }>}
 */
export async function downloadTool(toolName, destPath, options = {}) {
  const { onProgress } = options;
  const platformArch = getPlatformArch();

  // Load the tool manifest from the registry
  const toolManifest = await loadToolManifest(toolName);
  if (!toolManifest) {
    throw new Error(`Tool manifest not found for: ${toolName}`);
  }

  // Create temp directory for download
  const tempDir = path.join(PATHS.cache, 'downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Create destination directory
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true });
  }
  fs.mkdirSync(destPath, { recursive: true });

  const { execSync } = await import('child_process');

  // Check for new multi-download format first
  const downloads = toolManifest.downloads?.[platformArch];

  if (downloads && Array.isArray(downloads)) {
    // New format: multiple downloads per platform
    const downloadedUrls = new Set(); // Track to avoid re-downloading same archive

    for (const download of downloads) {
      const { url, type, binary } = download;

      // Skip if we already downloaded this URL (e.g., Linux tar.xz has both ffmpeg and ffprobe)
      if (downloadedUrls.has(url)) {
        // Just extract the binary from already-extracted content
        await extractBinaryFromPath(destPath, binary, destPath);
        continue;
      }

      onProgress?.({ phase: 'downloading', tool: toolName, binary: path.basename(binary), url });

      const urlFilename = path.basename(new URL(url).pathname);
      const tempFile = path.join(tempDir, urlFilename);

      try {
        // Download the archive
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'pstack-cli/2.0',
            'Accept': 'application/octet-stream'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to download ${binary}: HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(tempFile, Buffer.from(buffer));
        downloadedUrls.add(url);

        onProgress?.({ phase: 'extracting', tool: toolName, binary: path.basename(binary) });

        // Extract based on archive type
        const archiveType = type || guessArchiveType(urlFilename);

        if (archiveType === 'zip') {
          execSync(`unzip -o "${tempFile}" -d "${destPath}"`, { stdio: 'pipe' });
        } else if (archiveType === 'tar.xz') {
          execSync(`tar -xJf "${tempFile}" -C "${destPath}"`, { stdio: 'pipe' });
        } else if (archiveType === 'tar.gz' || archiveType === 'tgz') {
          execSync(`tar -xzf "${tempFile}" -C "${destPath}"`, { stdio: 'pipe' });
        } else {
          throw new Error(`Unsupported archive type: ${archiveType}`);
        }

        // Extract/move the specific binary to dest root
        await extractBinaryFromPath(destPath, binary, destPath);

        // Clean up temp file
        fs.unlinkSync(tempFile);

      } catch (error) {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        throw error;
      }
    }

    // Make all binaries executable
    const binaries = toolManifest.binaries || [toolName];
    for (const bin of binaries) {
      const binPath = path.join(destPath, bin);
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
      }
    }

  } else {
    // Legacy format: single upstream URL per platform
    const upstreamUrl = toolManifest.upstream?.[platformArch];
    if (!upstreamUrl) {
      throw new Error(`No upstream URL for ${toolName} on ${platformArch}`);
    }

    const extractConfig = toolManifest.extract?.[platformArch];
    if (!extractConfig) {
      throw new Error(`No extract config for ${toolName} on ${platformArch}`);
    }

    onProgress?.({ phase: 'downloading', tool: toolName, url: upstreamUrl });

    const urlFilename = path.basename(new URL(upstreamUrl).pathname);
    const tempFile = path.join(tempDir, urlFilename);

    try {
      const response = await fetch(upstreamUrl, {
        headers: {
          'User-Agent': 'pstack-cli/2.0',
          'Accept': 'application/octet-stream'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download ${toolName}: HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(tempFile, Buffer.from(buffer));

      onProgress?.({ phase: 'extracting', tool: toolName });

      const archiveType = extractConfig.type || guessArchiveType(urlFilename);

      if (archiveType === 'zip') {
        execSync(`unzip -o "${tempFile}" -d "${destPath}"`, { stdio: 'pipe' });
      } else if (archiveType === 'tar.xz') {
        execSync(`tar -xJf "${tempFile}" -C "${destPath}"`, { stdio: 'pipe' });
      } else if (archiveType === 'tar.gz' || archiveType === 'tgz') {
        execSync(`tar -xzf "${tempFile}" -C "${destPath}"`, { stdio: 'pipe' });
      } else {
        throw new Error(`Unsupported archive type: ${archiveType}`);
      }

      // Extract the binary
      await extractBinaryFromPath(destPath, extractConfig.binary || toolName, destPath);

      // Make binaries executable
      const binaries = [toolName, ...(toolManifest.additionalBinaries || [])];
      for (const bin of binaries) {
        const binPath = path.join(destPath, bin);
        if (fs.existsSync(binPath)) {
          fs.chmodSync(binPath, 0o755);
        }
      }

      fs.unlinkSync(tempFile);

    } catch (error) {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw new Error(`Failed to install ${toolName}: ${error.message}`);
    }
  }

  // Write tool metadata
  fs.writeFileSync(
    path.join(destPath, 'manifest.json'),
    JSON.stringify({
      id: `tool:${toolName}`,
      kind: 'tool',
      name: toolManifest.name || toolName,
      version: toolManifest.version,
      binaries: toolManifest.binaries || [toolName],
      platformArch,
      installedAt: new Date().toISOString()
    }, null, 2)
  );

  onProgress?.({ phase: 'complete', tool: toolName, path: destPath });

  return { success: true, path: destPath };
}

/**
 * Extract a binary from an extracted archive to the destination root
 * Handles glob patterns like "ffmpeg-*-amd64-static/ffmpeg"
 */
async function extractBinaryFromPath(extractedPath, binaryPattern, destPath) {
  // If binary is already at root, nothing to do
  const directPath = path.join(destPath, path.basename(binaryPattern));
  if (!binaryPattern.includes('/') && !binaryPattern.includes('*')) {
    if (fs.existsSync(directPath)) {
      return; // Already in place
    }
  }

  // Handle glob patterns
  if (binaryPattern.includes('*') || binaryPattern.includes('/')) {
    const parts = binaryPattern.split('/');
    let currentPath = extractedPath;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('*')) {
        // Find matching directory/file
        if (!fs.existsSync(currentPath)) break;
        const entries = fs.readdirSync(currentPath);
        const pattern = new RegExp('^' + part.replace(/\*/g, '.*') + '$');
        const match = entries.find(e => pattern.test(e));
        if (match) {
          currentPath = path.join(currentPath, match);
        } else {
          break;
        }
      } else {
        currentPath = path.join(currentPath, part);
      }
    }

    // Move the binary to the dest root if found
    if (fs.existsSync(currentPath) && currentPath !== destPath) {
      const finalPath = path.join(destPath, path.basename(currentPath));
      if (currentPath !== finalPath && !fs.existsSync(finalPath)) {
        fs.renameSync(currentPath, finalPath);
      }
    }
  }
}

/**
 * Load a tool manifest from the registry
 * @param {string} toolName - Tool name
 * @returns {Promise<Object|null>}
 */
async function loadToolManifest(toolName) {
  // Try local registry first
  for (const basePath of LOCAL_REGISTRY_PATHS) {
    const registryDir = path.dirname(basePath);
    const manifestPath = path.join(registryDir, 'catalog', 'tools', `${toolName}.json`);

    if (fs.existsSync(manifestPath)) {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue;
      }
    }
  }

  // Try fetching from GitHub raw
  try {
    const url = `https://raw.githubusercontent.com/prompt-stack/registry/main/catalog/tools/${toolName}.json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'pstack-cli/2.0',
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Ignore fetch errors
  }

  return null;
}

/**
 * Guess archive type from filename
 */
function guessArchiveType(filename) {
  if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) return 'tar.gz';
  if (filename.endsWith('.tar.xz')) return 'tar.xz';
  if (filename.endsWith('.zip')) return 'zip';
  return 'tar.gz'; // default
}

// =============================================================================
// VERIFICATION
// =============================================================================

/**
 * Verify a file's SHA256 hash
 * @param {string} filePath - Path to file
 * @param {string} expectedHash - Expected SHA256 hash
 * @returns {Promise<boolean>}
 */
export async function verifyHash(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', data => hash.update(data));
    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      resolve(actualHash === expectedHash);
    });
    stream.on('error', reject);
  });
}

/**
 * Compute SHA256 hash of a file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>}
 */
export async function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Copy a directory recursively
 */
async function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        await copyDirectory(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
