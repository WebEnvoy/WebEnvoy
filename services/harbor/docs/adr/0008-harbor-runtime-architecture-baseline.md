# 0008. Harbor Runtime 架构基线

## 状态

Accepted for Milestone #7 docs-only baseline, 2026-07-01。

## 覆盖范围

本 ADR 覆盖 GitHub milestone `Harbor Runtime 架构基线`：

- FR #70：确定 Runtime API、Provider 与 Session 技术基线。
- Work Items #71、#72、#73、#74。
- FR #75：确定 Snapshot、Evidence 与 Viewer 技术基线。
- Work Items #76、#77、#78、#79。

本 ADR 不实现 runtime、provider、viewer、evidence store、API schema、database schema、browser binary 或 package scaffold。

## 技术默认

| 领域 | 默认 | 边界 |
|---|---|---|
| 主语言 | TypeScript / Node.js | Rust / Go 只在进程守护、沙箱、本地加密、低层代理或同等系统边界经后续 ADR 引入。 |
| Browser automation | Playwright primitives + CDP | Playwright 是 Harbor 内部 provider/backend baseline，不把 Playwright Test、locator 或 provider-native flags 暴露成 Harbor 公共模型。 |
| Browser channel | CDP controlled by Harbor | CDP URL、VNC URL、WebSocket endpoint 和 provider secret 不进入 Core/Lode/App 公共合同。 |
| Local facts store | SQLite metadata / refs | SQLite 默认只存 ref、metadata、status、policy 和 provenance；不存 credential、cookie、完整 profile storage、raw payload 或完整 production page material。 |
| Artifact locator | Filesystem refs | Filesystem 只承载 policy-allowed artifact locator；artifact 是否可读由 evidence policy、redaction、retention 和 access state 决定。 |
| Evidence default | Minimal refs and summaries | Snapshot/refmap/source_trace 默认允许；screenshot、console/network summary、diagnostic 由 policy 开启；trace/HAR/video/raw_payload 默认关闭。 |

## 模块边界

| 模块 | Harbor owner | Consumers | 公共 facts | Forbidden public fields |
|---|---|---|---|---|
| Runtime API | Harbor Runtime API | Core、App、Agent/CLI | refs、status、availability、failure class、policy state | Core Run Record、Lode schema、App UI state、site business result |
| Runtime Session | Session Manager | Core、App | `runtime_session_ref`、provider/profile/identity refs、lifecycle、lease、continuity、viewer/CDP/evidence availability、current error | raw CDP/VNC endpoint、provider native session id、cookie、token、profile path |
| Execution Identity | Identity Manager | Core admission、App Browser、Lode requirements | `execution_identity_ref`、site/account/profile binding、login state source、allowed channels、risk/recovery events、evidence policy ref | credential payload、2FA secret、account health score、task success guarantee |
| Provider facts | Provider Registry / Browser Driver | Core matching、App health、Lode requirements | provider type、engine、mode、capabilities、known limits、license/binary metadata refs、validation evidence refs | provider ranking、target-site pass rate、anti-detection guarantee、provider-specific launch flags |
| Profile facts | Profile Manager | Core、App、Lode requirements | `profile_ref`、ownership、storage class、proxy/env/browser facts、running/invalid state | cookies、tokens、history、full storage、private user data dir |
| Snapshot / RefMap | Snapshot / RefMap Capture | Core action context、App debug/evidence、Lode authoring | `snapshot_ref`、`refmap_ref`、generation, source binding, expiry, failure class | full DOM as public schema、business locator、normalized result |
| Evidence refs | Evidence Store | Core Run Record refs、App evidence view | `evidence_ref`、source_trace、redaction、retention、storage/access state | raw HAR、raw DOM、full screenshots/video、request/response bodies by default |
| Viewer / handoff | Runtime Session / Viewer adapter | App Browser/Viewer、Core refs | `viewer_ref`、viewer access, input capability, `control_owner`, handoff/takeover reason | raw endpoint exposure、App-owned runtime truth、automatic control steal from user |

`observed_facts` and `provider_claims` are separate. Core may use observed/configured/validated facts for resource matching. Provider claims stay evaluation input until Harbor-controlled validation evidence exists.

Runtime facts do not promise task success. Harbor reports runtime availability, source binding, policy denial, stale refs, control ownership and failure classes. Core owns admission, run outcome, unknown outcome and reconciliation.

## Storage boundary

SQLite may store:

- provider/profile/identity/session/evidence refs;
- lifecycle/status/error classifications;
- evidence policy, redaction, retention and access metadata;
- source_trace and provenance metadata;
- validation evidence locator metadata.

SQLite must not store by default:

- credential、cookie、token、2FA secret、recovery code;
- full user profile storage, browser history, local/session storage, IndexedDB or private profile files;
- raw DOM, raw HAR, raw request/response bodies, unredacted screenshot/video/trace, production payload or user business data.

Filesystem refs may point to local artifacts only when policy allows capture and retention. Public contracts expose locator, type, redaction status, access state and expiration, not the artifact body.

## Page scene refs

| Ref | Default source | Public states | Consumer rule |
|---|---|---|---|
| `snapshot_ref` | AX-first page observation; DOM/simplified HTML fallback; semantic text derived | `available`、`missing`、`stale`、`expired`、`redacted`、`access_denied` | Core may request fresh snapshot; it must not treat snapshot as business result. |
| `refmap_ref` | Element refs bound to snapshot/page/frame/navigation generation | `available`、`missing`、`stale`、`expired`、`redacted`、`access_denied`、`selector_unstable` | Core must resnapshot or enter human/authoring path on stale/unstable refs. |
| `source_trace` | provider/profile/session/page/frame/capture method/time | `available`、`missing`、`stale`、`redacted`、`access_denied` | Missing source is runtime/evidence blocker, not task business failure. |
| `evidence_ref` | policy-allowed snapshot/refmap/source_trace plus optional screenshot/console/network/diagnostic | `available`、`missing`、`expired`、`redacted`、`access_denied` | Core stores refs; App displays allowed summaries; Lode does not use evidence as output schema. |

## Viewer, handoff and control

- `viewer_ref` is mediated by Harbor. Raw CDP/VNC/ws endpoints are implementation details unless Harbor exposes a policy-gated capability ref.
- `control_owner` is a Harbor runtime fact with values such as `agent`、`user`、`app`、`provider`、`none`、`unknown`.
- Handoff/takeover reasons are facts, not App local state: `login_required`、`captcha_required`、`policy_requires_user`、`user_requested`、`automation_blocked`、`viewer_only`、`control_lost`、`provider_limit`、`unknown_outcome_risk`.
- App may request takeover/resume/stop through owning APIs and render viewer/evidence refs. App must not own Runtime Session truth.
- Core owns run pause/resume/retry/outcome. If user action changes task state and Core cannot verify it, Core records unknown outcome rather than Harbor declaring success.

## Smoke test minimum

When Harbor later adds runtime/provider/session/evidence/viewer code, the minimum smoke must prove:

- provider launch or connect reaches a readable readiness state;
- Runtime Session facts can be read back: `runtime_session_ref`, provider/profile/identity refs when present, lifecycle, availability and current error;
- Provider facts separate configured values, observed facts, provider claims and validation evidence;
- Snapshot/RefMap/Evidence refs can be produced or return structured unavailable states;
- viewer/handoff/control ownership facts are readable when viewer or handoff code changes;
- no default smoke uses real accounts, credentials, production payloads, raw cookies/storage, unredacted screenshots, raw HAR, raw DOM or video.

Docs-only PRs may mark suite/runtime smoke not applicable only when they change documentation and item-specific Loom carriers. Runtime smoke becomes required when a PR adds or changes provider/session/evidence/viewer code, API/schema, storage schema, browser binary/install behavior, fixtures or generated facts.

## 研究吸收 / 裁剪 / 拒绝

| Locator | 判断 | 落点 |
|---|---|---|
| `.github/ROADMAP.md` | 吸收 | Harbor provides Profile、Execution Identity、Runtime Session、Provider facts、Snapshot、RefMap、Evidence refs and Viewer/handoff facts; Harbor does not own Core Run Record or task success. |
| `Harbor/ROADMAP.md` | 吸收 | Stage 2/3 projection requires minimal runtime facts, session refs, snapshot/evidence refs and viewer refs before implementation. |
| `Harbor/AGENTS.md` | 吸收 | TypeScript/Node, Playwright/CDP and SQLite are defaults; docs-only changes must not create package/runtime/provider skeletons. |
| `docs/adr/0002-profile-session-and-provider-facts.md` | 吸收 | Provider facts, profile/session/identity facts, observed/configured/claim/evidence separation and provider-specific field exclusion. |
| `docs/adr/0003-local-chrome-vs-remote-browser-boundary.md` | 裁剪复用 | Dedicated local profile, local user Chrome and remote browser are provider modes; raw CDP/VNC remains Harbor-controlled. Exact first provider order remains deferred. |
| `docs/adr/0004-snapshot-refmap-and-evidence-capture.md` | 吸收 | Snapshot/RefMap/Evidence refs belong to Harbor, but Core owns Run Record and Lode owns site output schema. |
| `docs/adr/0005-runtime-session-lifecycle-v0.md` | 吸收 | Session ref, lifecycle, lease, continuity, unavailable classes and availability facts are the session baseline. |
| `docs/adr/0006-provider-profile-identity-facts-v0.md` | 吸收 | Provider/profile/identity facts v0 and sensitive data exclusions are implementation preconditions. |
| `docs/adr/0007-page-scene-reference-facts-v0.md` | 吸收 | Snapshot/refmap/source_trace/evidence/viewer/control facts v0 are the page-scene baseline. |
| `docs/adr/pending-decisions.md` | 裁剪复用 | Existing PDs keep schema, provider enablement, retention/encryption and detailed handoff state machine deferred; none require docs-only implementation now. |
| `docs/contracts/README.md` | 吸收 | Contract index remains the implementation entry point and now links this baseline. |
| `docs/draft/browser-drivers.md` | 吸收 | Browser Driver is adapter boundary: launch/connect/configure/health/facts, not task runner or provider-specific public schema. |
| `research/absorability/themes/browser-identity-and-runtime.md` | 裁剪复用 | Absorb persistent Profile, runtime session, provider mode, Playwright/CDP and SQLite reference patterns; reject direct external Profile schemas, user daily Chrome by default, Playwright source copying and provider success claims. |
| `research/absorability/themes/evidence-and-observability.md` | 裁剪复用 | Absorb evidence refs, redaction, retention, network/console/trace policy and SQLite/local store references; reject ring buffers as Evidence Store and default full screenshots/HAR/trace/video/raw bodies. |
| `research/absorability/themes/human-handoff-and-recovery.md` | 裁剪复用 | Absorb mediated viewer ref, control owner, handoff/takeover reason and user-controlled hard-stop semantics; reject live viewer as full recovery and raw endpoint exposure. |
| `App/docs/adr/0002-run-viewer-and-handoff-surface.md` | 吸收 | App run viewer is a composed UI surface; Harbor owns Runtime Session/viewer facts, Core owns run recovery, App displays facts and sends intent. |

## Rejected or deferred

> 2026-07-14 correction: [ADR 0009](0009-provider-lifecycle-management.md) supersedes
> this baseline's rejection of browser binary/dependency installation for Harbor-managed
> providers. Other rejected and deferred boundaries below remain historical baseline truth.

- Rejected for this baseline: runtime code skeleton, provider adapter, `package.json`, database schema, evidence store implementation, viewer implementation, raw CDP/VNC endpoint public model, task runner loop and task success guarantee. Managed browser binary/dependency install is now governed by ADR 0009.
- Rejected by default: credential vault, hosted browser platform, provider marketplace, full desktop console, user daily Chrome auto-use, raw production evidence persistence and anti-detection success commitment.
- Deferred: API/OpenAPI/schema, provider evaluation packet, concrete smoke command names, SQLite schema, encryption-at-rest, retention TTL, first provider order, full handoff state machine and complete App viewer workflow.
