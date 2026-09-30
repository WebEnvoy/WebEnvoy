# Managed AccountSystem Agent Operations V1

Owner: WebEnvoy Core. This contract covers two Agent operations with separate authorization and execution boundaries:

- `account_system.read` remains the fixed read projection at `POST /managed-account-systems/operations`. Its request and response schemas are [`managed-account-system-agent-operation-request.schema.json`](../../packages/schemas/schemas/managed-account-system-agent-operation-request.schema.json) and [`managed-account-system-agent-operation-response.schema.json`](../../packages/schemas/schemas/managed-account-system-agent-operation-response.schema.json).
- `account_system.import_template` is exposed through the generic installed Agent `webenvoy_operation` tool and `POST /managed-browser/operations`. Its operation fields and task-scope schema come from the installed `managed-capability-definitions.json`; it does not change the fixed read-route schemas.

## Import a public template

The generic operation request carries the authenticated `connection_id`, one owner-issued `grant_id`, a new `idempotency_key`, `operation: "account_system.import_template"`, one immutable Lode `template_ref`, and `task_scope` with exactly that operation and one matching `template_refs` entry. Core requires `account_system.import_template` in the Grant's `allowed_operations`, and the exact template ref in both `account_system_scope.template_refs` and the request task scope. Old Grants without the new scope have an empty allowlist and cannot import.

Core resolves only its approved template pin and exact template bytes through the existing AccountSystem definition store. It returns the bounded public projection (`local_definition_ref`, `local_revision_ref`, source/template pin, and public AccountSystem site fields) with `identity_state: "unknown"` and `evaluation_state: "not_evaluated"`. The Agent cannot supply a path, source digest, local ref, revision, identity method, credential, or scope snapshot. Import creates no binding and does not contact Harbor.

The operation uses one durable Core Run. Repeating the same key and exact request returns the original Run; a changed request with the same key conflicts. A different key importing the same exact template follows the existing local import semantics, preserving the selected local definition and owner edits. Query with `GET /managed-browser/operations/{run_id}` reads the original Run and result; it never imports or redispatches. An unknown outcome remains unknown until reconciled and cannot be retried under a new key.

The Agent import projection does not expose owner draft editing, refresh merge, pin, enable, disable, or rollback operations. Those remain trusted owner actions on `POST /owner/account-systems/operations`.

## Read the enabled local definition

The read request remains the fixed operation `account_system.read` with the Agent connection, Grant, and pinned Lode `template_ref`. The Agent-facing Plugin input contains only the template ref; the host supplies authenticated context. Core maps it to the existing `skill.inspect` authorization check and requires the exact template ref in both `skill_refs` and `source_refs`. Caller-supplied scopes, operation names, local definition refs, paths, or revisions are rejected.

Core resolves the currently enabled local definition and returns its exact local refs, template pin/digest, public source metadata, and public site fields. It excludes identity methods, shared-login relationships, selectors, credentials, Profile refs, and page content. The response always reports unknown identity and unevaluated status. Missing or disabled local definitions and insufficient Grant scope fail closed; public tasks without an AccountSystem dependency do not call the read route.
