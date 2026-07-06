# CORE-203 Implementation Contract

## Ownership

- `packages/schemas/fixtures/*write-preview*.fixture.json` owns static refs-only Run Record examples for real-page write-preview.
- `packages/conformance/src/real-site-write-preview-fixtures.ts` owns query assertions over those fixtures.
- README updates only describe the added fixture coverage.
- `.loom/**/CORE-203*` owns Work Item governance carriers for this batch.

## Non-Goals

No App, Harbor, or Lode code changes. No live external site action. No final submit click, approval execution, submitted result, true write, reconciliation, unknown outcome, automatic retry, raw evidence body, raw DOM/network, cookie, token, password, profile storage, or private browser endpoint.

## Verification

- Core runtime self-check remains green.
- Schema self-check counts and validates the added fixtures.
- Conformance seeds all write-preview fixtures and checks action, approval, preview, cancellation, expiry, page-change, and no-submit behavior.
- Loom fact-chain, verify, suite validate, carrier validate, evidence validate, and build readiness are refreshed before PR creation.
