# Harbor draft lifecycle

`docs/draft/` only holds short-lived planning material that is not yet accepted as Harbor truth.

Drafts must include:

- Status: `promoted`, `pointer`, `pending`, `deferred`, or `removed`.
- Owner: a GitHub Work Item or FR.
- Linked issue: the issue that decides, promotes, defers, or removes the draft.
- Exit condition: where the draft moves, or when it is deleted.

Drafts must not be used as implementation basis. Accepted truth belongs in `docs/adr/`; `docs/contracts/` only indexes accepted contract truth without duplicating specs.

## Directory semantics

| Directory | Meaning |
|---|---|
| `docs/adr/` | Durable architecture decisions and accepted docs-only contracts. |
| `docs/contracts/` | Minimal index of Stage 2 accepted contracts that later implementation can depend on. It links to ADRs instead of rewriting specs. |
| `docs/draft/` | Temporary planning notes awaiting promotion, deferral, pointerization, or removal. |

Do not create empty `docs/guides/`. Add it only when real user-facing guide content exists.

## Draft inventory

| File | Current use | Reading judgment | Status | Target position | Owner / linked issue | Action |
|---|---|---|---|---|---|---|
| `docs/draft/README.md` | Draft directory policy and inventory. | Still valuable as the local lifecycle/index page; it is not contract truth. | promoted | Keep as `docs/draft/README.md`. | GH-62 / #61 #62 #64 | Rewritten as lifecycle rules plus concrete inventory. |
| `docs/draft/architecture.md` | Early app/package/module layout sketch. | Has independent value as an implementation-layout reminder, but Stage 2 accepted no package layout and the repo has no code tree yet. | pending | Stay in draft until a layout ADR or implementation docs exist. | GH-62 / #61 #64 | Keep with explicit owner, issue, and exit condition; do not index as contract truth. |
| `docs/draft/browser-drivers.md` | Driver responsibilities and provider boundary notes. | Contains still-valid adapter responsibility and non-goal analysis; stable facts are absorbed into `docs/contracts/README.md` and ADR 0006. | pointer | Point to ADR 0006 plus contracts absorption table; ADR 0003 is background only. | GH-62 / #63 #64 | Replace body with absorption/coverage/deferred summary; remove duplicate spec text. |
| `docs/draft/evidence-store.md` | Evidence boundary, redaction, and non-goal notes. | Contains still-valid evidence/ref/privacy boundary analysis; stable facts are absorbed into `docs/contracts/README.md` and ADR 0007. | pointer | Point to ADR 0007 plus contracts absorption table; ADR 0004 is background only. | GH-62 / #63 #64 | Replace body with absorption/coverage/rejected summary; remove duplicate spec text. |
| `docs/draft/profile-identity-model.md` | Profile and Execution Identity concept notes. | Contains still-valid Profile vs Execution Identity analysis; stable facts are absorbed into `docs/contracts/README.md` and ADR 0006. | pointer | Point to ADR 0006 plus contracts absorption table. | GH-62 / #63 #64 | Replace body with absorption/deferred summary; remove duplicate spec text. |
| `docs/draft/resource-lifecycle.md` | Resource, lease, session, and health lifecycle notes. | Contains still-valid acquire/release/invalidate and trace analysis; accepted session/fact parts are absorbed into ADR 0005/0006 and contracts index, while field schemas are deferred. | pointer | Point to ADR 0005, ADR 0006, ADR 0007 refs, and contracts absorption table. | GH-62 / #63 #64 | Replace body with absorption/deferred/rejected summary; remove duplicate spec text. |
| `docs/draft/runtime-capability-facts.md` | Runtime/provider/profile/session/evidence facts notes. | Contains still-valid objective-facts analysis; stable facts are absorbed into ADR 0005/0006/0007 and contracts index, while automation-exposure examples stay background. | pointer | Point to ADR 0005, ADR 0006, ADR 0007, and contracts absorption table. | GH-62 / #63 #64 | Replace body with absorption/rejected/deferred summary; remove duplicate spec text. |
