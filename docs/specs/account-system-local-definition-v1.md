# AccountSystem Local Definition V1

Status: Accepted implementation contract for #475; owner: WebEnvoy Core. This supplement defines the local copy and consumption boundary for Lode AccountSystem templates. It does not define identity discovery, Account/Profile binding, login-state detection, or account reads and writes. Lode owns the public template format in its AccountSystem Template V1 contract.

## Owner and source

Core owns each user-local AccountSystem definition and its current fixed revision. An owner import names an immutable `template_ref`; Core resolves only a Core-approved template pin through Lode's `registry/account-system-templates.json`, verifies the registry mapping and exact template bytes, and copies the validated public fields into Core-owned storage. A public template is never the Runtime definition. Lode updates cannot change an imported definition or its selected revision implicitly.

The local definition contains only the template's public metadata: stable `account_system_id`, display name, related domains, products, login/admin entry-point URLs, known shared-login references, optional evidence-backed `identity_method`, and source provenance. Core must not add a missing identity method, infer an identity from a login route, or store credentials, cookies, page content, selectors, executable code, Profile data, or account identity.

## Local lifecycle

Import is an explicit owner action. It creates a new `local_definition_ref`, an initial immutable `revision_ref`, and provenance containing the exact Lode `template_ref` and byte digest. Re-import of the same exact template is idempotent. Importing a later template version for an existing `account_system_id` returns a conflict; it must not overwrite local fields.

An owner edits a draft copied from an exact local base revision. Draft edits may change the local definition version, user-facing labels, related domains, products, entry points, and known shared-login references. They cannot change the stable `account_system_id`, selected `template_ref`, source version/provenance, source metadata, or a template-provided `identity_method`. The local definition version may therefore differ from the pinned source template version. Core validates the same strict shape and returns changed JSON paths plus dependency-check results before pinning. Unchanged or invalid drafts cannot be pinned.

Pinning a valid draft creates a new immutable local revision and advances a record-version CAS. It does not enable that revision. The owner explicitly enables the exact pinned revision with a second CAS. Rollback selects an existing historical revision and enables it without deleting later revisions. Disable preserves the last selected revision and makes new AccountSystem-dependent operations unavailable. A Run already created keeps the local ref, local revision, and source template pin it actually used; query and history never resolve a later revision or replay an operation.

## Runtime consumption

A task that declares `applicability.account_system_ref` names a Lode template ref. Before creating a Run or dispatching to Harbor, Core resolves exactly one enabled local definition whose selected revision has that source template ref. Missing, disabled, mismatched, or ambiguous definitions reject only the AccountSystem-dependent operation. A task without this requirement, including public reads such as GitHub Trending, does not consult the AccountSystem store and remains available when an AccountSystem definition is absent or disabled.

The admitted Run records the resolved `local_definition_ref`, `revision_ref`, `template_ref`, and template digest. The consumer may use the local public definition fields, but those fields only describe the AccountSystem; they do not establish authenticated identity, authorize navigation, or bind an Account to a Profile. Existing Core/Harbor identity and authorization checks remain independent.

An installed Agent Plugin may call `account_system.read` for a fixed `template_ref`. Core resolves the current enabled local definition and returns only its public source metadata and site fields (`account_system_id`, local version, display name, related domains, products, and entry points), together with the local definition/revision and template pins. Core enforces the existing `skill.inspect` Grant operation and requires the exact template ref in both `skill_refs` and `source_refs`; this projection adds no Grant dimension. The response fixes `identity_state` to `unknown` and `evaluation_state` to `not_evaluated`, and excludes identity methods, shared-login relationships, selectors, credentials, Profile refs, and page content. Missing/disabled local definitions or insufficient scope reject this AccountSystem read. Public tasks that do not declare `applicability.account_system_ref` are unaffected.

The packaged-consumer acceptance changes the owner-local display name to `GitHub (local)`, pins and explicitly enables that exact local revision, then reads it through the installed Plugin projection. Re-importing the unchanged packaged template must keep the local ref/revision active and preserve the local value. Owner rollback to the original template revision must make the next Agent read return `GitHub` and the original local revision ref. This demonstrates local-definition authority without requiring a login or claiming authenticated identity.

## Version and failure boundaries

Local definition revisions are immutable and content-pinned. An old revision is available for owner review and historical Run attribution; it is not executable after disable or after another revision is selected. Public template refresh requires an explicit owner merge flow that preserves local edits; that merge flow remains outside this initial import-and-edit slice.

Source or template integrity failures fail closed. A bad/missing local definition blocks only operations that declare the corresponding AccountSystem requirement. Core returns opaque local references and bounded failure codes; it never returns account identifiers, Cookie/token material, raw pages, or local filesystem paths.

## Design obligation decision for #475

- `DO-GRANT-WIRE = not-triggered`: the Agent read uses the existing `skill.inspect` operation and exact existing skill/source refs; no Grant dimension or new Grant operation is added.
- `DO-PLUGIN-EXPOSURE = triggered`: installed Agent Plugins expose the fixed `account_system.read` operation through [`managed-account-system-agent-v1`](../contracts/managed-account-system-agent-v1.md), backed by a Core-only projection service.
- `DO-APP-IA = not-triggered`: no Desktop App surface is added; the App productization freeze remains in force.
- `DO-NETWORK-CONTRACT`, `DO-CONSOLE-CONTRACT`, and `DO-PROVIDER-PRIVATE-SCHEMA = not-triggered`: this contract adds no Network/diagnostic payload or Provider configuration.

The owner API is `POST /owner/account-systems/operations`, protected by the Core supervisor credential. Request framing is defined by [`account-system-owner-operation-request.schema.json`](../../packages/schemas/schemas/account-system-owner-operation-request.schema.json). It exposes import, list, draft create/update/check, CAS pin, explicit enable/disable, rollback, and owner inspection; it does not expose credentials or inferred identity. This contract does not authorize identity binding, login, or a live account write.
