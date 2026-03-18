# melodi-cli - Copilot Instructions

## Project Overview

melodi-cli is an interactive CLI tool for working with iModels, ECDb files, and standalone databases from the iTwin.js ecosystem. It provides a terminal UI for running ECSql/SQLite queries, managing schemas, troubleshooting FK violations, downloading iModels from iModelHub, and hosting an MCP server for AI-driven querying.

- **Author**: @rschili
- **Package**: `@rschili/melodi-cli` (npm, public)
- **Runtime**: Node.js >= 22.14, ESM (`"type": "module"`)
- **UI**: `@clack/prompts` for interactive terminal UI, `chalk` for colors, `table` for tabular output
- **Bundler**: esbuild (single-file `dist/index.mjs`)
- **Testing**: Vitest with `pool: "forks"` (required for native addon compatibility)
- **Linting**: ESLint flat config with `typescript-eslint`

## Architecture

### Humble Object Pattern

Interactive modules follow a **humble object pattern** to separate testable logic from UI:

- `src/Logic/*Ops.ts` - Pure logic functions (exported, no UI dependencies, fully testable)
- `src/Logic/*.ts` - Thin interactive shells that import from `*Ops.ts` and handle `@clack/prompts`, spinners, chalk formatting

**Template**: `TroubleshootOps.ts` + `Troubleshooter.ts` is the reference implementation of this pattern.

When adding new features or refactoring existing ones, extract pure logic into `*Ops.ts` files. The UI shell should only contain:
- `@clack/prompts` calls (select, confirm, text, spinner, log)
- chalk formatting
- console output / `table()` rendering
- Error display via `logError()`

### Key Types

- `UnifiedDb` - Wraps any iTwin.js database type with a uniform API. Implements `Disposable` (`using db = ...`). Key capabilities:
  - `supportsECSql`, `supportsSqlite`, `supportsSchemas`, `supportsChangesets`
  - `supportsChangesets` returns `false` for `StandaloneDb` (even though it extends `BriefcaseDb`)
  - `withSqliteStatement()`, `withECSqlStatement()`, `createQueryReader()`
  - `innerDb` - the underlying iTwin.js db instance
- `Context` - workspace state: `folders`, `files`, `commandCache`, `envManager`, `userConfig`
- `WorkspaceFile` - detected file with metadata: `relativePath`, `lastTouched`, `hasITwinId`, `bisCoreVersion`, `ecDbVersion`, `elements`, `parentChangeSetId`

## Build & Test

```bash
make build     # lint + typecheck + esbuild bundle + chmod
make test      # npx vitest run
make cover     # npx vitest run --coverage (v8 provider, HTML report)
```

Build runs: prebuild (generate buildInfo.ts, lint, typecheck) -> esbuild -> chmod.
Always build before manual testing. Tests run against source via Vitest (no compile step needed).

## Testing Conventions

- Test files: `test/*.test.ts`
- Shared helpers: `test/TestHelper.ts` - `ensureIModelHost()`, `shutdownIModelHost()`, `getTestDir()`, `cleanupTestDir()`
- Native addon tests need IModelHost initialized (async, one-time per process)
- Use `using db = createTestDb(...)` for automatic cleanup via Disposable
- Each test db gets a unique filename to avoid conflicts in parallel runs
- `pool: "forks"` in vitest.config.ts is mandatory - native addons crash with threads pool

## Dependencies Worth Knowing

- `@itwin/core-backend` - BriefcaseDb, StandaloneDb, SnapshotDb, ECDb, SQLiteDb, IModelHost
- `@itwin/core-common` - QueryOptionsBuilder, QueryRowFormat
- `@itwin/core-bentley` - DbResult, Guid, Logger
- `@itwin/imodels-client-management` / `@itwin/imodels-client-authoring` - iModelHub API clients
- `@itwin/itwins-client` - iTwin project API
- `@clack/prompts` - interactive terminal UI (select, confirm, text, spinner, multiselect, tasks, log)
- `@modelcontextprotocol/sdk` - MCP server (SSE transport)
- `axios` - HTTP client (schema downloads)
- `semver` - version comparison for schemas
- `zod/v4` - runtime validation (changeset list schema)

## Gotchas

- `StandaloneDb extends BriefcaseDb` in the iTwin.js hierarchy, so `instanceof BriefcaseDb` is true for StandaloneDb. Always check for StandaloneDb first when distinguishing.
- `@clack/prompts` `isCancel()` returns true for user cancellation (Ctrl+C in prompts). Always check before using the value.
- esbuild bundles everything into a single ESM file. The `ecsql-guide.md` is imported as a string via a custom loader.
- The `buildInfo.ts` file is auto-generated during prebuild - don't edit manually.
