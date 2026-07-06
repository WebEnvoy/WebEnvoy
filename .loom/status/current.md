# Current Status

## Derived Fact Chain View

- Item ID: CORE-195
- Goal: Execute Core-side real Xiaohongshu and BOSS read-only task runs by consuming Lode package refs and Harbor public runtime/evidence refs, then persist refs-only Run Records, capability attribution, result projection refs, and interruption states.
- Scope: Covers Core FR #188 and Work Items #195/#196/#197/#198; excludes #189/#190/#199-#206, App UI, Harbor/Lode/App code changes, true writes, live account operation, captcha bypass, credentials, cookies, tokens, profile storage, raw DOM, raw network, raw screenshot/video, CDP/VNC/websocket endpoints, and production private page content.
- Execution Path: work/core-188-real-site-readonly
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-195.md
- Review Entry: .loom/reviews/CORE-195.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-195 --json; loom pr metadata-preflight after PR readback
- Closing Condition: PR ready with metadata covering #188/#195/#196/#197/#198 and hosted checks started; merge, issue closeout, release evidence, and current pointer retire are out of scope for this execution thread.
- Current Checkpoint: closed_out
- Current Stop: PR #211 merged to main, #188/#195/#196/#197/#198 are closed with post-merge evidence, and this closeout carrier records the merged state.
- Next Step: Merge the CORE-195 closeout carrier PR, then retire the current pointer to no_active_item.
- Blockers: None recorded.
- Latest Validation Summary: PR #211 merged at 97cc0670b8b5b0b3abb162361c22b854b4970e61; #188/#195/#196/#197/#198 closed with post-merge evidence; hosted gate run 28784456866 passed; loom fact-chain/verify/suite validate/carrier/evidence passed locally.
- Recovery Boundary: Core task/run/result refs and schema fixture truth only; no App UI, Harbor/Lode/App code, live account operation, external visible action, true write, captcha bypass, private browser material, raw evidence, merge, issue closeout, release evidence, or current pointer retire.
- Current Lane: stage5 real site read-only execution

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: loom verify --target . --json
- Lane Entry: .loom/specs/CORE-195/task-carrier.md

## Sources

- Static Truth: .loom/work-items/CORE-195.md
- Dynamic Truth: .loom/progress/CORE-195.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
