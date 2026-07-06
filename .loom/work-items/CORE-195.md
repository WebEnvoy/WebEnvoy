# CORE-195

## Static Facts

- Item ID: CORE-195
- Goal: Execute Core-side real Xiaohongshu and BOSS read-only task runs by consuming Lode package refs and Harbor public runtime/evidence refs, then persist refs-only Run Records, capability attribution, result projection refs, and interruption states.
- Scope: Covers Core FR #188 and Work Items #195/#196/#197/#198; excludes #189/#190/#199-#206, App UI, Harbor/Lode/App code changes, true writes, live account operation, captcha bypass, credentials, cookies, tokens, profile storage, raw DOM, raw network, raw screenshot/video, CDP/VNC/websocket endpoints, and production private page content.
- Execution Path: work/core-188-real-site-readonly
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-195.md
- Review Entry: .loom/reviews/CORE-195.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-195 --json; loom pr metadata-preflight after PR readback
- Closing Condition: PR ready with metadata covering #188/#195/#196/#197/#198 and hosted checks started; merge, issue closeout, release evidence, and current pointer retire are out of scope for this execution thread.

## Covered Work Items

- #195 executes Xiaohongshu read-only package refs through Core admission, running state, result projection, and refs-only Run Record evidence.
- #196 executes BOSS read-only package refs through Core admission, running state, result projection, and refs-only Run Record evidence.
- #197 records capability ref/version/source ref/lock ref/package ref, site resource requirement ref, Harbor identity/runtime/session refs, and evidence refs.
- #198 records cancellation, timeout, and user takeover/manual recovery states without converting them into success or generic failure.

## Associated Artifacts

- packages/core/src/real-site-readonly-self-check.ts
- packages/core/src/self-check.ts
- packages/schemas/fixtures/real-site-xiaohongshu-read-only-run-record.fixture.json
- packages/schemas/fixtures/real-site-boss-read-only-run-record.fixture.json
- packages/schemas/fixtures/real-site-user-takeover-run-record.fixture.json
- packages/conformance/src/self-check.ts
- .loom/specs/CORE-195/**
