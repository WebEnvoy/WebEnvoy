# CORE-275 Spec

## Goal

Map the legal Harbor failure `safety_challenge` to the canonical pinned Lode BOSS failure `captcha_required`, so Core requests manual verification rather than package repair.

## Suite Path

- Suite path: minimal
- contracts.md not_applicable rationale: the upstream Harbor and Lode contracts do not change; Core uses its existing compatibility adapter. Consumer boundary: CORE-275 implementation review. Recheck condition: require `contracts.md` if an upstream canonical class changes.
- readiness-checklist.md not_applicable rationale: packaged live rerun and closeout are controller-owned. Consumer boundary: CORE-275 PR readiness. Recheck condition: require `readiness-checklist.md` after merge when live execution begins.
- research.md not_applicable rationale: issue #275, run `app-boss-mrhkcwwt`, and current cross-repo contracts are sufficient. Consumer boundary: CORE-275 implementation. Recheck condition: require `research.md` if producer or canonical semantics become ambiguous.
- suite-index.md not_applicable rationale: minimal artifacts are directly located under this directory. Consumer boundary: suite validation and review. Recheck condition: require `suite-index.md` if governance escalates to full.

## Acceptance

- A valid bound Harbor unavailable response with `safety_challenge` becomes `captcha_required`, never `site_changed`.
- Unknown legal-envelope failure tokens remain fail-closed in the pinned-taxonomy fallback.
- Malformed Harbor outcomes remain unknown outcomes.
- Existing mappings and refs-only boundaries do not change.

## Non-Goals

No Harbor/Lode/App edits, duplicate Lode class, automatic login, sensitive material, external write, bulk collection, or risk-control bypass.
