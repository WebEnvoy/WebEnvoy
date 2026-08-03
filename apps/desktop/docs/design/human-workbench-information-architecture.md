# WebEnvoy App Human Workbench Information Architecture

## Status and Scope

This document is the canonical information architecture baseline for App #298.
It consumes the confirmed Story in `docs/stories/APP-308.md`, covers App
#300-#304, and is the frozen IA input for production UI Work Items.

On 2026-07-19, the user explicitly approved the current Story and high-fidelity
prototype. This freezes the IA and key journeys represented by this document
and prototype head `ddcd13d6cb556cfbe65a72f466d9f12992d438fc`. It does not
approve production implementation or runtime contracts; later business-semantic
or key-journey changes require an explicit revision and confirmation.

## Product Model

WebEnvoy has three human-facing business domains:

| Domain | User goal | Primary objects | Owner truth |
| --- | --- | --- | --- |
| Work | Create and observe tasks, consume results and recover interrupted work | Task, Run, Result, Result Item | Core |
| Browser | Manage account identities, browser environments and live instances | Account Identity, Environment, Provider, Instance, Login State | Harbor |
| Library | Discover, understand, manage and use site skills | Site Skill, Version, Input/Output Contract, Action Declaration | Lode |

Settings contains preferences, authorization defaults, connections and
diagnostics. It is a utility destination, not a fourth business domain.

The App renders owner facts and sends user intent. It does not create a second
source of truth for tasks, browser state, skills or authorization decisions.

## Global Navigation

The persistent primary navigation contains `Work`, `Browser` and `Library`.
Settings is available from the utility area or application menu. The default
destination is Work.

Navigation never exposes Core, Harbor or Lode as product sections. Deep links
and cross-domain transitions preserve the originating Task, Account Identity,
Site Skill and return destination where applicable.

```text
Work <-> Browser
  |        ^
  v        |
Library ---+

Settings is reached as a utility destination and returns to the prior context.
```

The App must support these natural starts without creating separate products:

```text
Account Identity -> open browser or choose a skill -> Task
Site Skill -> choose a compatible identity -> Task
App/CLI/MCP/API/SDK/Agent Task -> Work -> result or recovery
```

## Object Relationships

```text
Site Skill + Account Identity = Task Thread
Task Thread -> one or more Task Turns
Task Turn + declared business input -> one or more Runs -> Result -> optional Result Items

Account Identity -> one persistent Browser Environment
Browser Environment -> zero or one active controllable Instance
Task Turn/Run -> references an Account Identity and may temporarily control its Instance
```

- A Task Thread is the stable App projection for one Site Skill and one Account
  Identity. It does not replace Core task or run truth.
- A Task Turn is one business-input submission from App, CLI, MCP, API, SDK or
  Agent. Changing material business input creates another Turn in the matching
  Thread.
- A retry or resume with unchanged business input creates another Run under the
  same Turn.
- A manual Browser instance is not a Task, Run or Result.
- Reopening an identity with an active instance reuses that instance and offers
  view, takeover or stop. It never silently starts a competing instance against
  the same environment.
- Site and business-scenario tags are Lode metadata used for grouping and
  filtering. The App does not invent a permanent taxonomy when metadata is
  missing.

## Page Map

### Work

| Page | Purpose | Primary action | Secondary paths |
| --- | --- | --- | --- |
| Task thread list | Observe task threads from every supported entry point | Open the current business state; create a task turn | Search; switch grouping; filter by state, site or source |
| Create task | Create a bounded task turn from a skill contract | Create task turn | Choose skill; create, login or repair identity |
| Task thread detail | Consume turn results or resolve the current interruption | Open result or perform the recommended recovery | Retry; open browser; view source; expand details |
| Result item detail | Consume one record, content item, author or media object | Read or open the business object | Open source page; return to result collection |

Task Thread detail owns Turn history, result, failure, progress and Run detail.
Turn, Result, failure and Run do not become peer-level global pages.

The create-task page has no generic chat composer. After selecting a Site Skill,
it renders only the fields, controls, defaults, options and validation rules
declared by that skill. It lists only compatible Account Identities.

The Work navigator offers two projections of the same Task Threads:

```text
By Site Skill: Site Skill -> Account Identity Thread
By Identity: Account Identity -> Site Skill Thread
```

A Site Skill already carries its site ownership. The Site Skill projection does
not add a redundant outer Site level; its heading uses only the site icon and
skill name. Identity threads use an avatar plus account name without a secondary
business-input line.

Grouping and sorting are presentation preferences. They live in the task-list
heading overflow menu instead of occupying persistent sidebar width; the same
hover/focus action area also exposes new-task creation. Switching either
preference preserves the selected Thread and Turn, never duplicates task or
result facts, and remembers the last choice locally. Sorting supports priority
and recent-update order. New business input from any supported entry point is
appended as a Turn to the matching Site Skill and Account Identity Thread.

### Browser

| Page | Purpose | Primary action | Secondary paths |
| --- | --- | --- | --- |
| Account Identity list | Find and organize identities | Open identity; create or import identity | Search; filter; clear filters |
| Account Identity detail | Understand account availability and act on its environment or instance | Open/reuse browser or choose a skill | Login; repair; edit; related tasks |
| Identity configuration | Create, edit or copy an identity and environment | Validate and save | Save then login; cancel |
| Import identity | Inspect a supported source before adoption | Check and import | Resolve conflict; cancel |
| Provider/environment recovery | Resolve a focused availability problem | Execute the recommended recovery | Recheck; open external manager; return |
| Browser live surface | Let the user view or control the actual instance | View or take over | Release; stop; report completion to Task |

There is no global Instance Manager. Instance lifecycle appears in Account
Identity detail and in the live surface because the persistent identity, not a
temporary process, is the human-facing object.

The Account Identity list supports search and filters for site, group/tag,
login state, provider and recent use. Each row leads with account name, site,
availability and one primary action. Proxy, fingerprint, paths and raw provider
facts stay in detail or diagnostics.

Identity configuration first asks whether the environment needs a maintained
site login. A login-required identity asks for the target URL, opens that URL in
the newly created isolated browser and derives account avatar, nickname,
platform ID and login state only after user login and validation. A no-login
identity asks only for a local name and is compatible only with skills that do
not require login.

Provider, platform, proxy, GeoIP, region, language, timezone, screen,
hardware concurrency, GPU preset and fingerprint seed are browser-environment
settings. Only fields supported by the selected provider are shown. Recommended
presets are preferred; one-click randomization changes only a coherent device
tuple and seed, never proxy, geography or login target. Advanced settings remain
collapsed by default. Provider paths, internal ports, viewer/CDP endpoints and
raw credentials are not product configuration fields.

### Library

| Page | Purpose | Primary action | Secondary paths |
| --- | --- | --- | --- |
| Skill catalog | Find a skill by site and business purpose | Open skill | Search; site grouping; multi-tag filter |
| Skill detail | Decide whether and how to use a skill | Use | Select compatible identity; inspect availability/version |
| Maintainer detail | Diagnose, test or prepare a repair when authorized | Start a bounded maintenance action | Return to the user-facing skill detail |

The catalog groups skills by site and labels them with business-scenario tags
such as data collection, content publishing, content download and content
browsing. Site, tag and search filters compose. An empty match shows the active
filters and a clear-filter command.

`Use` opens the single Work create-task page with the skill preselected. Package
internals, tests, refs and repair drafts never displace purpose, input, expected
output, compatible identity requirements or current availability.

### Settings

Settings contains:

- user preferences and appearance;
- global authorization defaults;
- Core, Harbor and Lode connection configuration;
- application and runtime diagnostics.

Diagnostics is an explicit subsection. It is not the home page and does not
turn connection or owner status into a business result.

## Cross-Domain Journeys

### Create from Work

```text
Work task list
  -> Create task
  -> Choose Site Skill
  -> Choose compatible Account Identity
  -> Complete skill-declared business fields
  -> Review task goal and effective authorization
  -> Create
  -> Task detail
```

Missing prerequisites use recoverable branches:

- no suitable skill -> Library -> return with selected skill;
- no compatible identity -> Browser create/import -> login/validate -> return;
- provider unavailable -> provider recovery -> validate -> return;
- authorization not granted -> one-time/current-task decision or hard refusal.

### Create from Library

```text
Library catalog -> Skill detail -> Use
  -> Create task with skill preselected
  -> Compatible identity + declared business fields
  -> Task detail
```

### Create from Browser

```text
Browser identity -> Choose skill
  -> Create task with identity preselected
  -> Compatible skill + declared business fields
  -> Task detail
```

### Observe an External-Entry Task

Task Turns from CLI, MCP, API, SDK or Agent appear in the matching Site Skill +
Account Identity Thread and use the same Work detail experience. Source is a
label and source-summary fact, not a separate product area. A stable link or
notification may open the matching Thread and Turn directly.

### Human Takeover and Resume

```text
Task needs user action
  -> show business reason and affected task
  -> open associated Browser live surface
  -> user takes control
  -> user chooses "Completed, continue" or "Cannot complete"
  -> system validates page/login/resource condition
     -> valid: release user control and resume Task
     -> invalid: explain missing condition; take over again, revalidate or stop
```

Closing the browser window is not a completion signal. User completion,
validation success and task success remain three distinct facts.

### Provider Recovery

```text
Unavailable identity or task
  -> focused recovery page
  -> detect provider source and condition
  -> managed: download -> integrity check -> install/update/repair
     system: locate -> compatibility check -> recheck
     external: open provider manager -> recheck
  -> version and launch validation
  -> return to original identity or task
```

The shallow UI shows the next action. File paths, raw probes, logs and versions
that do not affect the decision remain in diagnostics. The App never presents a
system- or externally-managed provider as Harbor-managed one-click repair.

## Task Information Hierarchy

Every Task detail moves in one direction from business meaning to technical
diagnosis:

1. **Business result**: task goal, outcome, result count or write state,
   partial/unknown state, business failure and next action.
2. **Source summary**: account, skill, time, originating entry and source page.
3. **Run detail**: meaningful stages, attempts, retries and human intervention.
4. **Diagnostics**: refs, trace, endpoints, raw provider facts and internal
   errors.

Business result is the default body. Source summary may appear as a compact row.
Run detail is collapsed after completion. Diagnostics requires an explicit
action and can offer export without replacing the business result.

The default UI does not display run/session/evidence/viewer refs, endpoint,
capture method, source locator, owner explanations or raw JSON.

## Result Experiences

### Structured Data Collection

- Show total, completed, failed and skipped record counts.
- Use a field-labelled table or list with explicit empty values.
- Support opening a Result Item and its source page.
- Preserve partial completion and per-item failures instead of collapsing to a
  single success state.

### Readable Content

- Present title, author, time, body, media and relevant business fields in a
  reading layout.
- Lists open a content detail and preserve the return position.
- Deleted content and missing fields have explicit states, not blank space.

### Downloads

- Present filename, type, size, save location and per-file state.
- Successful files offer open-file and reveal-in-folder actions when valid.
- Failed files show their reason and allow targeted retry without repeating
  successful downloads.

### Publishing and Other Write Operations

- Present target site, account, content summary and operation time.
- Distinguish `not submitted`, `submitted`, `failed` and `outcome unknown`.
- A preview or validate-only result never appears as submitted.
- Unknown outcome offers reconciliation before retry to avoid duplicate writes.

### Unknown Result Schema

Use a readable generic table or key-value detail with labels supplied by the
contract when available. Raw JSON is diagnostics-only. Unknown type never means
unknown success.

## Business State and Recovery Matrix

| State | Default presentation | Primary actions |
| --- | --- | --- |
| Running | Current business phase and any usable partial result | View phase; stop |
| Partial | Completed/failed counts and affected items | Inspect failures; targeted retry |
| Success | Result body, count or confirmed write state | Consume; open source; export |
| Empty | No result plus the applied business input | Modify input; create new task |
| Failed | Business impact and recommended recovery | Retry; login; open browser; stop |
| Outcome unknown | The action may have happened but is not confirmed | Reconcile; open browser; inspect source |
| Awaiting authorization | Action, target, effect, identity and current policy source | Allow once; reject |
| Hard refused | Requested action exceeds declaration, target or validity | Modify task; no grant-expansion action |
| Needs user action | Reason, paused task and live-surface target | Open browser; cannot complete |
| User controlling | Current controller and required completion | Completed, continue; cannot complete |
| Validating | Condition being checked and progress | Wait; stop when supported |
| Validation failed | Specific unmet condition | Take over again; revalidate; stop |

Empty, partial, unknown, preview and failed states never reuse success styling or
copy. Fixture and historical data never fill a missing live result.

## Browser State and Recovery Matrix

| State domain | User-visible states | Primary recovery |
| --- | --- | --- |
| Identity availability | Checking, available, login required, verification required, repair required, unavailable, unknown | Open, login, verify or repair |
| Provider | Available, not installed, incompatible, damaged, launch failed, external action required | Install/update/repair, locate or open manager |
| Proxy/network | Not checked, checking, available, unreachable, region conflict | Edit, recheck or explicitly choose another network |
| Fingerprint | Recommended, valid custom, incompatible, unsupported | Choose preset or edit supported settings |
| Login | Confirmed, login required, human verification required, stale, unknown | Open login surface and revalidate |
| Instance | Idle, starting, running, task controlled, user controlled, stopping, crashed, locked, recovery failed | View, take over, release, stop, reconnect or repair |
| Import | Checking, importable, source in use, duplicate, incompatible, importing, failed | Resolve conflict, retry or cancel |

Login state always carries its most recent confirmation time. App or browser
restart invalidates assumptions that cannot be confirmed by Harbor/site
validation. Instance close, release and stop update both Browser and Work.

Editing, copying and deleting obey these rules:

- while an instance runs, only safe display metadata can change;
- copy defaults to non-sensitive environment settings;
- `Remove from App` and `Delete local environment data` are separate actions;
- local-data deletion requires explicit confirmation and preserves historical
  Task labels/references;
- an identity with an active instance must resolve the instance before removal
  or deletion.

## Authorization Interaction

### Task Actions

Effective configuration is selected from the most specific valid source:

```text
current action decision -> current Task Thread revision -> My Skill Default -> global default
```

### Browser Environment Operations

An environment operation associated with a Task follows that Task Thread's
effective configuration. An operation without a Task Thread uses only the
applicable global default and a current-action decision:

```text
current action decision -> global default
```

Before applying user policy, the App/Core path filters requests against the
owner-declared action, target and validity. A request outside that boundary is
hard refused and cannot be expanded from the confirmation UI.

A short confirmation surface shows action, target, external effect, account or
environment and current policy source. Runtime confirmation offers only:

- allow once;
- reject.

Task Thread revisions happen only from its Composer. My Skill Default and global
changes happen in Library and Settings respectively. One-time decisions expire
after completion, cancellation, timeout or target change and never silently
modify longer-lived configuration. The App sends intent and reads Core's
decision; it does not keep effective authorization truth locally.

## Diagnostics Boundary

Diagnostics may expose owner, endpoint, request/response status, internal IDs,
refs, trace, provider paths, raw errors and exportable logs. It is reached only
from an explicit diagnostic action in Task detail, Account Identity detail or
Settings.

Source summary is not diagnostics. It contains business-readable account,
skill, site, time, originating entry and source-page facts that help a user
understand a result.

## Story Coverage

| IA area | Confirmed GWT scenarios |
| --- | --- |
| Global domains and three natural starts | S1-S4, S12, S15, S21, S30 |
| Skill-driven task creation | S2, S3, S15, S16 |
| Business result hierarchy and diagnostics | S5, S6, S11, S17-S20 |
| Provider and environment recovery | S7, S23-S25, S27, S28 |
| Human takeover and login synchronization | S8, S26, S30 |
| Authorization | S9, S14, S20, S29 |
| Browser identity and instance lifecycle | S1, S10, S12, S21-S30 |
| Skill lifecycle | S2, S13, S15, S16 |
| Task Thread grouping and complete timeline | S31, S32 |
| Interrupted-task reconciliation | S33 |
| Optional skill result views and fallback | S34 |

All scenarios must appear in the high-fidelity prototype plan. The prototype may
combine compatible scenarios into a smaller number of coherent flows, but may
not omit negative, interrupted, unknown or narrow-window states.

## Prototype Requirements

The high-fidelity prototype must validate:

- stable Work, Browser and Library navigation plus utility Settings;
- task creation from Work, Library and Browser using skill-declared fields;
- external-entry task observation;
- structured, readable, download and write-operation result presentations;
- Account Identity creation/import, login, instance reuse and recovery;
- provider detection, managed recovery and system/external handoff;
- human takeover, completion feedback, validation and resume;
- global, skill, Task and one-time authorization behavior;
- business results without opening refs, endpoints or diagnostics;
- desktop primary size and at least one narrow-window state;
- explicit prototype/sample data labelling, with BOSS production runtime shown
  only as deferred/unavailable.

The prototype must not add a production router, component library or owner
contract. It may reuse existing renderer primitives and deterministic sample
states in an isolated prototype surface.

## Deferred and Non-Goals

- BOSS production search, job detail and write-precheck remain deferred.
- Xiaohongshu is a validation slice, not the navigation or object model.
- Team sharing, cloud synchronization, batch identity management, batch browser
  launch and hosted browsers are not part of this IA.
- The IA does not promise provider capabilities that Harbor does not expose.
- The IA does not define Core, Harbor or Lode implementation contracts.
- Production UI Work Items are created only after explicit user approval of the
  high-fidelity prototype.

## Open Contract Risks

- Lode must provide stable site grouping, business tags, compatible-identity
  requirements, declared inputs and public result types. Missing metadata is
  shown as unknown/unclassified rather than permanently invented by the App.
- Core must expose a stable Task aggregate across entry points and preserve
  partial, per-item failure and unknown-outcome semantics.
- Download locations require native existence, permission and sensitivity facts
  before the App offers open/reveal actions.
- Harbor state readback can race actual processes. Unconfirmed provider, login
  or instance state cannot be shown as available.
- Task and Browser instance controllers can conflict. Takeover, release and Task
  completion must update both domains from owner truth.
- The prototype validates consumption needs; it must not fabricate contracts to
  make sample screens appear complete.
