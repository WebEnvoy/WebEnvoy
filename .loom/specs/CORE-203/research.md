# CORE-203 Research

| Source | Consumed Fact | Boundary |
|---|---|---|
| https://github.com/WebEnvoy/WebEnvoy/issues/190 | FR requires real-page write-preview, risk, approval, unsubmitted state, cancellation, expiry, and page-change states. | Product planning truth only; implementation uses CORE-203 carrier. |
| https://github.com/WebEnvoy/WebEnvoy/issues/203 | Core must accept Xiaohongshu draft and BOSS greeting write-precheck intent records. | No final submit click. |
| https://github.com/WebEnvoy/WebEnvoy/issues/204 | Core must produce action request, risk classification, and approval request. | No approval execution. |
| https://github.com/WebEnvoy/WebEnvoy/issues/205 | Core must expose preview result, evidence refs, and unsubmitted marker. | No submitted state. |
| https://github.com/WebEnvoy/WebEnvoy/issues/206 | Core must record cancelled, expired, and page_changed states. | No automatic true-write retry. |
| WebEnvoy/WebEnvoy PR #208 | Core can store Harbor identity/session public refs only. | No credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence. |
| WebEnvoy/WebEnvoy PR #211 | Core can store real-site read-only run records using Lode/Harbor refs. | #190 write-preview was excluded there. |
| WebEnvoy/WebEnvoy PR #214 | Core exposes run/result/evidence/session/failure query surfaces. | #190/#203-#206 remained excluded there. |
| WebEnvoy/Lode milestone #13 | Lode completed Xiaohongshu/BOSS read and write-precheck capability facts. | Core references package/capability/resource refs only. |
| WebEnvoy/Harbor milestone #11 | Harbor completed public identity/session/evidence refs. | Core references public refs/status facts only. |

## No-Copy Boundary

Core records action, approval, preview, failure, and evidence refs. It does not store cookie/token/password/profile storage, raw DOM, raw network, raw evidence body, local paths, private provider objects, screenshots/videos as bodies, Lode package body, or App UI state.
