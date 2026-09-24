import type { FileAccountSystemDefinitionStore } from "./account-system-definition.js";
import type { FileManagedAccessStore } from "./managed-access.js";
import { ManagedAccessError } from "./managed-access.js";

export const managedAccountSystemReadSchemaVersion = "webenvoy.account-system-agent-projection.v1" as const;
export const managedAccountSystemReadOperation = "account_system.read" as const;

export type ManagedAccountSystemReadRequest = {
  connection_id: string;
  grant_id: string;
  template_ref: string;
};

export type ManagedAccountSystemAgentProjection = {
  schema_version: typeof managedAccountSystemReadSchemaVersion;
  local_definition_ref: string;
  local_revision_ref: string;
  template_ref: string;
  template_sha256: string;
  source: {
    publisher: string;
    repository: string;
    path: string;
    version: string;
  };
  site: {
    account_system_id: string;
    version: string;
    display_name: string;
    related_domains: string[];
    products: string[];
    login_entry: { label: string; url: string };
    admin_entry_points: Array<{ label: string; url: string }>;
  };
  identity_state: "unknown";
  evaluation_state: "not_evaluated";
};

const fail = (code: string): never => { throw new ManagedAccessError(code); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_account_system_invalid_input");
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 512 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail("managed_account_system_invalid_input");
  return value;
};

function parseRequest(value: unknown): ManagedAccountSystemReadRequest {
  const input = object(value);
  if (Object.keys(input).length !== 3 || !["connection_id", "grant_id", "template_ref"].every(key => Object.hasOwn(input, key))) return fail("managed_account_system_invalid_input");
  const request = { connection_id: string(input.connection_id), grant_id: string(input.grant_id), template_ref: string(input.template_ref) };
  if (!/^lode:\/\/account-system\/[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+$/.test(request.template_ref)) return fail("managed_account_system_invalid_input");
  return request;
}

function projectLocalDefinition(value: unknown, requestedTemplateRef: string): ManagedAccountSystemAgentProjection {
  const resolved = object(value);
  const definition = object(resolved.definition);
  const source = object(definition.source);
  const entry = (value: unknown) => {
    const item = object(value);
    return { label: string(item.label), url: string(item.url) };
  };
  if (resolved.template_ref !== requestedTemplateRef || definition.template_ref !== requestedTemplateRef || resolved.historical === true) {
    return fail("account_system_definition_unavailable");
  }
  const domains = definition.related_domains;
  const products = definition.products;
  const entries = definition.admin_entry_points;
  if (!Array.isArray(domains) || !Array.isArray(products) || !Array.isArray(entries)) return fail("account_system_definition_unavailable");
  const revisionRef = string(resolved.revision_ref);
  return {
    schema_version: managedAccountSystemReadSchemaVersion,
    local_definition_ref: string(resolved.local_definition_ref),
    local_revision_ref: revisionRef,
    template_ref: requestedTemplateRef,
    template_sha256: string(resolved.template_sha256),
    source: {
      publisher: string(source.publisher), repository: string(source.repository), path: string(source.path), version: string(source.version)
    },
    site: {
      account_system_id: string(definition.account_system_id),
      version: string(definition.version),
      display_name: string(definition.display_name),
      related_domains: domains.map(string),
      products: products.map(string),
      login_entry: entry(definition.login_entry),
      admin_entry_points: entries.map(entry)
    },
    identity_state: "unknown",
    evaluation_state: "not_evaluated"
  };
}

/** Agent-facing, read-only AccountSystem projection guarded by an existing skill.inspect Grant. */
export function createManagedAccountSystemReadService(options: {
  managedAccessStore: Pick<FileManagedAccessStore, "checkAccess">;
  accountSystemDefinitionService: Pick<FileAccountSystemDefinitionStore, "resolveTemplate">;
}) {
  return {
    async read(credentialHash: string, value: unknown): Promise<ManagedAccountSystemAgentProjection> {
      const request = parseRequest(value);
      await options.managedAccessStore.checkAccess(credentialHash, {
        connection_id: request.connection_id,
        grant_id: request.grant_id,
        operation: "skill.inspect",
        skill_ref: request.template_ref,
        source_ref: request.template_ref,
        task_scope: {
          operations: ["skill.inspect"],
          skill_refs: [request.template_ref],
          source_refs: [request.template_ref]
        }
      });
      const localDefinition = await options.accountSystemDefinitionService.resolveTemplate(request.template_ref);
      return projectLocalDefinition(localDefinition, request.template_ref);
    }
  };
}

export type ManagedAccountSystemReadService = ReturnType<typeof createManagedAccountSystemReadService>;
