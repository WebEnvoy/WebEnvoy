# Profile Transfer V1 (Candidate)

**Status:** Candidate implementation contract for [#604](https://github.com/WebEnvoy/WebEnvoy/issues/604). This file describes the bounded bookmark-import and migration-intent slice; it does not claim installed Plugin verification, general Profile portability, or cross-Provider migration support.

## Ownership and authorization

- Harbor owns source registration, canonical path, source fingerprint, expiry, revoke state, source locking, Places reads, target bookmark writes and the durable import receipt. Only the trusted owner CLI forwards a local `source_path` to Harbor's owner route. Core, an Agent, the Plugin and operation results receive only an opaque `source_ref`.
- Registering a source does not grant access to import it. Core Grant state and task scope each carry exact `profile_source_refs`; legacy Grants without this field have an empty source scope. `profile.import` also requires the Grant's existing fixed creation template and origin. Source registration, target creation, and browser use remain separate owner and Core decisions.
- Core owns the `profile.import` Run, idempotency, creation quota lock, original target refs and unknown-outcome reconciliation. It creates a new managed target using Harbor's ordinary qualified Profile creation route. It opens and stops the target's official Harbor profile-management session before the bookmark import. It never copies a source Provider bundle or profile directory.

## Import boundary

The initial importer accepts only a stopped Camoufox `places.sqlite` at `user_version = 86`, matching browser `152.0.4-beta.30`, and bounded by the registered source limits. Harbor holds its native external-profile read lock, fingerprints the source before reading, reads only bookmark/folder/separator rows and verifies the source fingerprint again before target commit. The target must be a managed, inactive Camoufox Profile with valid Harbor-owned official environment binding.

Harbor merges public HTTP(S) bookmarks and their folders under an `Imported bookmarks` folder on the target toolbar. URLs containing credentials, non-HTTP(S) schemes, malformed items and duplicate target bookmarks are skipped and counted. URL hashes and Places bookmark rows are written using the supported schema. The report says whether import was partial, includes imported/skipped counts, and marks `requires_login: true` and `repair_status: not_attempted`.

This import excludes history, cookies, saved logins, extensions, Provider configuration, Account bindings and Runtime Runs. It does not copy, merge or infer a logged-in session. Credentials, profile files, SQLite bytes, paths and source fingerprints never enter Core or Agent-visible results. Source handles expire after 24 hours and may be revoked by the owner.

## Run and recovery

The first dispatched import is keyed by the original Core Run idempotency key and shares the existing Grant-scoped Profile creation lock/quota with `profile.create`. A durable Harbor receipt binds the source handle, target Profile and Identity Environment, counts and partial/completed report. Same-key/same-wire returns that receipt; changed wire conflicts.

If target creation may have dispatched, query reads only the original Harbor creation and import receipts. A missing receipt preserves `unknown_outcome`; it is never interpreted as proof of no effect and never causes query to create a target, start a browser session or dispatch another import. If Harbor has recorded a target, Core records that same target against Grant quota and returns its refs with `import_status: unknown` until a matching import receipt is available and the target session is stopped. That unresolved Run blocks further creation/import quota use for the Grant. A durable import receipt is not enough to complete reconciliation while the original target session remains active.

## Migration request

`profile.migrate.request` is a contextual qualification query. It names one existing Profile, one owner-approved desired target Provider/template, and reads Harbor's current source and target Provider/version facts. The operation returns `not_required` only when source and target Provider/version facts match. Otherwise it returns a terminal qualification refusal with the concrete current reason. The current slice starts no queue, target, browser session, data transfer or fallback Provider. A same-Provider bookmark import is a copy into a new Profile and must not be described as migration.

## Design obligations

- `DO-GRANT-WIRE = triggered`: exact `profile_source_refs` Grant/task scope is distinct from skill `source_refs`; old Grants deny import by default. The durable Grant schema is extended additively and existing scope semantics are preserved.
- `DO-PLUGIN-EXPOSURE = triggered`: `profile.import` and `profile.migrate.request` are formal managed operations with fixed input projection, authorization, result and query behavior in the existing operation catalog and installed Browser SKILL.
- `DO-APP-IA = not-triggered`: source management is a narrow trusted owner CLI surface; no Desktop workbench or App product direction changes.
- `DO-PROVIDER-PRIVATE-SCHEMA = not-triggered`: target initialization and official Provider bundle remain owned by the existing Harbor qualified creation/session path; the importer does not persist or reinterpret Provider-private configuration.

The public receipt is specified in [`profile-import-receipt.schema.json`](../../packages/schemas/schemas/profile-import-receipt.schema.json). The receipt carries no source path or Profile material. Synthetic browser-database fixtures prove supported Places row handling; they do not claim the bookmark was created through the browser's UI or verify installed Agent consumption.
