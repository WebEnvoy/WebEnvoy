# Human Workbench Current Inventory

## Scope

This inventory records the App surface on `main` at `2d7f8c61` as input to App
#298. It classifies existing content without changing production UI or treating
fixtures as owner truth.

Classification vocabulary: keep, rename, move, collapse by default, diagnostics
only, remove from the default product path. The user confirmed the Story Gate on
2026-07-15; the dispositions are consumed by
`docs/design/human-workbench-information-architecture.md`. Final page composition
still depends on the separate high-fidelity prototype Gate.

## Surface Inventory

| Surface | Current content | Candidate disposition | User scenario and primary action |
| --- | --- | --- | --- |
| Global navigation | Task Thread, Library, account identity and Settings entry points; no stable Work or Browser labels | Rename and reorganize | Reach Work, Browser, Library or Settings without knowing repository boundaries |
| Work task list | Tasks grouped by identity and skill, currently limited to milestone fixtures | Keep the object list; remove fixture-only availability from the default path | Find an App or external-entry task and open its current business state |
| Work task page | Task title, run status, runtime gates, submit intent, report, process and refs | Move business input/result/failure/next action first; collapse runtime and submit internals | Read a result or resolve the next business action |
| Work result report | Content, collections, field sources, write-precheck and outcome variants exist in fixtures | Keep and promote; generalize by public result type | Consume content, records, media, metrics, account data or write-operation status |
| Work process and runtime gates | Core read, supervisor, submit, owner intent, health and admission blocks | Collapse by default; diagnostics only for endpoints and raw facts | Understand meaningful progress or troubleshoot after opening details |
| Work task controls | Chat-like textarea, attachment, voice and send controls | Remove from the default task path unless a validated journey requires each control | Start or retry a bounded skill with explicit business fields |
| Browser connection preface | Data-boundary copy, Harbor endpoint and connection facts precede identities | Move to Settings/diagnostics; retain only actionable availability | Resolve a connection problem without reading owner architecture |
| Browser identity list | Three identity fixtures plus live Harbor projection | Keep; make account identity the primary organizing object | Choose an account, see whether it can be used, then open or repair it |
| Browser identity detail | Site binding, provider, environment, fingerprint and sensitive-material status | Keep business-relevant summaries; move paths, raw facts and policy prose to diagnostics | Understand which account/environment will be used and what action is available |
| Browser instance controls | Open target, login recovery, viewer, takeover, release and stop | Keep and regroup around instance lifecycle | Start, observe, take over, release or stop an instance |
| Browser manual session facts | Controller, URL, title, session/viewer refs | Keep URL/title/controller when actionable; refs are diagnostics only | Distinguish manual browsing from an automated task without reading internal identifiers |
| Library catalog | Search, category, ten skill fixtures and readiness projection | Keep; rename technical readiness to user availability | Find a skill by business purpose and open its details |
| Library detail | Description, versions, inputs, tests, repair drafts, Lode refs and install/update controls | Keep purpose/input/output/version/use; move tests, refs and repair internals to maintainer details; remove inert actions | Decide whether a skill fits, choose a compatible account and create a task |
| Settings | Endpoint choice, appearance, data boundary and runtime diagnostics | Keep outside the three business domains | Change preferences or authorization defaults; diagnose connections when requested |
| Evidence/source fields | Source, stale marker, fetched time, refs and raw provenance | Keep source summary; collapse refs and raw provenance into details/diagnostics | Verify where a result came from without obscuring the result itself |
| Fixtures | Task, skill and identity samples mixed into default unavailable-runtime states | Prototype/test namespace only; remove from production availability truth | Exercise deterministic UI states without claiming live capability |
| BOSS task commands | Search, detail and write-precheck entries remain represented in fixtures/UI | Remove or disable from the current production task path; retain explicit deferred state | Avoid entering a task path that cannot currently be validated |

## Object Ownership

| Product object | Human-facing domain | Owner truth | App responsibility |
| --- | --- | --- | --- |
| Task, Run, Result and authorization decision | Work | Core | Create intent, render business state, show recovery choices and observe all entry points |
| Account identity, provider, environment and browser instance | Browser | Harbor | Send lifecycle intent and render actionable public state |
| Site skill, version, input/output and action requirements | Library | Lode | Support discovery, understanding, compatible-account selection and task entry |
| Preferences, authorization defaults, connection and diagnostics | Settings | Core/Harbor/Lode plus local non-sensitive preferences | Configure user choices and reveal diagnostics on demand |

## Current Gaps

- Work, Browser and Library do not yet share stable domain navigation and return paths.
- Business results appear after multiple runtime and owner-status blocks.
- Browser starts with architecture and connection explanations instead of account work.
- Library mixes business discovery with package, test and repair-maintainer details.
- New task, search and several lifecycle controls are disabled or inert while fixtures still make the product look populated.
- Navigation is in-memory only and has incomplete history/deep-link behavior.
- Chinese business copy is mixed with `fixture`, endpoint, Core/Harbor/Lode and other implementation terms.

## Reusable Inputs For The Prototype

- Reuse the existing Electron/React renderer, `AppShell`, theme/density tokens,
  list rows, status glyphs, tabs, focus behavior and window resizing.
- Reuse deterministic task, identity and skill fixtures only under an explicit
  prototype/sample label.
- Reuse existing result variants to compare content, collection, failure,
  empty, unknown and write-operation states.
- Do not inherit the current fixed Task Thread shell, right-side evidence tabs,
  chat-like composer or technical status blocks without scenario validation.
- Do not add a router, component library or dependency solely for the prototype.

## Inventory Conclusion

The codebase already contains enough desktop primitives and sample states for a
high-fidelity prototype. The required work is to change information priority
and journeys, not to create another shell or design system.
