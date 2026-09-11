import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, sha, verifyBundle } from './bundle.mjs';
import { ensureRuntime, localRequest, readClient } from './client.mjs';
const client = await readClient(process.argv[2]);
let connection;
const tools = [
  { name: 'webenvoy_status', description: 'Verify installed Runtime and SKILL assets; return actual versions, readiness, and safe recovery guidance.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'webenvoy_skill', description: 'Read the actual installed, integrity-verified WebEnvoy management/controlled browser SKILL before operating.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'webenvoy_connect', description: 'Connect the already registered Agent Principal. Cannot register or grant permissions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'webenvoy_operation', description: 'Submit one authorized management/environment/Page/public-read/diagnostic/controlled-page operation. Page list and diagnostics are read-only; opening, activating, closing, navigating, reloading, or moving history use the existing Run/receipt and never retry. Keep exact runtime_session_ref and selected page_id/page_ref. snapshot discovers bounded controls; click/input/press/scroll/wait require its page_ref and observation_ref. URLs may include ordinary query and fragment values, but public summaries redact them. Diagnostics are bounded redacted metadata without bodies or headers. Never retries.', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string' }, grant_id: { type: 'string' }, operation: { type: 'string', enum: ['profile.create','profile.list','profile.read','instance.start','instance.observe','instance.diagnostics','environment.read','environment.update','instance.navigate','instance.read','page.list','page.open','page.activate','page.close','page.navigate','page.reload','page.back','page.forward','instance.snapshot','instance.click','instance.input','instance.press','instance.scroll','instance.wait','instance.handoff','instance.stop'] }, task_scope: { type: 'object', properties: { operations: { type: 'array', items: { type: 'string' } }, profile_refs: { type: 'array', items: { type: 'string' } }, origins: { type: 'array', items: { type: 'string' } } }, required: ['operations','profile_refs','origins'], additionalProperties: false }, template_ref: { type: 'string' }, profile_ref: { type: 'string' }, runtime_session_ref: { type: 'string' }, origin: { type: 'string' }, url: { type: 'string' }, configuration: { type: 'object', properties: { timezone: { type: 'string', minLength: 1, maxLength: 128 }, language: { type: 'string', minLength: 1, maxLength: 128 }, viewport: { type: 'string', minLength: 1, maxLength: 128 } }, additionalProperties: false, minProperties: 1 }, page_id: { type: 'string' }, page_ref: { type: 'string' }, document_generation: { type: 'integer', minimum: 1 }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 64 }, observation_ref: { type: 'string' }, target_ref: { type: 'string' }, text: { type: 'string', maxLength: 512 }, key: { type: 'string', enum: ['Enter','Tab','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Space','Backspace','Delete','Escape'] }, delta_y: { type: 'integer', minimum: -2000, maximum: 2000 }, wait_for: { type: 'string', enum: ['page_changed','text','enabled'] }, timeout_ms: { type: 'integer', minimum: 1, maximum: 10000 } }, required: ['idempotency_key','grant_id','operation','task_scope'], additionalProperties: false } },
  { name: 'webenvoy_query', description: 'Query a prior Run without replay. If the response was lost, reconnect and query the original idempotency_key.', inputSchema: { type: 'object', properties: { run_id: { type: 'string', pattern: '^managed-[a-f0-9]{64}$' }, idempotency_key: { type: 'string', minLength: 1, maxLength: 512 } }, additionalProperties: false } },
  { name: 'webenvoy_recovery', description: 'Inspect or request owner-managed recovery for a granted Profile, or query an existing recovery operation. This tool cannot backup, confirm, or apply a recovery.', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string', minLength: 1, maxLength: 512 }, grant_id: { type: 'string' }, operation: { type: 'string', enum: ['recovery.inspect','recovery.request','recovery.status'] }, task_scope: { type: 'object' }, profile_ref: { type: 'string' }, backup_ref: { type: 'string' }, operation_ref: { type: 'string' } }, required: ['idempotency_key','grant_id','operation','task_scope','profile_ref'], additionalProperties: false } },
  { name: 'webenvoy_skills', description: 'List, inspect, install, enable, read, update, rollback, or disable an explicitly authorized fixed SKILL revision. Reads return the verified content once; query returns only the durable receipt and summary.', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string', minLength: 1, maxLength: 512 }, grant_id: { type: 'string' }, operation: { type: 'string', enum: ['skill.list','skill.inspect','skill.install','skill.enable','skill.read','skill.update','skill.rollback','skill.disable'] }, task_scope: { type: 'object', properties: { operations: { type: 'array', items: { type: 'string' } }, skill_refs: { type: 'array', items: { type: 'string' } }, source_refs: { type: 'array', items: { type: 'string' } } }, required: ['operations','skill_refs','source_refs'], additionalProperties: false }, skill_ref: { type: 'string' }, source_ref: { type: 'string' }, revision_ref: { type: 'string' }, target_revision_ref: { type: 'string' }, expected_revision_ref: { type: ['string','null'] }, expected_current_revision_ref: { type: ['string','null'] }, expected_record_version: { type: 'integer', minimum: 0 } }, required: ['idempotency_key','grant_id','operation','task_scope'], additionalProperties: false } },
];
async function call(name, args) {
  await verifyBundle();
  if (name === 'webenvoy_skill') return { skill: await readFile(join(root, 'agent-entry/skills/webenvoy-browser/SKILL.md'), 'utf8') };
  const status = await ensureRuntime(client.data_dir);
  if (name === 'webenvoy_status') {
    const publicStatus = { ...status };
    delete publicStatus.camoufoxArtifact;
    return publicStatus;
  }
  const request = (path, body) => localRequest(client.data_dir, path, { credential: client.credential, ...(body === undefined ? {} : { method: 'POST', body }) });
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
    if (!tools[3].inputSchema.properties.operation.enum.includes(args.operation) || Object.keys(args).some(k => !(k in tools[3].inputSchema.properties))) throw new Error('operation_input_refused');
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
