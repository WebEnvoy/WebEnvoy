# CORE-221 Plan

## Implementation Goal

Extend existing admission functions and self-checks. Do not add a loader, registry client, browser integration, or new dependency.

## Phases

### Phase 1

- Objective: Bind public Harbor facts.
- Deliverable: `harbor-admission.ts` accepts provider catalog and public resource facts, validates provider availability, identity/runtime match, and control-safe runtime binding.
- Exit condition: Core runtime self-check covers accepted and blocked Harbor paths.

### Phase 2

- Objective: Bind Lode locks and resource facts.
- Deliverable: `lode-admission.ts` returns required Harbor fact keys from package resource requirements and `task-submission.ts` consumes them during Harbor admission.
- Exit condition: Xiaohongshu/BOSS real-site self-checks validate package refs, lock refs, and required fact matching.

### Phase 3

- Objective: Harden Run Record privacy.
- Deliverable: `run-record-store.ts` rejects private browser material on all direct create/update paths.
- Exit condition: Core runtime self-check proves direct private material persistence is refused.

### Phase 4

- Objective: PR readiness.
- Deliverable: Loom carriers, validation evidence, commit, push, PR, metadata readback/preflight.
- Exit condition: PR covers #220/#221/#222/#223/#224 and declares consumed Harbor/Lode truth, privacy boundary, and non-goals.

## Validation

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-221 --json`
- `loom suite carrier validate --target . --item CORE-221 --json`
- `loom suite evidence validate --target . --item CORE-221 --json`
- `loom build --target . --item CORE-221 --build-evidence .loom/specs/CORE-221/build-evidence.json --json`
- `loom pr metadata-readback` and `loom pr metadata-preflight` after PR creation.

## Constraints

- Reuse existing FileRunRecordStore, task submission, and admission helpers.
- Do not add runtime dependencies or persistence backends.
- Do not modify App, Harbor, or Lode code.
- Do not run or attach to a live browser or external site.

## Ready For Review

- [ ] Local validation passed on current head.
- [ ] PR metadata readback matches CORE-221 branch/head/repository and issue coverage.
