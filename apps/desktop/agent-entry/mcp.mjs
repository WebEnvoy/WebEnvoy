import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, sha, verifyBundle } from './bundle.mjs';
import { ensureRuntime, localRequest, readClient } from './client.mjs';
const client = await readClient(process.argv[2]);
let connection;
async function readCapabilityDefinitions() {
  return JSON.parse(await readFile(join(root, 'agent-entry/managed-capability-definitions.json'), 'utf8'));
}
const capabilityDefinitions = await readCapabilityDefinitions();
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const installedDefinitionRevision = `sha256:${createHash('sha256').update(canonical(capabilityDefinitions)).digest('hex')}`;
const capabilityDescriptionStates = {
  definition: new Set(['defined', 'unknown', 'out_of_scope']),
  exposure: new Set(['exposed', 'not_exposed']),
  provider: new Set(['supported', 'limited', 'unsupported', 'unknown', 'not_applicable', 'not_evaluated']),
  authorization: new Set(['allowed', 'denied', 'unknown', 'not_evaluated']),
  availability: new Set(['no_known_blocker', 'blocked', 'unknown', 'not_evaluated']),
  inputs: new Set(['not_provided', 'incomplete', 'invalid', 'complete'])
};
function hasKnownCapabilityDescriptionStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ok !== true) return false;
  return capabilityDescriptionStates.definition.has(value.definition?.state) &&
    capabilityDescriptionStates.exposure.has(value.invocation?.exposure) &&
    capabilityDescriptionStates.provider.has(value.provider?.state) &&
    capabilityDescriptionStates.authorization.has(value.authorization?.state) &&
    capabilityDescriptionStates.availability.has(value.availability?.state) &&
    capabilityDescriptionStates.inputs.has(value.inputs?.state);
}
const capabilityOperations = capabilityDefinitions.operations.filter(definition => definition.exposure === 'exposed');
const managedOperationIds = capabilityOperations.map(definition => definition.id);
const managedOperationSet = new Set(managedOperationIds);
const managedFileOperationIds = capabilityOperations.filter(definition => definition.file_scope).map(definition => definition.id);
const managedOriginOperationIds = capabilityOperations.filter(definition => definition.required.includes('origin')).map(definition => definition.id);
const managedOperationDescription = `Submit one authorized operation using the static WebEnvoy input definition. ${capabilityOperations.map(definition => `${definition.id}: ${definition.summary}`).join(' ')} task_scope describes this submitted operation only; submit later workflow steps separately. File upload/download accepts only opaque owner references and a fresh Page target; file_refs is allowed only for the current file.upload or file.download operation and must be omitted for every other operation. Operation-specific origin inputs are significant: ${managedOriginOperationIds.join(', ')} require the exact authorized origin as a top-level origin field; task_scope.origins cannot replace it. Preference, Profile, Page, environment and browser actions never retry; query the original Run when an outcome is unknown. This tool executes only the submitted operation; it does not describe later workflow steps.`;
const managedTaskScopeProperties = {
  operations: { type: 'array', description: 'Operations in the scope for this submitted operation; include the current operation and do not use later workflow steps to justify fields in this request.', items: { type: 'string' } },
  profile_refs: { type: 'array', items: { type: 'string' } },
  origins: { type: 'array', items: { type: 'string' } }
};
const managedTaskScopeSchema = fileScope => ({
  type: 'object',
  description: 'Authorization scope for this single submitted operation, not an entire multi-step workflow. File refs belong only to the current file operation.',
  properties: {
    ...managedTaskScopeProperties,
    ...(fileScope ? { file_refs: { type: 'array', description: fileScope === 'upload' ? 'The one current owner-registered file ref for upload; it must equal the top-level file_ref. Omit this field for every non-file operation.' : fileScope === 'download' ? 'Download carries an explicit empty array. Omit this field for every non-file operation.' : 'File operations carry only their current file refs. Omit this field for every non-file operation.', items: { type: 'string', pattern: '^attachment:runtime/[0-9a-f-]{36}$' }, ...(fileScope === 'download' ? { minItems: 0, maxItems: 0 } : fileScope === 'upload' ? { minItems: 1, maxItems: 1 } : { maxItems: 32 }) } } : {})
  },
  required: ['operations', 'profile_refs', 'origins', ...(fileScope === 'upload' || fileScope === 'download' ? ['file_refs'] : [])],
  additionalProperties: false
});
const managedOperationProperties = Object.fromEntries([
  ['idempotency_key', { type: 'string', description: 'A new idempotency key for this submitted operation.' }],
  ['grant_id', { type: 'string', description: 'The one owner-issued Grant for this submitted operation.' }],
  ['operation', { type: 'string', enum: managedOperationIds, pattern: capabilityDefinitions.operation_pattern, description: 'One exposed operation name.' }],
  ['task_scope', { ...managedTaskScopeSchema('file'), description: 'Authorization scope for this single submitted operation.' }],
  ...Object.entries(capabilityDefinitions.fields).map(([name, schema]) => [name, { ...schema }])
]);
const forbiddenFor = definition => Object.keys(capabilityDefinitions.fields).filter(field => !definition.allowed.includes(field));
const conditionThen = definition => {
  const then = {
    required: [...definition.required],
    ...(forbiddenFor(definition).length ? { not: { anyOf: forbiddenFor(definition).map(field => ({ required: [field] })) } } : {})
  };
  const conditional = (definition.conditions ?? []).filter(condition => condition.kind === 'conditional_fields' && condition.when?.field);
  if (conditional.length) then.allOf = conditional.map(condition => ({
    if: { required: [condition.when.field], properties: { [condition.when.field]: condition.when.equals !== undefined ? { const: condition.when.equals } : { enum: condition.when.in } } },
    then: {
      ...(condition.required?.length ? { required: condition.required } : {}),
      ...(condition.forbidden?.length ? { not: { anyOf: condition.forbidden.map(field => ({ required: [field] })) } } : {}),
      ...(Object.keys(condition.constraints ?? {}).length ? { properties: Object.fromEntries(Object.entries(condition.constraints).map(([field, constraints]) => [field, { ...capabilityDefinitions.fields[field], ...constraints }])) } : {})
    }
  }));
  const metadata = (definition.conditions ?? []).filter(condition => condition.kind === 'page_selector' || condition.kind === 'same_origin');
  if (metadata.length) then['x-webenvoy-conditions'] = metadata;
  const fileCondition = (definition.conditions ?? []).find(condition => condition.kind === 'file_scope' && condition.equals);
  if (fileCondition) then['x-webenvoy-equals'] = { left: `${fileCondition.path}[0]`, right: fileCondition.equals };
  const explicitSelector = (definition.conditions ?? []).find(condition => condition.kind === 'page_selector' && condition.when === 'always');
  if (explicitSelector) then.anyOf = explicitSelector.required_any.map(field => ({ required: [field] }));
  return then;
};
const operationConditions = capabilityOperations.map(definition => ({
  if: { required: ['operation'], properties: { operation: { const: definition.id } } },
  then: conditionThen(definition)
}));
const managedOperationSchema = {
  type: 'object',
  properties: managedOperationProperties,
  required: ['idempotency_key', 'grant_id', 'operation', 'task_scope'],
  additionalProperties: false,
  allOf: [
    {
      if: { required: ['operation'], properties: { operation: { enum: managedFileOperationIds } } },
      then: { properties: { task_scope: { ...managedTaskScopeSchema('file'), description: 'Authorization scope for this single submitted operation. file_refs is allowed only for the current file.upload or file.download operation; upload carries one ref equal to file_ref and download carries []. Omit this field for every non-file operation.' } } },
      else: { properties: { task_scope: managedTaskScopeSchema(undefined) } }
    },
    {
      if: { required: ['operation'], properties: { operation: { enum: ['file.upload'] } } },
      then: { properties: { task_scope: managedTaskScopeSchema('upload') }, 'x-webenvoy-equals': { left: 'task_scope.file_refs[0]', right: 'file_ref' } }
    },
    {
      if: { required: ['operation'], properties: { operation: { enum: ['file.download'] } } },
      then: { properties: { task_scope: managedTaskScopeSchema('download') } }
    },
    {
      if: { required: ['operation'], properties: { operation: { enum: managedOriginOperationIds } } },
      then: { required: ['origin'] }
    },
    ...operationConditions
  ]
};
const tools = [
  { name: 'webenvoy_status', description: 'Verify installed Runtime and SKILL assets; return actual versions, readiness, and safe recovery guidance.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'webenvoy_skill', description: 'Read the actual installed, integrity-verified WebEnvoy management/controlled browser SKILL before operating.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'webenvoy_connect', description: 'Connect the already registered Agent Principal. Cannot register or grant permissions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'webenvoy_describe', description: 'Read the current static operation definition and, when explicitly supplied, the one authorized Profile/Provider/Runtime context. This is optional help: it never starts Runtime, opens a Page, acquires control, creates a Run, or grants permission.', inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', pattern: capabilityDefinitions.operation_pattern, description: 'One operation name; unknown and out-of-scope names receive an explicit definition state.' },
      context: {
        type: 'object',
        properties: {
          grant_id: { type: 'string' },
          profile_ref: { type: 'string' },
          task_scope: { type: 'object', properties: { ...managedTaskScopeProperties, file_refs: { type: 'array', items: { type: 'string', pattern: '^attachment:runtime/[0-9a-f-]{36}$' }, description: 'Only for file operations; upload carries one ref and download carries an empty array.' } }, required: ['operations', 'profile_refs', 'origins'], additionalProperties: false }
        },
        required: ['grant_id', 'profile_ref', 'task_scope'],
        additionalProperties: false
      },
      arguments: { type: 'object', description: 'A partial draft of the target operation fields; envelope and context fields are not accepted.', properties: Object.fromEntries(Object.entries(capabilityDefinitions.fields).filter(([name]) => name !== 'profile_ref').map(([name, schema]) => [name, { ...schema }])), additionalProperties: false }
    },
    required: ['operation'],
    additionalProperties: false
  } },
  { name: 'webenvoy_operation', description: managedOperationDescription, inputSchema: managedOperationSchema },
  { name: 'webenvoy_query', description: 'Query a prior Run without replay. If the response was lost, reconnect and query the original idempotency_key.', inputSchema: { type: 'object', properties: { run_id: { type: 'string', pattern: '^managed-[a-f0-9]{64}$' }, idempotency_key: { type: 'string', minLength: 1, maxLength: 512 } }, additionalProperties: false } },
  { name: 'webenvoy_recovery', description: 'Inspect or request owner-managed recovery for a granted Profile, or query an existing recovery operation. This tool cannot backup, confirm, or apply a recovery.', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string', minLength: 1, maxLength: 512 }, grant_id: { type: 'string' }, operation: { type: 'string', enum: ['recovery.inspect','recovery.request','recovery.status'] }, task_scope: { type: 'object' }, profile_ref: { type: 'string' }, backup_ref: { type: 'string' }, operation_ref: { type: 'string' } }, required: ['idempotency_key','grant_id','operation','task_scope','profile_ref'], additionalProperties: false } },
  { name: 'webenvoy_skills', description: 'List, inspect, install, enable, read, update, rollback, or disable an explicitly authorized fixed SKILL revision. Reads return the verified content once; query returns only the durable receipt and summary.', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string', minLength: 1, maxLength: 512 }, grant_id: { type: 'string' }, operation: { type: 'string', enum: ['skill.list','skill.inspect','skill.install','skill.enable','skill.read','skill.update','skill.rollback','skill.disable'] }, task_scope: { type: 'object', properties: { operations: { type: 'array', items: { type: 'string' } }, skill_refs: { type: 'array', items: { type: 'string' } }, source_refs: { type: 'array', items: { type: 'string' } } }, required: ['operations','skill_refs','source_refs'], additionalProperties: false }, skill_ref: { type: 'string' }, source_ref: { type: 'string' }, revision_ref: { type: 'string' }, target_revision_ref: { type: 'string' }, expected_revision_ref: { type: ['string','null'] }, expected_current_revision_ref: { type: ['string','null'] }, expected_record_version: { type: 'integer', minimum: 0 } }, required: ['idempotency_key','grant_id','operation','task_scope'], additionalProperties: false } },
];
const operationTool = tools.find(tool => tool.name === 'webenvoy_operation');
const describeOperationPattern = new RegExp(capabilityDefinitions.operation_pattern);
const describeArgumentFields = new Set(Object.keys(capabilityDefinitions.fields).filter(name => name !== 'profile_ref'));
function validateDescribeInput(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.operation !== 'string' || !describeOperationPattern.test(args.operation)) throw new Error('describe_input_refused');
  if (Object.keys(args).some(key => !['operation', 'context', 'arguments'].includes(key))) throw new Error('describe_input_refused');
  if (args.context !== undefined) {
    const context = args.context;
    if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).some(key => !['grant_id', 'profile_ref', 'task_scope'].includes(key)) ||
      typeof context.grant_id !== 'string' || typeof context.profile_ref !== 'string' || !context.task_scope || typeof context.task_scope !== 'object' || Array.isArray(context.task_scope)) throw new Error('describe_input_refused');
    const scope = context.task_scope;
    const scopeKeys = ['operations', 'profile_refs', 'origins', ...(managedFileOperationIds.includes(args.operation) ? ['file_refs'] : [])];
    if (Object.keys(scope).some(key => !scopeKeys.includes(key)) || !Array.isArray(scope.operations) || !Array.isArray(scope.profile_refs) || !Array.isArray(scope.origins)) throw new Error('describe_input_refused');
  }
  if (args.arguments !== undefined) {
    const draft = args.arguments;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).some(key => !describeArgumentFields.has(key))) throw new Error('describe_input_refused');
  }
}
async function call(name, args) {
  await verifyBundle();
  if (name === 'webenvoy_skill') return { skill: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8') };
  const request = (path, body) => localRequest(client.data_dir, path, { credential: client.credential, ...(body === undefined ? {} : { method: 'POST', body }) });
  if (name === 'webenvoy_describe') {
    validateDescribeInput(args);
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    try {
      const result = await request('/managed-browser/capabilities/describe', { ...args, connection_id: connection.connection_id });
      if (result?.error?.code === 'runtime_unavailable_query_without_replay') return { ok: false, error: { code: 'runtime_unavailable' } };
      if (result?.error?.code === 'managed_access_route_not_found' || result?.error?.code === 'not_found') return { ok: false, error: { code: 'discovery_not_available' } };
      if (result?.error) return result;
      if (result?.schema_version !== 'webenvoy.capability-description/v1' || result?.definition_revision !== installedDefinitionRevision || !hasKnownCapabilityDescriptionStates(result)) return { ok: false, error: { code: 'discovery_version_mismatch' } };
      return result;
    } catch (error) {
      if (['ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(error?.code)) return { ok: false, error: { code: 'runtime_unavailable' } };
      throw error;
    }
  }
  const status = await ensureRuntime(client.data_dir);
  if (name === 'webenvoy_status') {
    const publicStatus = { ...status };
    delete publicStatus.camoufoxArtifact;
    delete publicStatus.camoufoxUpstream;
    delete publicStatus.chromeOfficial;
    if (publicStatus.camoufox_launch && publicStatus.camoufox_launch.state === 'retired' && ['retired_binding', 'unqualified'].includes(publicStatus.camoufox_launch.reason)) {
      publicStatus.camoufox_launch = { state: 'retired', reason: publicStatus.camoufox_launch.reason };
    } else {
      delete publicStatus.camoufox_launch;
    }
    return publicStatus;
  }
  if (name === 'webenvoy_connect') { const result = await request('/agent-connections', {}); connection = result.connection; return result; }
  if (name === 'webenvoy_query') {
    let runId = args.run_id;
    if (args.idempotency_key !== undefined) {
      if (!connection) return { ok: false, error: { code: 'connect_first' } };
      if (runId || typeof args.idempotency_key !== 'string' || !args.idempotency_key.length || args.idempotency_key.length > 512) throw new Error('query_input_refused');
      runId = `managed-${sha(`${connection.principal_id}:${args.idempotency_key}`)}`;
    }
    if (!/^managed-[a-f0-9]{64}$/.test(runId)) throw new Error('query_input_refused');
    const skillResult = await request(`/managed-skills/operations/${runId}`);
    if (skillResult?.error?.code !== 'managed_skill_operation_not_found') return skillResult;
    return request(`/managed-browser/operations/${runId}`);
  }
  if (name === 'webenvoy_operation') {
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    if (!managedOperationSet.has(args.operation) || Object.keys(args).some(k => !(k in operationTool.inputSchema.properties))) throw new Error('operation_input_refused');
    const scope = args.task_scope;
    if (!managedFileOperationIds.includes(args.operation) && scope && typeof scope === 'object' && !Array.isArray(scope) && Object.hasOwn(scope, 'file_refs')) throw new Error('operation_input_refused');
    if (managedOriginOperationIds.includes(args.operation) && typeof args.origin !== 'string') throw new Error('operation_input_refused');
    return request('/managed-browser/operations', { ...args, connection_id: connection.connection_id });
  }
  if (name === 'webenvoy_recovery') {
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    if (!['recovery.inspect','recovery.request','recovery.status'].includes(args.operation)) throw new Error('recovery_input_refused');
    return request('/managed-browser/operations', { ...args, connection_id: connection.connection_id });
  }
  if (name === 'webenvoy_skills') {
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    const schema = tools.find(tool => tool.name === 'webenvoy_skills').inputSchema;
    if (!schema.properties.operation.enum.includes(args.operation) || Object.keys(args).some(k => !(k in schema.properties))) throw new Error('skill_input_refused');
    return request('/managed-skills/operations', { ...args, connection_id: connection.connection_id });
  }
  throw new Error('tool_not_found');
}
async function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return;
  let result;
  if (method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'webenvoy', version: '0.2.0' } };
  else if (method === 'ping') result = {};
  else if (method === 'tools/list') result = { tools };
  else if (method === 'tools/call') {
    try { result = { content: [{ type: 'text', text: JSON.stringify(await call(params.name, params.arguments ?? {})) }] }; }
    catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  return { jsonrpc: '2.0', id, result };
}
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try { const response = await handle(JSON.parse(line)); if (response) process.stdout.write(JSON.stringify(response) + '\n'); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); }
}
