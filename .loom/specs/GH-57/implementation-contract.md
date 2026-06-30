# Implementation Contract

- Write scope: `docs/adr/0006-*.md`, `.loom/work-items/GH-57.md`, `.loom/progress/GH-57.md`, `.loom/specs/GH-57/*`, `.loom/reviews/GH-57*.json`, `.loom/status/current.md`, and necessary `.loom/bootstrap/init-result.json` metadata only.
- Forbidden scope: API/CLI/MCP/SDK/App/runtime code, package scaffolding, final schemas, fixture files, conformance runner, generated artifacts, external source directories, other repositories, issue closeout, merge, and historical `INIT-0001` carrier reuse.
- Validation floor: `git diff --check`, JSON validation, available Loom local checks, and hosted checks after PR creation.
