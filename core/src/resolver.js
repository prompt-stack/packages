/**
 * Dependency resolver for RUDI
 * Resolves package dependencies and version constraints
 */

import { getPackage } from '@learnrudi/registry-client';
import { isPackageInstalled, parsePackageId } from '@learnrudi/env';

/**
 * Resolve a package and all its dependencies
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator' or just 'pdf-creator')
 * @returns {Promise<Object>} Resolved package with dependencies
 */
export async function resolvePackage(id) {
  // Normalize ID (default to stack if no prefix)
  const normalizedId = id.includes(':') ? id : `stack:${id}`;

  // Get package from registry
  const pkg = await getPackage(normalizedId);
  if (!pkg) {
    throw new Error(`Package not found: ${id}`);
  }

  // Build full ID
  const fullId = pkg.id?.includes(':') ? pkg.id : `${pkg.kind}:${pkg.id || id.split(':').pop()}`;

  // Check if installed
  const installed = isPackageInstalled(fullId);

  // Resolve dependencies
  const dependencies = await resolveDependencies(pkg);

  return {
    id: fullId,
    kind: pkg.kind,
    name: pkg.name,
    version: pkg.version,
    path: pkg.path,
    description: pkg.description,
    runtime: pkg.runtime,
    entry: pkg.entry,
    installed,
    dependencies,
    requires: pkg.requires,
    // Install-related properties
    npmPackage: pkg.npmPackage,
    pipPackage: pkg.pipPackage,
    postInstall: pkg.postInstall,
    binary: pkg.binary,
    installDir: pkg.installDir
  };
}

/**
 * Resolve dependencies for a package
 */
async function resolveDependencies(pkg) {
  const dependencies = [];

  // Resolve runtime dependencies
  const runtimes = pkg.requires?.runtimes || (pkg.runtime ? [pkg.runtime] : []);

  for (const runtime of runtimes) {
    const runtimeId = runtime.startsWith('runtime:') ? runtime : `runtime:${runtime}`;
    const runtimePkg = await getPackage(runtimeId);

    if (runtimePkg) {
      dependencies.push({
        id: runtimeId,
        kind: 'runtime',
        name: runtimePkg.name,
        version: runtimePkg.version,
        installed: isPackageInstalled(runtimeId),
        dependencies: []
      });
    }
  }

  // Resolve binary dependencies
  const binaries = pkg.requires?.binaries || pkg.requires?.tools || [];
  for (const binary of binaries) {
    const binaryId = binary.startsWith('binary:')
      ? binary
      : binary.startsWith('tool:')
        ? binary.replace(/^tool:/, 'binary:')
        : `binary:${binary}`;
    const binaryPkg = await getPackage(binaryId);

    if (binaryPkg) {
      dependencies.push({
        id: binaryId,
        kind: 'binary',
        name: binaryPkg.name,
        version: binaryPkg.version,
        installed: isPackageInstalled(binaryId),
        dependencies: []
      });
    }
  }

  // Resolve agent dependencies
  const agents = pkg.requires?.agents || [];
  for (const agent of agents) {
    const agentId = agent.startsWith('agent:') ? agent : `agent:${agent}`;
    const agentPkg = await getPackage(agentId);

    if (agentPkg) {
      dependencies.push({
        id: agentId,
        kind: 'agent',
        name: agentPkg.name,
        version: agentPkg.version,
        installed: isPackageInstalled(agentId),
        dependencies: []
      });
    }
  }

  return dependencies;
}

/**
 * Check if all dependencies are satisfied
 * @param {Object} resolved - Resolved package
 * @returns {{ satisfied: boolean, missing: Array }}
 */
export function checkDependencies(resolved) {
  const missing = [];

  function check(pkg) {
    for (const dep of pkg.dependencies || []) {
      if (!dep.installed) {
        missing.push(dep);
      }
      check(dep);
    }
  }

  check(resolved);

  return {
    satisfied: missing.length === 0,
    missing
  };
}

/**
 * Get installation order (dependencies first)
 * @param {Object} resolved - Resolved package
 * @returns {Array} Packages in install order
 */
export function getInstallOrder(resolved) {
  const order = [];
  const visited = new Set();

  function visit(pkg) {
    if (visited.has(pkg.id)) return;
    visited.add(pkg.id);

    // Visit dependencies first
    for (const dep of pkg.dependencies || []) {
      visit(dep);
    }

    // Then add this package if not installed
    if (!pkg.installed) {
      order.push(pkg);
    }
  }

  visit(resolved);
  return order;
}

/**
 * Resolve multiple packages at once
 * @param {string[]} ids - Package IDs
 * @returns {Promise<Array>}
 */
export async function resolvePackages(ids) {
  return Promise.all(ids.map(id => resolvePackage(id)));
}

/**
 * Check if a version satisfies a constraint
 * @param {string} version - Actual version (e.g., '3.12.0')
 * @param {string} constraint - Version constraint (e.g., '>=3.10')
 * @returns {boolean}
 */
export function satisfiesVersion(version, constraint) {
  if (!constraint) return true;

  const [major, minor = 0, patch = 0] = version.split('.').map(Number);

  const match = constraint.match(/^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return true;

  const [, op = '=', cMajor, cMinor = '0', cPatch = '0'] = match;
  const constraintVersion = [Number(cMajor), Number(cMinor), Number(cPatch)];
  const actualVersion = [major, minor, patch];

  const cmp = compareVersions(actualVersion, constraintVersion);

  switch (op) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>': return cmp > 0;
    case '<': return cmp < 0;
    case '=': return cmp === 0;
    default: return cmp === 0;
  }
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}
