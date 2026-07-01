# Spec

- Suite path: not_applicable

- Suite-level not_applicable: rationale: runtime-upgrade-only PR intent updates the target repository Loom workflow pin and maintenance carriers only; consumer boundary: suite validate, review, PR gate, merge-ready, and closeout may consume this only as workflow-only runtime maintenance non-applicability; PR metadata, current-head review, hosted checks, head binding, and carrier closeout remain required; recheck condition: diff touches non-workflow runtime code, product behavior, release surfaces, or workstation plugin/cache state; scope proof: runtime-upgrade-only scope proof: changed paths are limited to `.github/workflows/loom-check.yml`, `.loom/companion/repo-interface.json`, and the item-specific `.loom/specs/GH-91/spec.md` carrier; review requirement: current_head_review_required.

## PR Intent

- Intent profile: runtime-upgrade-only
- Work Item: GH-91
- Change class: runtime_upgrade
- Review, PR gate, merge-ready, release readback, and closeout evidence remain required by their normal gates.
