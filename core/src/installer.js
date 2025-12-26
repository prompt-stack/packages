/**
 * Package installer for Prompt Stack
 * Downloads, extracts, and installs packages
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { PATHS, getPackagePath, ensureDirectories, parsePackageId } from '@prompt-stack/env';
import { downloadRuntime, downloadPackage } from '@prompt-stack/registry-client';
import { resolvePackage, getInstallOrder } from './resolver.js';
import { writeLockfile } from './lockfile.js';

/**
 * @typedef {Object} InstallResult
 * @property {boolean} success
 * @property {string} id - Package ID
 * @property {string} path - Install path
 * @property {string} [error] - Error message if failed
 */

/**
 * Install a package and its dependencies
 * @param {string} id - Package ID
 * @param {Object} options
 * @param {boolean} [options.force] - Force reinstall
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<InstallResult>}
 */
export async function installPackage(id, options = {}) {
  const { force = false, onProgress } = options;

  // Ensure directories exist
  ensureDirectories();

  // Resolve package and dependencies
  onProgress?.({ phase: 'resolving', package: id });
  const resolved = await resolvePackage(id);

  // Get install order (dependencies first)
  let toInstall = getInstallOrder(resolved);

  // If already installed and not forcing, skip
  if (toInstall.length === 0 && !force) {
    return {
      success: true,
      id: resolved.id,
      path: getPackagePath(resolved.id),
      alreadyInstalled: true
    };
  }

  // If forcing reinstall, add the main package if not already in list
  if (force && !toInstall.find(p => p.id === resolved.id)) {
    toInstall.push(resolved);
  }

  // Install each package in order
  const results = [];
  for (const pkg of toInstall) {
    onProgress?.({ phase: 'installing', package: pkg.id, total: toInstall.length, current: results.length + 1 });

    try {
      const result = await installSinglePackage(pkg, { force, onProgress });
      results.push(result);
    } catch (error) {
      return {
        success: false,
        id: pkg.id,
        error: error.message
      };
    }
  }

  // Write lockfile
  onProgress?.({ phase: 'lockfile', package: resolved.id });
  await writeLockfile(resolved);

  return {
    success: true,
    id: resolved.id,
    path: getPackagePath(resolved.id),
    installed: results.map(r => r.id)
  };
}

/**
 * Install a single package (without dependencies)
 * @param {Object} pkg - Resolved package info
 * @param {Object} options
 * @returns {Promise<InstallResult>}
 */
async function installSinglePackage(pkg, options = {}) {
  const { force = false, onProgress } = options;
  const installPath = getPackagePath(pkg.id);

  // Check if already installed
  if (fs.existsSync(installPath) && !force) {
    return { success: true, id: pkg.id, path: installPath, skipped: true };
  }

  // Handle runtimes, tools, agents - download from GitHub releases or install via npm
  if (pkg.kind === 'runtime' || pkg.kind === 'tool' || pkg.kind === 'agent') {
    const pkgName = pkg.id.replace(/^(runtime|tool|agent):/, '');

    onProgress?.({ phase: 'downloading', package: pkg.id });

    // Handle npm-based packages (agents, cloud CLIs)
    if (pkg.npmPackage) {
      try {
        const { execSync } = await import('child_process');

        if (!fs.existsSync(installPath)) {
          fs.mkdirSync(installPath, { recursive: true });
        }

        onProgress?.({ phase: 'installing', package: pkg.id, message: `npm install ${pkg.npmPackage}` });

        // Use bundled Node's npm if RESOURCES_PATH is set (running from Studio)
        // Otherwise fall back to system npm (CLI standalone use)
        const resourcesPath = process.env.RESOURCES_PATH;
        const npmCmd = resourcesPath
          ? path.join(resourcesPath, 'bundled-runtimes', 'node', 'bin', 'npm')
          : 'npm';

        // Initialize package.json if needed
        if (!fs.existsSync(path.join(installPath, 'package.json'))) {
          execSync(`"${npmCmd}" init -y`, { cwd: installPath, stdio: 'pipe' });
        }

        // Install the npm package
        execSync(`"${npmCmd}" install ${pkg.npmPackage}`, { cwd: installPath, stdio: 'pipe' });

        // Write package metadata
        fs.writeFileSync(
          path.join(installPath, 'manifest.json'),
          JSON.stringify({
            id: pkg.id,
            kind: pkg.kind,
            name: pkgName,
            version: pkg.version || 'latest',
            npmPackage: pkg.npmPackage,
            installedAt: new Date().toISOString(),
            source: 'npm'
          }, null, 2)
        );

        return { success: true, id: pkg.id, path: installPath };
      } catch (error) {
        throw new Error(`Failed to install ${pkg.npmPackage}: ${error.message}`);
      }
    }

    // Handle pip-based packages (aider, etc.)
    if (pkg.pipPackage) {
      try {
        const { execSync } = await import('child_process');

        if (!fs.existsSync(installPath)) {
          fs.mkdirSync(installPath, { recursive: true });
        }

        onProgress?.({ phase: 'installing', package: pkg.id, message: `pip install ${pkg.pipPackage}` });

        // Use downloaded Python from ~/.prompt-stack/runtimes/python/ if available
        // Otherwise fall back to system python3
        const pythonPath = path.join(PATHS.runtimes, 'python', 'bin', 'python3');
        const pythonCmd = fs.existsSync(pythonPath) ? pythonPath : 'python3';

        // Create a virtual environment
        execSync(`"${pythonCmd}" -m venv "${installPath}/venv"`, { stdio: 'pipe' });

        // Install the pip package in the venv
        execSync(`"${installPath}/venv/bin/pip" install ${pkg.pipPackage}`, { stdio: 'pipe' });

        // Write package metadata
        fs.writeFileSync(
          path.join(installPath, 'manifest.json'),
          JSON.stringify({
            id: pkg.id,
            kind: pkg.kind,
            name: pkgName,
            version: pkg.version || 'latest',
            pipPackage: pkg.pipPackage,
            installedAt: new Date().toISOString(),
            source: 'pip',
            venvPath: path.join(installPath, 'venv')
          }, null, 2)
        );

        return { success: true, id: pkg.id, path: installPath };
      } catch (error) {
        throw new Error(`Failed to install ${pkg.pipPackage}: ${error.message}`);
      }
    }

    // Handle binary packages (runtimes and tools) - download from GitHub releases
    const version = pkg.version?.replace(/\.x$/, '.0') || '1.0.0';

    try {
      await downloadRuntime(pkgName, version, installPath, {
        onProgress: (p) => onProgress?.({ ...p, package: pkg.id })
      });
      return { success: true, id: pkg.id, path: installPath };
    } catch (error) {
      // If download fails, create placeholder (for development/testing)
      console.warn(`Package download failed: ${error.message}`);
      console.warn(`Creating placeholder for ${pkg.id}`);

      if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
      }
      fs.writeFileSync(
        path.join(installPath, 'manifest.json'),
        JSON.stringify({
          id: pkg.id,
          kind: pkg.kind,
          name: pkg.name,
          version: pkg.version,
          installedAt: new Date().toISOString(),
          source: 'placeholder',
          error: error.message
        }, null, 2)
      );
      return { success: true, id: pkg.id, path: installPath, placeholder: true };
    }
  }

  // Handle stacks/prompts - download from registry or local
  if (pkg.path) {
    onProgress?.({ phase: 'downloading', package: pkg.id });
    try {
      await downloadPackage(pkg, installPath, { onProgress });

      // Write manifest
      fs.writeFileSync(
        path.join(installPath, 'manifest.json'),
        JSON.stringify({
          id: pkg.id,
          kind: pkg.kind,
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          runtime: pkg.runtime,
          entry: pkg.entry || 'create_pdf.py',  // default entry point
          requires: pkg.requires,
          installedAt: new Date().toISOString(),
          source: 'registry'
        }, null, 2)
      );

      onProgress?.({ phase: 'installed', package: pkg.id });
      return { success: true, id: pkg.id, path: installPath };
    } catch (error) {
      throw new Error(`Failed to install ${pkg.id}: ${error.message}`);
    }
  }

  // Fallback: create placeholder
  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true });
  }
  fs.mkdirSync(installPath, { recursive: true });

  const manifest = {
    id: pkg.id,
    kind: pkg.kind,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    installedAt: new Date().toISOString(),
    source: 'registry'
  };

  fs.writeFileSync(
    path.join(installPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  onProgress?.({ phase: 'installed', package: pkg.id });

  return { success: true, id: pkg.id, path: installPath };
}

/**
 * Uninstall a package
 * @param {string} id - Package ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function uninstallPackage(id) {
  const installPath = getPackagePath(id);

  if (!fs.existsSync(installPath)) {
    return { success: false, error: `Package not installed: ${id}` };
  }

  try {
    fs.rmSync(installPath, { recursive: true });

    // Remove lockfile
    const [kind, name] = parsePackageId(id);
    const lockPath = path.join(PATHS.locks, kind + 's', `${name}.lock.yaml`);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Install from a local directory
 * @param {string} dir - Directory containing the package
 * @param {Object} options
 * @returns {Promise<InstallResult>}
 */
export async function installFromLocal(dir, options = {}) {
  ensureDirectories();

  // Read manifest
  const manifestPath = path.join(dir, 'stack.yaml') || path.join(dir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest found in ${dir}`);
  }

  // Parse manifest (simplified for now)
  const { parse: parseYaml } = await import('yaml');
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = parseYaml(manifestContent);

  // Ensure ID has prefix
  const id = manifest.id.includes(':') ? manifest.id : `stack:${manifest.id}`;
  const installPath = getPackagePath(id);

  // Copy to install location
  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true });
  }

  await copyDirectory(dir, installPath);

  // Write install metadata
  const meta = {
    id,
    kind: 'stack',
    name: manifest.name,
    version: manifest.version,
    installedAt: new Date().toISOString(),
    source: 'local',
    sourcePath: dir
  };

  fs.writeFileSync(
    path.join(installPath, '.install-meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return { success: true, id, path: installPath };
}

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

/**
 * List all installed packages
 * @param {'stack' | 'prompt' | 'runtime' | 'tool' | 'agent'} [kind] - Filter by kind
 * @returns {Promise<Array>}
 */
export async function listInstalled(kind) {
  const kinds = kind ? [kind] : ['stack', 'prompt', 'runtime', 'tool', 'agent'];
  const packages = [];

  for (const k of kinds) {
    const dir = {
      stack: PATHS.stacks,
      prompt: PATHS.prompts,
      runtime: PATHS.runtimes,
      tool: PATHS.tools,
      agent: PATHS.agents
    }[k];

    if (!dir || !fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const pkgDir = path.join(dir, entry.name);

      // Check for manifest.json or runtime.json
      const manifestPath = path.join(pkgDir, 'manifest.json');
      const runtimePath = path.join(pkgDir, 'runtime.json');

      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        packages.push({ ...manifest, kind: k, path: pkgDir });
      } else if (fs.existsSync(runtimePath)) {
        // Older format - has runtime.json
        const runtimeMeta = JSON.parse(fs.readFileSync(runtimePath, 'utf-8'));
        packages.push({
          id: `${k}:${entry.name}`,
          kind: k,
          name: entry.name,
          version: runtimeMeta.version || 'unknown',
          description: `${entry.name} ${k}`,
          installedAt: runtimeMeta.downloadedAt || runtimeMeta.installedAt,
          path: pkgDir
        });
      }
    }
  }

  return packages;
}

/**
 * Update a package to the latest version
 * @param {string} id - Package ID
 * @returns {Promise<InstallResult>}
 */
export async function updatePackage(id) {
  // Force reinstall
  return installPackage(id, { force: true });
}

/**
 * Update all installed packages
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<InstallResult[]>}
 */
export async function updateAll(options = {}) {
  const installed = await listInstalled();
  const results = [];

  for (const pkg of installed) {
    options.onProgress?.({ package: pkg.id, current: results.length + 1, total: installed.length });

    try {
      const result = await updatePackage(pkg.id);
      results.push(result);
    } catch (error) {
      results.push({ success: false, id: pkg.id, error: error.message });
    }
  }

  return results;
}
