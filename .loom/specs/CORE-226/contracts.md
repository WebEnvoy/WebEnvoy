# CORE-226 Contracts

## Consumed Contracts

- Core Run Record and Result Envelope v0 from `docs/contracts/README.md`.
- Lode Xiaohongshu read packages:
  - `lode://site-capability/xiaohongshu/search-notes@0.1.0`
  - `lode://site-capability/xiaohongshu/read-note-detail@0.1.0`
- Lode BOSS read packages:
  - `lode://site-capability/boss/job-search@0.1.0`
  - `lode://site-capability/boss/read-job-detail@0.1.0`
- Harbor public runtime/session/evidence refs from the closed milestone #12 input fact.

## Added Core Contract

- Read-only projection completion accepts Lode normalized output with source/evidence refs.
- Run Record persists:
  - `result_kind`
  - `output_schema_id`
  - `projection_ref`
  - `source_refs`
  - `evidence_refs`
- Result query reconstructs these refs into the public result envelope.
- Failure mapping covers `not_logged_in`, `captcha_required`, `page_changed`, and `field_missing`.

## Privacy Boundary

Allowed: refs, schema ids, package/version/lock ids, public normalized projection envelope, failure reason, post-check status.

Forbidden: cookies, tokens, credentials, profile storage, runtime endpoints, viewer URLs, raw DOM, HAR, network bodies, screenshot/video bodies, raw evidence, Lode package code, production private payloads, true write outputs.
