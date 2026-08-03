# Harbor Docs

This directory keeps Harbor decisions and implementation-facing contract indexes.

## Directories

| Directory | Purpose | Rule |
| --- | --- | --- |
| `adr/` | Architecture decisions, accepted docs-only contracts, rejected/deferred boundaries, and pending decision records. | Use for why Harbor owns or rejects a runtime/profile/evidence boundary. |
| `contracts/` | Stable contract index for later implementation, tests, and cross-repo consumers. | Link to accepted ADRs and absorbed draft analysis; do not duplicate specs. |
| `draft/` | Temporary planning notes, deferred material, or pointers from old drafts to formal truth. | Drafts must have status, owner, linked issue, and exit condition; they are not implementation authority. |

Do not create `docs/guides/` until Harbor has a real runnable workflow to document.
