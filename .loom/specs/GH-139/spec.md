# Spec

- Suite path: not_applicable

- Suite-level not_applicable: rationale: Loom v0.26.3 maintenance upgrade updates repository installed-state metadata, workflow pin, and the item-specific Loom carrier required for admission.; consumer boundary: No product runtime, business behavior, or application source changes are included; consumers are Loom governance/admission only.; recheck condition: Re-run Loom installed-state validate, pr metadata preflight, pre-review, review, merge-ready, and hosted merge gate before merge.; scope proof: Changed paths are limited to .loom/installed-state.json, .github/workflows/loom-check.yml, and .loom/specs/GH-139/spec.md for the GH-139 maintenance item.; review requirement: current_head_review_required.

## PR Intent

- Intent profile: runtime-upgrade-only
- Work Item: GH-139
- Change class: runtime_upgrade
- Review, PR gate, merge-ready, release readback, and closeout evidence remain required by their normal gates.
