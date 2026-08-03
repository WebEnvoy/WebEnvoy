## Summary

- Problem:
- Scope:

## Validation

- [ ] Verified locally
- [ ] Verified by automation
- [ ] Not applicable

Validation details:
- Python compile checks should use `make py-compile` or `python3 tools/py_compile_clean.py ...`; do not use bare `python3 -m py_compile ...` in the repository checkout.

## Risks And Follow-ups

- Risks:
- Follow-ups:

## Related Work

- Work Item: work_item:<GitHub issue number>
- Issue:
- Spec / plan:

## PR Metadata Machine Carrier

If this repository declares repo-specific PR metadata in `.loom/companion/repo-interface.json`, preserve the declared machine block exactly. Render the body to a file, update with `gh pr edit --body-file <file>`, read the PR body back, and run `loom pr metadata-preflight --body-file <rendered> --compare-body-file <readback>` before review or merge-ready.

<!-- loom:repo-pr-metadata
{
  "schema_version": "loom-repo-pr-metadata/v1",
  "metadata_contract_id": "loom-governance-intensity",
  "surface": "merge_ready",
  "fields": {
    "work_item_locator": "work_item:<GitHub issue number>",
    "governance_intensity": "standard",
    "change_class": "contract",
    "suite_path": "minimal",
    "suite_not_applicable": null,
    "review_requirement": "current_head_review_required",
    "fact_chain_required": true,
    "pr_gate_required": true,
    "release_judgment": "no_release",
    "closeout_required": true,
    "upgrade_triggers": []
  },
  "source": {"rendered_hash": "sha256:replace-with-rendered-body-hash-or-renderer-id"},
  "parser_version": "loom-pr-metadata-parser/v1"
}
-->
