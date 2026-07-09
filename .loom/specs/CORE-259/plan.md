# CORE-259 Plan

## Phases

1. Create a separate CORE-259 Work Item and issue anchor for the carrier repair.
2. Add CORE-259 progress/spec/plan/evidence carriers and point `.loom/status/current.md` plus `.loom/bootstrap/init-result.json` fact-chain entry points at CORE-259.
3. Do not modify `.loom/reviews/CORE-248.json`.
4. Validate fact-chain, suite, carrier, evidence, and repository verify surfaces.
5. Create a carrier-only PR bound to Core #259 with explicit non-goals and retained CORE-248 review boundary.
6. Merge after hosted gate, close Core #259 with PR/head/merge evidence, then continue Core #243/#244 live runtime implementation.

## Validation

- `git diff --check`
- `loom fact-chain --target . --item CORE-259 --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-259 --json`
- `loom suite carrier validate --target . --item CORE-259 --json`
- `loom suite evidence validate --target . --item CORE-259 --json`
- `loom pr gate --target . <PR> --head-sha <HEAD> --json`
