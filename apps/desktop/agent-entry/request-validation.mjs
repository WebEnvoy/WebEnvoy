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
