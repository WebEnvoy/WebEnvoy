import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, sha, verifyBundle } from './bundle.mjs';
import { agentRequest, ensureAgentRuntime, readClient, runManagedSiteWorker } from './client.mjs';
import { managedTaskInputSchema, validateAccountSystemRequest, validateDescribeRequest, validateManagedTaskRequest, validateOperationRequest, validateRecoveryRequest, validateSkillsRequest } from './request-validation.mjs';
const client = await readClient(process.argv[2]);
let connection;
const activeManagedSiteWorkers = new Map();
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
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const nullable = (value, predicate) => value === null || predicate(value);
function hasObservationTargetsShape(value) {
  if (!exactKeys(value, ['schema_version', 'page_id', 'page_ref', 'document_generation', 'observation_ref', 'captured_at', 'controls', 'text', 'truncated', 'coverage', 'continuation']) ||
    value.schema_version !== 'harbor-observation-targets/v1' || typeof value.page_id !== 'string' || typeof value.page_ref !== 'string' ||
    !Number.isSafeInteger(value.document_generation) || value.document_generation < 1 || typeof value.observation_ref !== 'string' ||
    typeof value.captured_at !== 'string' || !Number.isFinite(Date.parse(value.captured_at)) || !Array.isArray(value.controls) || value.controls.length > 128 ||
    typeof value.text !== 'string' || Buffer.byteLength(value.text, 'utf8') > 65536 || typeof value.truncated !== 'boolean') return false;
  const controlKeys = ['target_ref', 'role', 'name', 'enabled', 'name_source', 'description', 'context', 'hints', 'disambiguation', 'truncated_fields'];
  if (value.controls.some(control => !exactKeys(control, controlKeys) || typeof control.target_ref !== 'string' || typeof control.role !== 'string' ||
    typeof control.name !== 'string' || typeof control.enabled !== 'boolean' || !['provider_accessibility', 'html_label', 'aria_labelledby', 'aria_label', 'content', 'alt', 'title', 'none'].includes(control.name_source) ||
    !nullable(control.description, item => typeof item === 'string') || !Array.isArray(control.context) || control.context.length > 2 || control.context.some(item =>
      !exactKeys(item, ['kind', 'name']) || !['form', 'group', 'dialog', 'region', 'heading'].includes(item.kind) || typeof item.name !== 'string') ||
    !Array.isArray(control.truncated_fields) || control.truncated_fields.some(item => typeof item !== 'string') ||
    !exactKeys(control.hints, ['placeholder', 'input_type', 'multiline', 'editable']) ||
    !nullable(control.hints.placeholder, item => typeof item === 'string') || !nullable(control.hints.input_type, item => typeof item === 'string') ||
    !nullable(control.hints.multiline, item => typeof item === 'boolean') || !nullable(control.hints.editable, item => typeof item === 'boolean') ||
    !['unique', 'contextual', 'ambiguous'].includes(control.disambiguation))) return false;
  const coverage = value.coverage;
  const continuation = value.continuation;
  if (!exactKeys(coverage, ['scope', 'excluded', 'controls', 'text', 'semantics']) || coverage.scope !== 'main_document_light_dom' || !Array.isArray(coverage.excluded) ||
    !exactKeys(coverage.controls, ['enumeration_complete', 'captured_count', 'total', 'returned_through', 'complete', 'reason_codes']) ||
    !exactKeys(coverage.text, ['state', 'returned_bytes']) || !exactKeys(coverage.semantics, ['complete', 'reason_codes']) ||
    !exactKeys(continuation, ['offset', 'returned_count', 'has_more', 'next_cursor'])) return false;
  const controls = coverage.controls;
  return typeof controls.enumeration_complete === 'boolean' && Number.isSafeInteger(controls.captured_count) && controls.captured_count >= 0 && controls.captured_count <= 2048 &&
    (controls.total === null || Number.isSafeInteger(controls.total) && controls.total >= 0 && controls.total <= 2048) && Number.isSafeInteger(controls.returned_through) && controls.returned_through >= 0 && controls.returned_through <= controls.captured_count && typeof controls.complete === 'boolean' && Array.isArray(controls.reason_codes) &&
    ['complete', 'truncated', 'omitted_on_continuation', 'unavailable'].includes(coverage.text.state) && Number.isSafeInteger(coverage.text.returned_bytes) &&
    coverage.text.returned_bytes === Buffer.byteLength(value.text, 'utf8') && typeof coverage.semantics.complete === 'boolean' && Array.isArray(coverage.semantics.reason_codes) &&
    Number.isSafeInteger(continuation.offset) && continuation.offset >= 0 && Number.isSafeInteger(continuation.returned_count) && continuation.returned_count >= 0 && continuation.returned_count === value.controls.length &&
    continuation.offset + continuation.returned_count === controls.returned_through && typeof continuation.has_more === 'boolean' &&
    continuation.has_more === (controls.returned_through < controls.captured_count) && (!continuation.has_more || continuation.returned_count > 0) &&
    (continuation.has_more ? typeof continuation.next_cursor === 'string' && continuation.next_cursor.length > 0 && continuation.next_cursor.length <= 256 : continuation.next_cursor === null) &&
    (continuation.offset === 0 || value.text === '' && coverage.text.state === 'omitted_on_continuation' && coverage.text.returned_bytes === 0) &&
    controls.complete === (controls.enumeration_complete && controls.returned_through === controls.captured_count) &&
    (controls.enumeration_complete ? controls.total === controls.captured_count : controls.total === null);
}
function checkedObservationResult(value) {
  if (!value?.result?.snapshot || hasObservationTargetsShape(value.result.snapshot)) return value;
  return { ok: false, ...(typeof value.run_id === 'string' ? { run_id: value.run_id } : {}), ...(typeof value.status === 'string' ? { status: value.status } : {}), error: { code: 'observation_format_unavailable' } };
}
const capabilityOperations = capabilityDefinitions.operations.filter(definition => definition.exposure === 'exposed');
const managedOperationIds = capabilityOperations.map(definition => definition.id);
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
const conditionIf = condition => {
  const when = condition.when;
  if (!when || typeof when !== 'object' || typeof when.field !== 'string') return undefined;
  if (Object.hasOwn(when, 'present')) return when.present === true ? { required: [when.field] } : { not: { required: [when.field] } };
  if (Object.hasOwn(when, 'absent')) return when.absent === true ? { not: { required: [when.field] } } : { required: [when.field] };
  if (Object.hasOwn(when, 'equals')) return { required: [when.field], properties: { [when.field]: { const: when.equals } } };
  if (Array.isArray(when.in)) return { required: [when.field], properties: { [when.field]: { enum: when.in } } };
  return undefined;
};
const conditionThen = definition => {
  const then = {
    required: [...definition.required],
    ...(forbiddenFor(definition).length ? { not: { anyOf: forbiddenFor(definition).map(field => ({ required: [field] })) } } : {})
  };
  const conditional = (definition.conditions ?? []).filter(condition => condition.kind === 'conditional_fields' && conditionIf(condition));
  if (conditional.length) then.allOf = conditional.map(condition => ({
    if: conditionIf(condition),
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
  { name: 'webenvoy_skills', description: 'Discover with skill.list first; pass its stable skill_ref to skill.inspect. Keep task_scope.source_refs as scope filters; never copy one to top-level source_ref or revision_ref. Only skill.install takes a listed full revision_ref and optional matching source_ref. Reads return the verified content once; query returns only the durable receipt and summary.', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string', minLength: 1, maxLength: 512 }, grant_id: { type: 'string' }, operation: { type: 'string', enum: ['skill.list','skill.inspect','skill.install','skill.enable','skill.read','skill.update','skill.rollback','skill.disable'] }, task_scope: { type: 'object', properties: { operations: { type: 'array', items: { type: 'string' } }, skill_refs: { type: 'array', items: { type: 'string' } }, source_refs: { type: 'array', items: { type: 'string' } } }, required: ['operations','skill_refs','source_refs'], additionalProperties: false }, skill_ref: { type: 'string' }, source_ref: { type: 'string' }, revision_ref: { type: 'string' }, target_revision_ref: { type: 'string' }, expected_revision_ref: { type: ['string','null'] }, expected_current_revision_ref: { type: ['string','null'] }, expected_record_version: { type: 'integer', minimum: 0 } }, required: ['idempotency_key','grant_id','operation','task_scope'], additionalProperties: false } },
  { name: 'webenvoy_task', description: 'Submit, query, or stop one pinned site task through Core managed access. Requires webenvoy_connect; this tool passes connection_id from that current context. Core owns package and code admission, Grant checks, Run, result and recovery. Declared scripts execute only through the verified distinct-UID Agent worker; trusted_local refuses them. The MCP tool returns only the final Run projection, never the worker ticket or script source. It does not use owner /tasks or /runs.', inputSchema: managedTaskInputSchema },
  { name: 'webenvoy_account_system', description: 'Read the public metadata and local revision for one explicitly granted AccountSystem template. This does not read credentials, cookies, or infer login state.', inputSchema: { type: 'object', properties: { grant_id: { type: 'string', minLength: 1, maxLength: 512 }, template_ref: { type: 'string', pattern: '^lode://account-system/[A-Za-z0-9._/-]+@[0-9]+\\.[0-9]+\\.[0-9]+$' } }, required: ['grant_id', 'template_ref'], additionalProperties: false } },
];
async function call(name, args) {
  await verifyBundle();
  if (name === 'webenvoy_skill') return { skill: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8') };
  const request = (path, body) => agentRequest(client, path, { credential: client.credential, ...(body === undefined ? {} : { method: 'POST', body }) });
  if (name === 'webenvoy_describe') {
    validateDescribeRequest(args, capabilityDefinitions);
    try {
      await ensureAgentRuntime(client);
      if (!connection) return { ok: false, error: { code: 'connect_first' } };
      const result = await request('/managed-browser/capabilities/describe', { ...args, connection_id: connection.connection_id });
      if (result?.error?.code === 'runtime_unavailable_query_without_replay') return { ok: false, error: { code: 'runtime_unavailable' } };
      if (result?.error?.code === 'managed_access_route_not_found' || result?.error?.code === 'not_found') return { ok: false, error: { code: 'discovery_not_available' } };
      if (result?.error) return result;
      if (result?.schema_version !== 'webenvoy.capability-description/v1' || result?.definition_revision !== installedDefinitionRevision || !hasKnownCapabilityDescriptionStates(result)) return { ok: false, error: { code: 'discovery_version_mismatch' } };
      return result;
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : '';
      if (['ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'runtime_unavailable'].includes(error?.code) || message === 'runtime_unavailable' || message.startsWith('runtime_unavailable:')) return { ok: false, error: { code: 'runtime_unavailable' } };
      throw error;
    }
  }
  if (name === 'webenvoy_operation') validateOperationRequest(args, capabilityDefinitions);
  if (name === 'webenvoy_task') validateManagedTaskRequest(args);
  if (name === 'webenvoy_recovery') validateRecoveryRequest(args);
  if (name === 'webenvoy_skills') validateSkillsRequest(args);
  if (name === 'webenvoy_account_system') validateAccountSystemRequest(args);
  if (name === 'webenvoy_query') validateQueryInput(args);
  if (['webenvoy_operation', 'webenvoy_recovery', 'webenvoy_skills', 'webenvoy_task', 'webenvoy_account_system'].includes(name) && !connection) return { ok: false, error: { code: 'connect_first' } };
  const status = await ensureAgentRuntime(client);
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
    return checkedObservationResult(await request(`/managed-browser/operations/${runId}`));
  }
  if (name === 'webenvoy_operation') {
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    try { return checkedObservationResult(await request('/managed-browser/operations', { ...args, connection_id: connection.connection_id })); }
    catch (error) { if (isDispatchedResponseLoss(error)) return unknownAgentOutcome(args.idempotency_key); throw error; }
  }
  if (name === 'webenvoy_recovery') {
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    try { return await request('/managed-browser/operations', { ...args, connection_id: connection.connection_id }); }
    catch (error) { if (isDispatchedResponseLoss(error)) return unknownAgentOutcome(args.idempotency_key); throw error; }
  }
  if (name === 'webenvoy_skills') {
    if (!connection) return { ok: false, error: { code: 'connect_first' } };
    try { return await request('/managed-skills/operations', { ...args, connection_id: connection.connection_id }); }
    catch (error) { if (isDispatchedResponseLoss(error)) return unknownAgentOutcome(args.idempotency_key); throw error; }
  }
  if (name === 'webenvoy_account_system') {
    return request('/managed-account-systems/operations', {
      schema_version: 'webenvoy.account-system-agent-operation/v1', operation: 'account_system.read',
      grant_id: args.grant_id, template_ref: args.template_ref, connection_id: connection.connection_id
    });
  }
  if (name === 'webenvoy_task') {
    try {
      const result = await request('/managed-tasks/operations', { ...args, connection_id: connection.connection_id });
      if (args.operation === 'task.stop' && typeof args.selector?.run_id === 'string') activeManagedSiteWorkers.get(args.selector.run_id)?.abort();
      if (!result?.worker_execution) return result;
      const workerExecution = result.worker_execution;
      if (!exactKeys(workerExecution, ['ticket']) || !workerExecution.ticket || typeof workerExecution.ticket !== 'object' || Array.isArray(workerExecution.ticket) ||
          typeof workerExecution.ticket.run_id !== 'string') return { ok: false, run_id: result.run?.run_id, status: result.run?.status, error: { code: 'managed_site_worker_ticket_invalid' } };
      const runId = workerExecution.ticket.run_id;
      const controller = new AbortController();
      activeManagedSiteWorkers.set(runId, controller);
      try { return await runManagedSiteWorker(client, workerExecution.ticket, { signal: controller.signal }); }
      finally { if (activeManagedSiteWorkers.get(runId) === controller) activeManagedSiteWorkers.delete(runId); }
    }
    catch (error) {
      if (!isDispatchedResponseLoss(error)) throw error;
      return { ok: false, status: 'unknown_outcome', dispatch_state: 'possibly_dispatched', ...(typeof args.idempotency_key === 'string' ? { idempotency_key: args.idempotency_key } : {}), error: { code: 'runtime_unavailable_unknown_outcome' } };
    }
  }
  throw new Error('tool_not_found');
}
function isDispatchedResponseLoss(error) {
  return ['runtime_response_aborted', 'runtime_response_invalid', 'runtime_timeout', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(error?.code ?? error?.message?.split(':', 1)[0]);
}
function unknownAgentOutcome(idempotencyKey) {
  return { ok: false, status: 'unknown_outcome', dispatch_state: 'dispatched', idempotency_key: idempotencyKey, failure: { code: 'managed_browser_outcome_unknown' }, reconciliation: null };
}
function validateQueryInput(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['run_id', 'idempotency_key'].includes(key)) || args.run_id !== undefined && args.idempotency_key !== undefined || args.run_id === undefined && args.idempotency_key === undefined) throw new Error('query_input_refused');
  if (args.run_id !== undefined && (typeof args.run_id !== 'string' || !/^managed-[a-f0-9]{64}$/.test(args.run_id))) throw new Error('query_input_refused');
  if (args.idempotency_key !== undefined && (typeof args.idempotency_key !== 'string' || !args.idempotency_key.length || args.idempotency_key.length > 512)) throw new Error('query_input_refused');
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
  let message;
  try { message = JSON.parse(line); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
  void handle(message).then(response => { if (response) process.stdout.write(JSON.stringify(response) + '\n'); })
    .catch(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'Internal error' } }) + '\n'));
}
