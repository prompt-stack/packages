# Prompt Stack Packages

Shared libraries and utilities for Prompt Stack. Used by both the CLI and Studio.

## Monorepo Structure

```
packages/
├── core/                          # Core resolver and installer
│   └── @prompt-stack/core
├── runner/                        # Execution engine
│   └── @prompt-stack/runner
├── manifest/                      # Stack/prompt manifest parsing
│   └── @prompt-stack/manifest
└── db/                            # Database and session management
    └── @prompt-stack/db
```

## Packages

### @prompt-stack/core

Resolver, installer, and registry client. Handles:

- Package discovery and search
- Dependency resolution
- Installation to `~/.prompt-stack/packages/`
- Lockfile generation
- Registry caching

**Used by**: CLI `search`, `install`, `list` commands

**Exports**:

```typescript
export async function searchPackages(query: string, options?: SearchOptions): Promise<Package[]>
export async function installPackage(id: string, version?: string): Promise<Installation>
export async function listInstalledPackages(kind?: 'stack' | 'prompt' | 'runtime'): Promise<Package[]>
```

### @prompt-stack/runner

Execution engine for stacks and prompts. Handles:

- Stream execution (stdout/stderr)
- Environment variable injection (secrets)
- Working directory management
- Exit code handling

**Used by**: CLI `run` command, Studio execution

**Exports**:

```typescript
export async function runStack(id: string, options: RunOptions): Promise<RunResult>
export async function checkSecrets(required: SecretDeclaration[]): Promise<SecretCheck>
```

### @prompt-stack/manifest

Stack, prompt, and runtime manifest parsing. Validates:

- YAML/JSON structure
- Required fields
- Input/output schemas
- Dependencies and runtime requirements

**Used by**: Core, Runner, CLI

**Exports**:

```typescript
export function parseStackManifest(path: string): StackManifest
export function parsePromptManifest(path: string): PromptManifest
export function validateManifest(manifest: any): ValidationResult
```

### @prompt-stack/db

SQLite-based database layer. Manages:

- Session storage (all messages from all providers)
- Execution history (runs, artifacts, costs)
- Installation tracking (what's installed, where)
- Full-text search across sessions

**Used by**: CLI `db` commands, Studio session browser

**Exports**:

```typescript
export async function initDatabase(): Promise<Database>
export async function storSession(session: Session): Promise<void>
export async function searchSessions(query: string): Promise<Session[]>
export async function getRunHistory(): Promise<Run[]>
export async function calculateCosts(): Promise<CostBreakdown>
```

## Development

### Installation

Install dependencies:

```bash
npm install
```

### Building

Build all packages:

```bash
npm run build
```

Build a specific package:

```bash
npm run build -- --filter=@prompt-stack/core
```

### Testing

Run tests:

```bash
npm test
```

Test a specific package:

```bash
npm test -- --filter=@prompt-stack/runner
```

### Linking to CLI/Studio

Both CLI and Studio import these packages. During development:

```bash
# In packages/core, packages/runner, etc
npm link

# In cli/ or studio/
npm link @prompt-stack/core @prompt-stack/runner @prompt-stack/manifest @prompt-stack/db
```

Or use workspace references (preferred):

```json
{
  "dependencies": {
    "@prompt-stack/core": "workspace:*"
  }
}
```

## Architecture

All packages follow a consistent interface:

```typescript
// All async by design
export async function operation(params: Params): Promise<Result>
```

### Data Flow

```
CLI/Studio Input
    ↓
@prompt-stack/manifest (parse/validate)
    ↓
@prompt-stack/core (resolve/install)
    ↓
@prompt-stack/runner (execute)
    ↓
@prompt-stack/db (store/log)
    ↓
Output / Artifact
```

### Error Handling

All packages throw typed errors:

```typescript
export class PromptStackError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export class ManifestValidationError extends PromptStackError {}
export class RuntimeNotFoundError extends PromptStackError {}
export class SecretMissingError extends PromptStackError {}
```

## Publishing

Packages are published to npm as scoped packages:

```bash
npm publish --scope=@prompt-stack
```

Only CLI and Runner are published publicly.  Core and DB are internal-only (for now).

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Code style
- Commit conventions
- Testing requirements
- Pull request process

## License

MIT
