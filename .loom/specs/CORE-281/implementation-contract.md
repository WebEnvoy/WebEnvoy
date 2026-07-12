# CORE-281 Implementation Contract

- Lode owns `runtime_admission`; Core consumes merge `f45b17990a6b1451a7a0ff55ec110c310e66f196` and search allowlist semantic SHA `0e36e0844fa917d84c47db619929e345e8b95463f3d2e74186488d7e3a34a987`.
- Exact current policy is `enabled=true/status=current/recheck_condition=not_applicable`.
- Exact deferred policy is `enabled=false/status=deferred_experimental/recheck_condition=deferred_milestone_scope_restored_with_current_head_review_and_runtime_live_evidence`.
- Site package policy is required in registry and matching operation truth. Unknown keys, values, missing policy, or mismatch fail closed.
- Deferred policy produces category `capability_contract`, code `runtime_admission_disabled`, phase `admission`, recovery `wait_for_scope_activation`.
- The gate executes before Harbor collection and is rechecked by lower-level Lode admission for direct callers.
- Existing Harbor XHS operation evidence pin remains unchanged; it is separate from the new production admission semantic digest.

## Verification

- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `loom suite validate --target . --item CORE-281 --json`
- `loom suite carrier validate --target . --item CORE-281 --json`
