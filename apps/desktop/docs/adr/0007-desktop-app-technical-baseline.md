# 0007. Desktop App Technical Baseline

## Status

Accepted for milestone #8 docs-only baseline, 2026-07-01.

## Context

Milestone #8 freezes the App product shape and near-term UI technology baseline
before any Electron, Vite, React, or component skeleton exists. This ADR covers
FR #74 and #79 plus Work Items #75, #76, #77, #78, #80, #81, #82, and #83.

The prior accepted App contracts still apply:

- [ADR 0005](0005-library-capability-catalog-fields.md) owns Library catalog
  display and local-only catalog cache boundaries.
- [ADR 0006](0006-stage2-task-entry-and-display-contract.md) owns task entry,
  run/result/evidence/action request, Browser runtime, viewer, handoff, Settings,
  and local-only cache display boundaries.

This ADR does not create UI, an app shell, client code, package manifests,
schemas, fixtures, generated types, or dependencies.

## Decision

App is Desktop App first.

Development may use a localhost Web UI and browser-based Vite development
server, but product IA, navigation, state language, and implementation reviews
must treat the final user surface as a desktop application. The production
desktop shell default is Electron. The UI defaults are React, TypeScript, Vite,
Radix UI primitives, and `lucide-react` icons.

The desktop architecture is a cross-platform shell with minimal native
integration. Electron, React, and Radix own the primary product experience.
The native layer only wraps OS boundary capabilities such as processes, files,
notifications, windows, keychain access, and profile paths; it must not own or
implement task, run, result, capability, evidence, or recovery protocols.

### Product Shape and Shell Boundary

| Area | Accepted baseline | Deferred | Rejected |
| --- | --- | --- | --- |
| Product shape | Desktop App first. Design information architecture, viewer priority, local connection states, and settings as a desktop product. | Hosted/team Console, cloud sync, and remote-only product surfaces. | Treating a localhost admin page as the final product shape. |
| Shell architecture | Cross-platform shell plus minimal native integration. Electron/React/Radix carry the product surface; native code wraps only OS boundaries. | Exact IPC shape and native wrapper module layout until skeleton work. | Putting task/run/result/capability/evidence/recovery business protocols in the native layer. |
| Development carrier | Local Web UI is allowed for development and review because the UI stack is web-based. | Exact dev server commands and package scripts until the skeleton Work Item. | Letting dev-server routing define product IA. |
| Production shell | Electron is the default desktop shell for the first implementation. | Updater, installer, tray, file associations, deep links, OS permission prompts, signing, auto-start, and packaging policy. | Initializing Electron in this docs-only PR. |
| Runtime ownership | Electron/App can display and send user intent to owner APIs. | Explicit local service supervisor Work Item. | Starting, supervising, restarting, or bypassing Core, Harbor, or Lode services from this baseline. |
| Runtime API boundary | Shell uses the same Core, Harbor, and Lode owner APIs as other App carriers. | Shell-specific IPC/API shape. | Electron main process becoming Core runtime, Harbor runtime, or Lode asset truth. |

### UI Technology Defaults

| Choice | Baseline | Reason | Deferred or rejected boundary |
| --- | --- | --- | --- |
| Desktop shell | Electron | Mature desktop shell for a web UI and compatible with the existing TypeScript/Node direction. | Tauri/Rust is deferred until there is a measured binary, security, or platform need that outweighs owning Rust shell code. |
| UI framework | React | Default UI framework for later App surfaces and existing external viewer references. | Other frameworks require a new ADR before skeleton work. |
| Language | TypeScript | Keep App-facing contracts and UI state typed without inventing schemas in App. | Generated API/schema types must come from owner contracts, not App-local rewrites. |
| Build/dev tool | Vite | Small default for local web development and Electron renderer later. | Next.js is rejected for the first skeleton because App is not a routed marketing/content web product. |
| Components | Radix UI primitives | Accessible primitives without committing to a heavy design system. | Heavy design systems are deferred until repeated product surfaces need them. |
| Icons | `lucide-react` | Consistent React icon default for buttons, navigation, and state markers. | Bespoke icon sets or manual SVG systems are rejected unless a later brand/UI ADR requires them. |

Do not install these dependencies or create package files in docs-only PRs.
The first code skeleton Work Item must recheck this ADR, then add only the
minimum package manifest and scripts needed for that slice.

### Desktop IA Baseline

The first desktop information architecture uses a persistent left navigation:

| Navigation item | Primary source | First baseline responsibility | Early priority |
| --- | --- | --- | --- |
| Work | Core via WebEnvoy API Server | Task intent, run status, result/failure, evidence refs, recovery/action requests. | Show source-specific connection and stale states before adding dense workflow controls. |
| Library | Lode | Capability/package/catalog metadata, version/lifecycle/invalidation display, local-only Library preferences. | Can be a constrained catalog placeholder until Lode facts and UI design are ready. |
| Browser | Harbor | Profile refs, Runtime Session refs, viewer/takeover availability, provider facts, control owner, runtime health. | Highest early UI priority with connection/runtime state because it explains whether a run can be observed or recovered. |
| Settings | App local settings plus owner API health | Endpoint choices, source locators, recent views, layout/filter preferences, and diagnostics summaries. | Must keep configuration and health separate from upstream truth. |

This IA is an input to the next UI product design checkpoint, not a final visual
design. Browser/live state and connection state must be visible early enough
that users can distinguish task failure, runtime unavailable, catalog
unavailable, and local configuration problems.

### UI Product Design Checkpoint

Before any PR treats UI direction as final, the selected UI Work Item must carry
these inputs:

| Input | Required content |
| --- | --- |
| Low-fidelity IA | Work, Library, Browser, Settings navigation and the default first screen. |
| State matrix | Loading, empty, stale, unavailable, redacted, expired, permission denied, user action required, and unknown outcome. |
| Runtime priority | Where Browser viewer/session/control/connection state appears relative to Work run state. |
| Local data boundary | Which state is App-local preference/cache and which state must be fetched from Core/Harbor/Lode. |
| User confirmation point | Product owner/user confirmation that the IA/state model is acceptable before component skeletons claim final direction. |

### Client and Connection State Boundary

| Client/source | App may use it for | App must not use it for | Required connection display |
| --- | --- | --- | --- |
| Core client | Task intent, admission/run/result/failure/evidence/recovery/action request facts. | Writing Run Record truth, redefining result envelopes, or executing capabilities. | Source, endpoint, fetched_at, stale/unavailable reason, and owner error when available. |
| Harbor client | Profile, Runtime Session, viewer, provider facts, control owner, handoff/takeover availability, and runtime health. | Managing browser processes, reading cookies/profile storage, exposing raw CDP/VNC endpoints as product truth, or deciding task success. | Source, session/ref freshness, lease/expiry when supplied, stale/unavailable/runtime lost reason. |
| Lode client/source | Capability/package/catalog metadata, lifecycle, version, resource requirements, fixtures/post-check summaries, and invalidation markers. | Owning package schema, package bodies, fixtures, registry truth, normalizers, or runtime matching. | Source locator, fetched_at, catalog snapshot freshness, stale/unavailable/invalid contract marker. |
| App local state | Endpoint choice, recent views, filters, layout preferences, non-sensitive display cache, and UI loading state. | Credentials, cookies, profile storage, runtime truth, Run Record truth, raw evidence, package body, fixture body, or Lode asset truth. | Local-only marker, source pointer, fetched_at for cached facts, stale/unknown/redacted markers. |

Connection health is source freshness, not task outcome. App must not collapse
Core unavailable, Harbor runtime unavailable, Lode catalog unavailable, and
local misconfiguration into one generic failure.

### Local State and Cache Boundary

| Local object | Allowed? | Boundary |
| --- | --- | --- |
| Endpoint choices for Core/Harbor/Lode | Yes | User-editable local configuration only. |
| Recent views, selected nav item, filters, sort, layout preferences | Yes | Non-sensitive UI preference. |
| Non-sensitive display cache | Yes | Rebuildable; must carry owner source, fetched_at, and stale/unknown/redacted/unavailable markers. |
| Pending UI intent before owner confirmation | Yes | Not truth until owner API returns a fact. |
| Credentials, cookies, tokens, browser profile storage, account payloads | No | Must remain outside App local cache/settings. |
| Core Run Records, Harbor runtime/session truth, Lode package/fixture bodies | No | App may show owner refs or summaries only. |
| Raw screenshots, HAR, trace, video, DOM, network body, downloads, raw evidence | No by default | Only policy-allowed refs/thumbnails/summaries; no App evidence store in this baseline. |

## Research Absorption Boundary

| Input locator | Absorbed | Trimmed | Reference only | Rejected or deferred |
| --- | --- | --- | --- | --- |
| `/Volumes/2T/dev/WebEnvoy/research/synthesis.md` | Runtime facts vs task policy split; Run Record/evidence shared boundary; source reuse layering. | App keeps only Desktop display/intent consequences. | Product-stage owner decisions remain in Core/Harbor/Lode. | Hosted browser/vault/persona platform, external UI shell migration, generic browser agent loop. |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/human-handoff-and-recovery.md` | Viewer entry, control owner, handoff/takeover, and user-visible recovery are real App inputs. | This ADR keeps only IA/state requirements; no viewer implementation. | VNC/noVNC, dashboard, and local browser window examples can inform future UI design. | Treating live viewer as complete recovery, exposing raw CDP/VNC endpoints, or auto-taking back user control. |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/browser-identity-and-runtime.md` | Profile, Runtime Session, provider, and viewer facts belong to Harbor and must be displayed as refs/facts. | App only stores local preferences/cache, not identity/runtime truth. | Profile Browser products can inform future Browser surface design. | Storing profile data/cookies in App, defaulting to user daily Chrome, or using BrowserOS/CloakBrowser-Manager as App base. |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/api-cli-mcp-and-agent-interface.md` | Small deterministic interfaces, typed diagnostics, and reference-over-value outputs. | This ADR applies the principle to App connection states and display refs only. | CLI/MCP transport design can inform later multi-entry consistency. | Low-level CDP/eval/DevTools/Profile APIs as App task interface. |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/evidence-and-observability.md` | Evidence refs, redacted/expired/unavailable states, and raw-artifact privacy boundaries. | App may display summaries, refs, and policy-allowed thumbnails only. | Larger artifact taxonomy can inform later Evidence UI. | Default raw screenshot/HAR/trace/video/network body/prompt/agent history storage. |
| `/Volumes/2T/dev/WebEnvoy/sources/CloakHQ/CloakBrowser-Manager` and `/Volumes/2T/dev/WebEnvoy/sources/browseros-ai/BrowserOS` | Mechanism evidence for viewer/profile/runtime and agent activity exists. | No source migration in App. | Future Harbor/App Work Items may inspect small mechanisms with license/boundary review. | Migrating backend/frontend/UI shell, Chromium fork, provider lifecycle, or hosted platform behavior into this App baseline. |

## Covered Issues

| Issue | Coverage |
| --- | --- |
| #74 | Desktop App first and UI technology baseline. |
| #75 | Product shape, dev Web UI boundary, and deferred shell packaging. |
| #76 | Electron, React, TypeScript, Vite, Radix UI, and `lucide-react` defaults; Tauri/Rust, Next.js, and heavy design system boundaries. |
| #77 | Development Web UI vs production Desktop shell boundary; no local service supervisor. |
| #78 | Agent constraints are reflected in `AGENTS.md`. |
| #79 | Desktop IA, connection state, client boundary, and local cache baseline. |
| #80 | Work/Library/Browser/Settings IA and UI product design checkpoint inputs. |
| #81 | Core/Harbor/Lode client boundary and source/fetched_at/stale/unavailable connection state rules. |
| #82 | Local state/cache allowed list and sensitive data no-store list. |
| #83 | `docs/contracts/README.md` and `docs/README.md` index this ADR for later UI skeleton work. |

## Consequences

- Later UI skeleton work has a clear default stack but must still create the
  actual project files in its own Work Item.
- Desktop product decisions are no longer hidden behind the older "local Web UI
  or Desktop shell" wording.
- App connection and cache behavior remains useful for UX without becoming a
  second Core, Harbor, or Lode truth source.

## Non-Goals

- No Electron, Vite, React, package manager, component, route, client, storage,
  schema, fixture, generated type, API implementation, or UI code.
- No Core, Harbor, Lode, research, or sources repository changes.
- No PR merge and no issue closeout.

## Deferred Decisions

- Exact Electron process model, IPC boundary, updater/installer/tray/deep link,
  OS permission prompts, signing, package scripts, and dev server commands.
- Final visual design, component hierarchy, accessibility implementation,
  keyboard shortcuts, responsive behavior, and screenshot/interaction tests.
- Concrete API client package layout and generated type ingestion.
- Viewer implementation, local evidence viewer, service supervision, sync,
  hosted/team Console, marketplace, and cloud settings.
