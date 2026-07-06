# CORE-199 Research

## Consumed Inputs

| Locator | Consumed fact | Boundary |
|---|---|---|
| https://github.com/WebEnvoy/WebEnvoy/issues/187 | Core can bind submitted tasks to Harbor identity/session refs without storing private browser material. | Public refs/status facts only. |
| https://github.com/WebEnvoy/WebEnvoy/issues/188 | Core can represent real Xiaohongshu/BOSS read-only run records, result attribution, interruption states, and public refs. | Does not close #189/#190 or add App UI/live operation. |
| https://github.com/WebEnvoy/WebEnvoy/issues/189#issuecomment-4888808258 | Stories #29/#30 require real page evidence association and structured failure reasons. | Product semantics only. |
| https://github.com/WebEnvoy/Harbor/issues/11 | Harbor owns runtime/profile/session/evidence boundaries and does not move hosted browser/vault/persona/private UI shell truth into Core. | No Harbor private scene/account/cookie/token/profile/raw material copied. |
| https://github.com/WebEnvoy/Lode/issues/13 | Lode owns capability/package/resource/post-check facts and package body/validator code. | Core records package refs/version/lock only. |

## Decisions

- Reuse Run Record as durable truth; no second result/evidence store.
- Add only GET query projections and JSON fixtures; no new framework or dependency.
- Failure reason query returns machine-readable classes and app_action, not localized UI text or automatic recovery.

## Deferred

- Batch export, search, App rendering, Harbor raw evidence viewer, write-side verification, and recovery execution stay out of scope.
