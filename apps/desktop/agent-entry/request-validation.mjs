function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function assertExactObject(value, allowed, code) {
  assertObject(value, code);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(code);
  return value;
}

function assertString(value, code, { min = 1, max = 512 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(code);
  return value;
}

function assertField(value, schema, code) {
  if (Array.isArray(schema.type)) {
    if (schema.type.some(type => type === 'null' && value === null)) return;
    if (schema.type.some(type => type === 'string' && typeof value === 'string')) return assertField(value, { ...schema, type: 'string' }, code);
    if (schema.type.some(type => type === 'integer' && Number.isSafeInteger(value))) return assertField(value, { ...schema, type: 'integer' }, code);
    if (schema.type.some(type => type === 'boolean' && typeof value === 'boolean')) return;
    if (schema.type.some(type => type === 'object' && value && typeof value === 'object' && !Array.isArray(value))) return assertField(value, { ...schema, type: 'object' }, code);
    if (schema.type.some(type => type === 'array' && Array.isArray(value))) return assertField(value, { ...schema, type: 'array' }, code);
    throw new Error(code);
  }
  if (schema.type === 'string') {
    assertString(value, code, { min: schema.minLength ?? 0, max: schema.maxLength ?? 2 ** 20 });
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) throw new Error(code);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(code);
    if (schema.format === 'webenvoy-public-origin') {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error(code); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(code);
    }
    if (schema.format === 'webenvoy-public-http-target') {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error(code); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new Error(code);
    }
    return;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(code);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(code);
    if (schema.items) for (const item of value) assertField(item, schema.items, code);
    return;
  }
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum || schema.not?.const === value)) throw new Error(code);
  if (schema.type === 'object') {
    assertObject(value, code);
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) throw new Error(code);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) throw new Error(code);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(code);
    for (const [key, child] of Object.entries(value)) assertField(child, schema.properties?.[key] ?? {}, code);
  }
}

function assertTaskScope(scope, fileScope, code) {
  const keys = ['operations', 'profile_refs', 'origins', ...(fileScope ? ['file_refs'] : [])];
  assertExactObject(scope, keys, code);
  for (const key of ['operations', 'profile_refs', 'origins']) if (!Array.isArray(scope[key]) || scope[key].some(value => typeof value !== 'string')) throw new Error(code);
  if (fileScope === 'upload' && (!Array.isArray(scope.file_refs) || scope.file_refs.length !== 1 || typeof scope.file_refs[0] !== 'string')) throw new Error(code);
  if (fileScope === 'download' && (!Array.isArray(scope.file_refs) || scope.file_refs.length !== 0)) throw new Error(code);
}

export const managedTaskSchemaVersion = 'webenvoy.managed-task-operation/v1';
const taskText = { type: 'string', minLength: 1, maxLength: 512 };
const taskScopeSchema = {
  type: 'object', additionalProperties: false,
  required: ['operations', 'skill_refs', 'source_refs', 'profile_refs', 'origins'],
  properties: Object.fromEntries(['operations', 'skill_refs', 'source_refs', 'profile_refs', 'origins'].map(key => [key, {
    type: 'array', maxItems: 1024, uniqueItems: true, items: taskText
  }]))
};
const selectorSchema = {
  type: 'object', additionalProperties: false,
  properties: { run_id: taskText, original_idempotency_key: taskText },
  oneOf: [
    { required: ['run_id'] },
    { required: ['original_idempotency_key'] }
  ]
};
const taskInputSchema = {
  type: 'object', additionalProperties: false,
  required: ['schema_ref', 'carrier'],
  properties: {
    schema_ref: taskText,
    carrier: { type: 'string', enum: ['none', 'webenvoy.managed-task-inline/v1'] },
    value: { description: 'Inline JSON is limited to 65536 compact UTF-8 bytes and validated against the pinned Lode schema by Core.' }
  },
  oneOf: [
    { properties: { carrier: { const: 'none' } }, not: { required: ['value'] } },
    { properties: { carrier: { const: 'webenvoy.managed-task-inline/v1' } }, required: ['value'] }
  ]
};
const taskIntentSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'policy'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 256 },
    policy: {
      type: 'object', additionalProperties: false, required: ['risk', 'execution_intent'],
      properties: {
        risk: { type: 'string', enum: ['read', 'write', 'submit', 'destructive'] },
        execution_intent: { type: 'string', enum: ['read', 'validate_only', 'draft', 'preview', 'execute_after_approval', 'reconcile_status', 'request_cancel'] },
        timeout_ms: { type: 'integer', minimum: 1 }
      }
    }
  }
};
const managedTaskFields = {
  schema_version: { const: managedTaskSchemaVersion },
  operation: { type: 'string', enum: ['task.submit', 'task.query', 'task.stop'] },
  idempotency_key: taskText,
  grant_id: taskText,
  task_scope: taskScopeSchema,
  package: {
    type: 'object', additionalProperties: false,
    required: ['package_ref', 'revision_ref', 'package_digest', 'task_ref'],
    properties: {
      package_ref: taskText, revision_ref: taskText,
      package_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, task_ref: taskText
    }
  },
  target: {
    type: 'object', additionalProperties: false, required: ['target_type', 'target_ref'],
    properties: { target_type: taskText, target_ref: { type: 'string', minLength: 1, maxLength: 2048, not: { pattern: '://' } } }
  },
  input: taskInputSchema,
  intent: taskIntentSchema,
  selector: selectorSchema
};
const noManagedTaskFields = fields => ({ not: { anyOf: fields.map(field => ({ required: [field] })) } });

// The MCP and CLI accept this shape. The managed-access API adds connection_id
// after the current Agent connection has been selected.
export const managedTaskInputSchema = {
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'operation', 'grant_id', 'task_scope'],
  properties: managedTaskFields,
  oneOf: [
    {
      properties: { operation: { const: 'task.submit' } },
      required: ['idempotency_key', 'package', 'target', 'input', 'intent'],
      ...noManagedTaskFields(['selector'])
    },
    {
      properties: { operation: { const: 'task.query' } },
      required: ['selector'],
      ...noManagedTaskFields(['idempotency_key', 'package', 'target', 'input', 'intent'])
    },
    {
      properties: { operation: { const: 'task.stop' }, selector: { type: 'object', additionalProperties: false, required: ['run_id'], properties: { run_id: taskText } } },
      required: ['idempotency_key', 'selector'],
      ...noManagedTaskFields(['package', 'target', 'input', 'intent'])
    }
  ],
  allOf: ['task.submit', 'task.query', 'task.stop'].map(operation => ({
    if: { required: ['operation'], properties: { operation: { const: operation } } },
    then: {
      properties: {
        task_scope: {
          properties: {
            operations: { minItems: 1, maxItems: 1, items: { const: operation } }
          }
        }
      }
    }
  }))
};

function taskArray(value, code, { min = 0, max = 1024, origin = false } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(code);
  const seen = new Set();
  for (const item of value) {
    assertString(item, code, { max: 512 });
    if (seen.has(item)) throw new Error(code);
    seen.add(item);
    if (origin) {
      let parsed;
      try { parsed = new URL(item); } catch { throw new Error(code); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== item || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(code);
    }
  }
}

function validateTaskScope(scope, operation, code) {
  assertExactObject(scope, ['operations', 'skill_refs', 'source_refs', 'profile_refs', 'origins'], code);
  for (const key of ['operations', 'skill_refs', 'source_refs', 'profile_refs', 'origins']) taskArray(scope[key], code, { min: key === 'operations' ? 1 : 0, max: key === 'operations' ? 1 : 1024, origin: key === 'origins' });
  if (scope.operations[0] !== operation) throw new Error(code);
}

function validateTaskSelector(selector, operation, code) {
  if (operation === 'task.stop') {
    assertExactObject(selector, ['run_id'], code);
    assertString(selector.run_id, code);
    return;
  }
  assertObject(selector, code);
  const keys = Object.keys(selector);
  if (keys.length !== 1 || !['run_id', 'original_idempotency_key'].includes(keys[0])) throw new Error(code);
  assertString(selector[keys[0]], code);
}

export function validateManagedTaskRequest(value) {
  const code = 'managed_task_invalid_input';
  assertObject(value, code);
  if (typeof value.schema_version === 'string' && value.schema_version !== managedTaskSchemaVersion) throw new Error('managed_task_version_unsupported');
  const operation = value.operation;
  if (!['task.submit', 'task.query', 'task.stop'].includes(operation)) throw new Error(code);
  const common = ['schema_version', 'operation', 'grant_id', 'task_scope'];
  const allowed = operation === 'task.submit'
    ? [...common, 'idempotency_key', 'package', 'target', 'input', 'intent']
    : operation === 'task.query' ? [...common, 'selector'] : [...common, 'idempotency_key', 'selector'];
  assertExactObject(value, allowed, code);
  if (value.schema_version !== managedTaskSchemaVersion) throw new Error('managed_task_version_unsupported');
  assertString(value.grant_id, code);
  validateTaskScope(value.task_scope, operation, code);
  if (operation !== 'task.query') assertString(value.idempotency_key, code);
  if (operation !== 'task.submit') {
    validateTaskSelector(value.selector, operation, code);
    if (operation === 'task.query' && value.selector.run_id === undefined && value.selector.original_idempotency_key === undefined) throw new Error(code);
    return value;
  }

  const packageRef = assertExactObject(value.package, ['package_ref', 'revision_ref', 'package_digest', 'task_ref'], code);
  for (const key of ['package_ref', 'revision_ref', 'task_ref']) assertString(packageRef[key], code);
  if (typeof packageRef.package_digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(packageRef.package_digest)) throw new Error(code);
  const target = assertExactObject(value.target, ['target_type', 'target_ref'], code);
  assertString(target.target_type, code);
  assertString(target.target_ref, code, { max: 2048 });
  if (target.target_ref.includes('://')) throw new Error(code);
  const input = assertExactObject(value.input, ['schema_ref', 'carrier', 'value'], code);
  assertString(input.schema_ref, code);
  if (input.carrier === 'none') {
    if (Object.hasOwn(input, 'value')) throw new Error(code);
  } else if (input.carrier === 'webenvoy.managed-task-inline/v1') {
    if (!Object.hasOwn(input, 'value')) throw new Error(code);
    let serialized;
    try { serialized = JSON.stringify(input.value); } catch { throw new Error(code); }
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 65536) throw new Error(code);
  } else throw new Error(code);
  const intent = assertExactObject(value.intent, ['summary', 'policy'], code);
  assertString(intent.summary, code, { max: 1024 });
  if ([...intent.summary].length > 256) throw new Error(code);
  const policy = assertExactObject(intent.policy, ['risk', 'execution_intent', 'timeout_ms'], code);
  if (!['read', 'write', 'submit', 'destructive'].includes(policy.risk) || !['read', 'validate_only', 'draft', 'preview', 'execute_after_approval', 'reconcile_status', 'request_cancel'].includes(policy.execution_intent)) throw new Error(code);
  if (Object.hasOwn(policy, 'timeout_ms') && (!Number.isSafeInteger(policy.timeout_ms) || policy.timeout_ms < 1)) throw new Error(code);
  return value;
}

export function validateOperationRequest(value, definitions) {
  const code = 'operation_input_refused';
  const exposed = definitions.operations.filter(item => item.exposure === 'exposed');
  const fields = definitions.fields;
  assertObject(value, code);
  const allowedTop = ['idempotency_key', 'grant_id', 'operation', 'task_scope', ...Object.keys(fields)];
  if (Object.keys(value).some(key => !allowedTop.includes(key)) || typeof value.idempotency_key !== 'string' || !value.idempotency_key.length || value.idempotency_key.length > 512 || typeof value.grant_id !== 'string' || !value.grant_id.length || typeof value.operation !== 'string') throw new Error(code);
  const definition = exposed.find(item => item.id === value.operation);
  if (!definition) throw new Error(code);
  assertTaskScope(value.task_scope, definition.file_scope, code);
  if (!value.task_scope.operations.includes(definition.id)) throw new Error(code);
  if (definition.file_scope === 'upload' && !/^attachment:runtime\/[0-9a-f-]{36}$/.test(value.task_scope.file_refs[0])) throw new Error(code);
  for (const [key, field] of Object.entries(fields)) if (Object.hasOwn(value, key)) assertField(value[key], field, code);
  if (Object.keys(value).some(key => fields[key] && !definition.allowed.includes(key))) throw new Error(code);
  for (const key of definition.required) if (!Object.hasOwn(value, key)) throw new Error(code);
  for (const condition of definition.conditions ?? []) {
    if (condition.kind !== 'conditional_fields') continue;
    const when = condition.when ?? {};
    const matched = when.present ? Object.hasOwn(value, when.field) : when.absent ? !Object.hasOwn(value, when.field) : when.equals !== undefined ? value[when.field] === when.equals : Array.isArray(when.in) ? when.in.includes(value[when.field]) : false;
    if (!matched) continue;
    for (const key of condition.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(code);
    if ((condition.forbidden ?? []).some(key => Object.hasOwn(value, key))) throw new Error(code);
    for (const [key, constraints] of Object.entries(condition.constraints ?? {})) {
      if (!Object.hasOwn(value, key)) continue;
      if (constraints.maximum !== undefined && value[key] > constraints.maximum || constraints.maxLength !== undefined && value[key].length > constraints.maxLength || constraints.minLength !== undefined && value[key].length < constraints.minLength) throw new Error(code);
    }
  }
  for (const condition of definition.conditions ?? []) {
    if (condition.kind === 'page_selector' && condition.when === 'always' && !condition.required_any.some(key => Object.hasOwn(value, key))) throw new Error(code);
    if (condition.kind === 'file_scope' && condition.equals === 'file_ref' && value.task_scope.file_refs?.[0] !== value.file_ref) throw new Error(code);
  }
  return value;
}

export function validateDescribeRequest(value, definitions) {
  const code = 'describe_input_refused';
  assertExactObject(value, ['operation', 'context', 'arguments'], code);
  assertString(value.operation, code);
  if (!(new RegExp(definitions.operation_pattern).test(value.operation))) throw new Error(code);
  if (value.context !== undefined) {
    const context = assertExactObject(value.context, ['grant_id', 'profile_ref', 'task_scope'], code);
    assertString(context.grant_id, code);
    assertString(context.profile_ref, code);
    assertTaskScope(context.task_scope, definitions.operations.find(item => item.id === value.operation)?.file_scope, code);
  }
  if (value.arguments !== undefined) {
    const draft = assertObject(value.arguments, code);
    const allowed = new Set(Object.keys(definitions.fields).filter(name => name !== 'profile_ref'));
    if (Object.keys(draft).some(key => !allowed.has(key))) throw new Error(code);
    for (const [key, field] of Object.entries(definitions.fields)) if (key !== 'profile_ref' && Object.hasOwn(draft, key)) assertField(draft[key], field, code);
  }
  return value;
}

export function validateRecoveryRequest(value) {
  const code = 'recovery_input_refused';
  assertExactObject(value, ['idempotency_key', 'grant_id', 'operation', 'task_scope', 'profile_ref', 'backup_ref', 'operation_ref'], code);
  for (const key of ['idempotency_key', 'grant_id', 'profile_ref']) assertString(value[key], code);
  if (!['recovery.inspect', 'recovery.request', 'recovery.status'].includes(value.operation)) throw new Error(code);
  const scope = assertExactObject(value.task_scope, ['operations', 'profile_refs', 'origins'], code);
  for (const key of ['operations', 'profile_refs', 'origins']) if (!Array.isArray(scope[key]) || scope[key].some(item => typeof item !== 'string')) throw new Error(code);
  return value;
}

export function validateSkillsRequest(value) {
  const code = 'skill_input_refused';
  assertExactObject(value, ['idempotency_key', 'grant_id', 'operation', 'task_scope', 'skill_ref', 'source_ref', 'revision_ref', 'target_revision_ref', 'expected_revision_ref', 'expected_current_revision_ref', 'expected_record_version'], code);
  for (const key of ['idempotency_key', 'grant_id']) assertString(value[key], code);
  if (!['skill.list', 'skill.inspect', 'skill.install', 'skill.enable', 'skill.read', 'skill.update', 'skill.rollback', 'skill.disable'].includes(value.operation)) throw new Error(code);
  const scope = assertExactObject(value.task_scope, ['operations', 'skill_refs', 'source_refs'], code);
  for (const key of ['operations', 'skill_refs', 'source_refs']) if (!Array.isArray(scope[key]) || scope[key].some(item => typeof item !== 'string')) throw new Error(code);
  return value;
}
